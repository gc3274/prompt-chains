import { beforeEach, describe, expect, it, vi } from "vitest";

type FlagResult = {
  data: { is_superadmin: unknown } | null;
  error: { code: string; message: string } | null;
};
type Options = {
  cookieOptions?: { name?: string };
  cookies: {
    setAll: (
      cookies: { name: string; value: string; options: object }[],
      headers: Record<string, string>,
    ) => void;
  };
};

// Only the Supabase client is faked: each test sets the session, the flag read and
// any cookies the SDK refreshes. env.ts, gate.ts and the proxy itself are real.
const sb = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example-ref.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "publishable-test-key";
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return {
    userId: null as string | null,
    claimsThrow: false,
    flag: { data: null, error: null } as FlagResult | "throw",
    refreshed: [] as { name: string; value: string }[],
    noCache: {
      "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
      Expires: "0",
      Pragma: "no-cache",
    },
    key: "",
    options: undefined as Options | undefined,
    flagReads: [] as { table: string; columns: string; column: string; value: unknown }[],
  };
});

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, key: string, options: Options) => {
    sb.key = key;
    sb.options = options;
    return {
      auth: {
        async getClaims() {
          if (sb.claimsThrow) throw new Error("JWKS fetch failed");
          if (sb.refreshed.length) {
            options.cookies.setAll(
              sb.refreshed.map((c) => ({ ...c, options: { path: "/" } })),
              sb.noCache,
            );
          }
          return sb.userId
            ? { data: { claims: { sub: sb.userId } }, error: null }
            : { data: null, error: null };
        },
      },
      from: (table: string) => ({
        select: (columns: string) => ({
          eq: (column: string, value: unknown) => ({
            async maybeSingle() {
              sb.flagReads.push({ table, columns, column, value });
              if (sb.flag === "throw") throw new Error("fetch failed");
              return sb.flag;
            },
          }),
        }),
      }),
    };
  },
}));

import { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { config, proxy } from "@/proxy";

const ORIGIN = "http://localhost:3002";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ROAST_ID = "22222222-2222-4222-8222-222222222222";
const flag = (v: unknown): FlagResult => ({ data: { is_superadmin: v }, error: null });
const NOT_ADMIN = flag(false);
const ADMIN = flag(true);
const NO_ROW: FlagResult = { data: null, error: null };
const READ_ERROR: FlagResult = { data: null, error: { code: "42501", message: "permission denied" } };

const ADMIN_PATHS = [
  "/",
  "/users",
  `/users/${USER_ID}`,
  "/media",
  "/media/new",
  `/media/${ROAST_ID}`,
  `/media/${ROAST_ID}.png`,
  "/media/x.jpg",
  "/votes",
  "/nope",
  "/login/x",
  "/auth/callbackX",
  "/not-authorized/x",
];
const NON_NAV = ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

const req = (path: string, method = "GET") => new NextRequest(`${ORIGIN}${path}`, { method });
const signIn = (f: FlagResult | "throw") => {
  sb.userId = USER_ID;
  sb.flag = f;
};
const isNext = (res: Response) => res.headers.get("x-middleware-next") === "1";

async function expectRedirect(res: Response, to: "/login" | "/not-authorized") {
  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toBe(`${ORIGIN}${to}`);
  expect(isNext(res)).toBe(false);
}

async function expectDeny(res: Response, status: number) {
  expect(res.status).toBe(status);
  expect(res.headers.get("location")).toBeNull();
  expect(isNext(res)).toBe(false);
  expect(await res.text()).toBe("");
}

function reset() {
  sb.userId = null;
  sb.claimsThrow = false;
  sb.flag = NO_ROW;
  sb.refreshed = [];
  sb.key = "";
  sb.options = undefined;
}

beforeEach(() => {
  reset();
  sb.flagReads = [];
});

describe("updateSession: signed out", () => {
  it("redirects every navigation on an admin path to /login without reading the flag", async () => {
    for (const path of ADMIN_PATHS) {
      for (const method of ["GET", "HEAD"]) {
        await expectRedirect(await updateSession(req(path, method)), "/login");
      }
    }
    expect(sb.flagReads).toEqual([]);
  });

  it("drops the query instead of encoding it into the path", async () => {
    const res = await updateSession(req("/media?kind=legacy&page=2&_rsc=1abc"));
    await expectRedirect(res, "/login");
    expect(res.headers.get("location")).not.toMatch(/%3F|\?/i);
  });

  it("answers every other method on an admin path with a bare 401", async () => {
    for (const path of ADMIN_PATHS) {
      for (const method of NON_NAV) {
        await expectDeny(await updateSession(req(path, method)), 401);
      }
    }
  });

  it("fails closed when the session check itself throws", async () => {
    sb.claimsThrow = true;
    await expectRedirect(await updateSession(req("/media")), "/login");
    await expectDeny(await updateSession(req("/media", "POST")), 401);
  });
});

describe("updateSession: signed in without the flag", () => {
  it("reads the caller's own flag through the session client", async () => {
    signIn(NOT_ADMIN);
    await updateSession(req("/media"));
    expect(sb.flagReads).toEqual([
      { table: "profiles", columns: "is_superadmin", column: "id", value: USER_ID },
    ]);
  });

  it("sends navigations to /not-authorized and denies everything else with 403", async () => {
    signIn(NOT_ADMIN);
    for (const path of ADMIN_PATHS) {
      await expectRedirect(await updateSession(req(path)), "/not-authorized");
      await expectRedirect(await updateSession(req(path, "HEAD")), "/not-authorized");
      for (const method of NON_NAV) {
        await expectDeny(await updateSession(req(path, method)), 403);
      }
    }
  });

  it("treats a missing profile row as not a superadmin", async () => {
    signIn(NO_ROW);
    await expectRedirect(await updateSession(req("/")), "/not-authorized");
    await expectDeny(await updateSession(req("/", "POST")), 403);
  });

  it("accepts only a real true, not a truthy look-alike", async () => {
    for (const v of ["true", 1, "1", {}, null]) {
      signIn(flag(v));
      await expectDeny(await updateSession(req("/media", "POST")), 403);
    }
  });
});

describe("updateSession: flag check failed", () => {
  it("redirects navigations to /not-authorized and answers 503 otherwise", async () => {
    for (const failure of [READ_ERROR, "throw"] as const) {
      reset();
      signIn(failure);
      await expectRedirect(await updateSession(req("/media")), "/not-authorized");
      for (const method of NON_NAV) {
        await expectDeny(await updateSession(req("/media", method)), 503);
      }
    }
  });
});

describe("updateSession: superadmin", () => {
  it("lets every method through on every admin path", async () => {
    signIn(ADMIN);
    for (const path of ADMIN_PATHS) {
      for (const method of ["GET", "HEAD", ...NON_NAV]) {
        const res = await updateSession(req(path, method));
        expect(isNext(res), `${method} ${path}`).toBe(true);
        expect(res.status).toBe(200);
      }
    }
  });

  it("re-reads the flag on every request, so revoking it bites on the next click", async () => {
    signIn(ADMIN);
    expect(isNext(await updateSession(req("/media")))).toBe(true);
    sb.flag = NOT_ADMIN;
    await expectRedirect(await updateSession(req("/media")), "/not-authorized");
    expect(sb.flagReads).toHaveLength(2);
  });
});

describe("updateSession: public paths", () => {
  const states: (() => void)[] = [
    () => {},
    () => signIn(NOT_ADMIN),
    () => signIn(ADMIN),
    () => signIn(READ_ERROR),
  ];

  it("lets GET and HEAD through in every state without reading the flag", async () => {
    for (const setState of states) {
      reset();
      setState();
      for (const path of ["/login", "/auth/callback", "/auth/callback?code=abc"]) {
        for (const method of ["GET", "HEAD"]) {
          expect(isNext(await updateSession(req(path, method))), `${method} ${path}`).toBe(true);
        }
      }
    }
    expect(sb.flagReads).toEqual([]);
  });

  it("refuses POST and every other method with 405, even for a superadmin", async () => {
    for (const setState of states) {
      reset();
      setState();
      for (const path of ["/login", "/auth/callback"]) {
        for (const method of NON_NAV) {
          const res = await updateSession(req(path, method));
          await expectDeny(res, 405);
          expect(res.headers.get("allow")).toBe("GET, HEAD");
        }
      }
    }
    expect(sb.flagReads).toEqual([]);
  });
});

describe("updateSession: /not-authorized", () => {
  it("lets GET through signed in or not, without reading the flag", async () => {
    expect(isNext(await updateSession(req("/not-authorized")))).toBe(true);
    signIn(NOT_ADMIN);
    expect(isNext(await updateSession(req("/not-authorized")))).toBe(true);
    expect(sb.flagReads).toEqual([]);
  });

  it("allows POST (sign out) only with a session", async () => {
    await expectDeny(await updateSession(req("/not-authorized", "POST")), 401);
    signIn(NOT_ADMIN);
    expect(isNext(await updateSession(req("/not-authorized", "POST")))).toBe(true);
    expect(sb.flagReads).toEqual([]);
  });

  it("refuses other methods with 405", async () => {
    signIn(NOT_ADMIN);
    for (const method of ["PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const res = await updateSession(req("/not-authorized", method));
      await expectDeny(res, 405);
      expect(res.headers.get("allow")).toBe("GET, HEAD, POST");
    }
  });
});

describe("updateSession: no redirect loops", () => {
  it("every redirect lands on a page the proxy lets through in the same state", async () => {
    const states: [string, () => void][] = [
      ["signed out", () => {}],
      ["claims threw", () => (sb.claimsThrow = true)],
      ["not admin", () => signIn(NOT_ADMIN)],
      ["no row", () => signIn(NO_ROW)],
      ["read error", () => signIn(READ_ERROR)],
      ["read threw", () => signIn("throw")],
      ["admin", () => signIn(ADMIN)],
    ];
    for (const [name, setState] of states) {
      for (const path of [...ADMIN_PATHS, "/login", "/auth/callback", "/not-authorized"]) {
        reset();
        setState();
        const first = await updateSession(req(path));
        const location = first.headers.get("location");
        if (!location) continue;
        const second = await updateSession(req(new URL(location).pathname));
        expect(isNext(second), `${name}: ${path} -> ${location}`).toBe(true);
      }
    }
  });
});

describe("updateSession: session cookies", () => {
  it("builds the client with the publishable key and the admin's own cookie name", async () => {
    await updateSession(req("/"));
    expect(sb.key).toBe("publishable-test-key");
    expect(sb.options?.cookieOptions?.name).toBe("sb-chains-auth-token");
  });

  it("carries refreshed cookies and no-cache headers on next, redirect and deny responses", async () => {
    const cases: [() => void, string, string][] = [
      [() => signIn(ADMIN), "/media", "GET"],
      [() => {}, "/media", "GET"],
      [() => {}, "/media", "POST"],
      [() => signIn(NOT_ADMIN), "/media", "GET"],
      [() => signIn(NOT_ADMIN), "/media", "DELETE"],
      [() => signIn(READ_ERROR), "/media", "POST"],
      [() => {}, "/login", "POST"],
    ];
    for (const [setState, path, method] of cases) {
      reset();
      setState();
      sb.refreshed = [{ name: "sb-chains-auth-token", value: "refreshed-session" }];
      const res = await updateSession(req(path, method));
      expect(res.cookies.get("sb-chains-auth-token")?.value, `${method} ${path}`).toBe(
        "refreshed-session",
      );
      expect(res.headers.get("cache-control")).toContain("no-store");
    }
  });
});

describe("proxy.ts", () => {
  it("hands every request to updateSession", async () => {
    await expectRedirect(await proxy(req("/media")), "/login");
    await expectDeny(await proxy(req("/login", "POST")), 405);
  });

  it("uses the strict matcher", () => {
    expect(config.matcher).toEqual(["/((?!_next/static/|_next/image$|favicon\\.ico$|icon\\.svg$).*)"]);
  });

  it("runs on every page path, including image-looking suffixes, and skips only build assets", async () => {
    // Next's matcher helper needs the AsyncLocalStorage global that Next's own server sets
    const g = globalThis as { AsyncLocalStorage?: unknown };
    g.AsyncLocalStorage ??= (await import("node:async_hooks")).AsyncLocalStorage;
    const { unstable_doesMiddlewareMatch: matches } = await import(
      "next/experimental/testing/server"
    );

    for (const url of [
      ...ADMIN_PATHS,
      "/login",
      "/auth/callback",
      "/auth/callback?code=abc",
      "/not-authorized",
      "/media?_rsc=1abc",
      "/robots.txt",
      "/sitemap.xml",
      "/api/anything",
      "/favicon.png",
      "/logo.svg",
      "/icon.svgx",
      "/favicon.ico/x",
      "/_next/staticx",
      "/_next/imagex",
    ]) {
      expect(matches({ config, url }), url).toBe(true);
    }
    for (const url of [
      "/_next/static/chunks/app.js",
      "/_next/image?url=%2Fx.png&w=64&q=75",
      "/favicon.ico",
      "/icon.svg",
    ]) {
      expect(matches({ config, url }), url).toBe(false);
    }
  });
});
