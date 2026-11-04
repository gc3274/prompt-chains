import { beforeEach, describe, expect, it, vi } from "vitest";

type FlagResult = {
  data: { is_superadmin: unknown } | null;
  error: { code: string; message: string } | null;
};

// The cookie-bound server client is faked; the DAL itself is real. The fake has
// only getUser(), so reading the session any cheaper way would throw here.
const h = vi.hoisted(() => {
  class Redirect extends Error {
    to: string;
    constructor(to: string) {
      super(`NEXT_REDIRECT ${to}`);
      this.to = to;
    }
  }
  return {
    Redirect,
    user: null as { id: string; email?: string } | null,
    flag: { data: null, error: null } as FlagResult | "throw",
    getUserCalls: 0,
    flagReads: [] as { table: string; columns: string; column: string; value: unknown }[],
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new h.Redirect(to);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      async getUser() {
        h.getUserCalls++;
        return h.user
          ? { data: { user: h.user }, error: null }
          : { data: { user: null }, error: { message: "Auth session missing!" } };
      },
    },
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, value: unknown) => ({
          async maybeSingle() {
            h.flagReads.push({ table, columns, column, value });
            if (h.flag === "throw") throw new Error("fetch failed");
            return h.flag;
          },
        }),
      }),
    }),
  }),
}));

import { getViewer, requireSuperadmin } from "@/lib/dal";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "judge@example.com" };
const flag = (v: unknown): FlagResult => ({ data: { is_superadmin: v }, error: null });
const NO_ROW: FlagResult = { data: null, error: null };
const READ_ERROR: FlagResult = { data: null, error: { code: "42501", message: "permission denied" } };

const signIn = (f: FlagResult | "throw", user: { id: string; email?: string } = USER) => {
  h.user = user;
  h.flag = f;
};

beforeEach(() => {
  h.user = null;
  h.flag = NO_ROW;
  h.getUserCalls = 0;
  h.flagReads = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getViewer", () => {
  it("is null when signed out, and never reads the flag", async () => {
    expect(await getViewer()).toBeNull();
    expect(h.flagReads).toEqual([]);
  });

  it("validates the session with the auth server and reads the caller's own flag", async () => {
    signIn(flag(true));
    expect(await getViewer()).toEqual({ user: USER, email: USER.email, isSuperadmin: true });
    expect(h.getUserCalls).toBe(1);
    expect(h.flagReads).toEqual([
      { table: "profiles", columns: "is_superadmin", column: "id", value: USER.id },
    ]);
  });

  it("counts only a real true as superadmin", async () => {
    for (const [result, expected] of [
      [flag(true), true],
      [flag(false), false],
      [NO_ROW, false],
      [flag(null), false],
      [flag("true"), false],
      [flag(1), false],
    ] as const) {
      signIn(result);
      expect((await getViewer())?.isSuperadmin).toBe(expected);
    }
  });

  it("gives a null flag when the read fails or throws (fail closed)", async () => {
    for (const failure of [READ_ERROR, "throw"] as const) {
      signIn(failure);
      expect((await getViewer())?.isSuperadmin).toBeNull();
    }
  });

  it("uses the auth email, or null when there is none", async () => {
    signIn(flag(false), { id: USER.id });
    expect((await getViewer())?.email).toBeNull();
  });
});

describe("requireSuperadmin", () => {
  it("sends a signed-out caller to /login", async () => {
    await expect(requireSuperadmin()).rejects.toMatchObject({ to: "/login" });
  });

  it("sends a signed-in non-admin to /not-authorized", async () => {
    for (const result of [flag(false), NO_ROW, flag("true")]) {
      signIn(result);
      await expect(requireSuperadmin()).rejects.toMatchObject({ to: "/not-authorized" });
    }
  });

  it("sends the caller to /not-authorized when the flag check fails", async () => {
    for (const failure of [READ_ERROR, "throw"] as const) {
      signIn(failure);
      await expect(requireSuperadmin()).rejects.toMatchObject({ to: "/not-authorized" });
    }
  });

  it("returns only the admin's id and email", async () => {
    signIn(flag(true));
    expect(await requireSuperadmin()).toEqual({ userId: USER.id, email: USER.email });
  });

  it("re-checks on every call outside a single render", async () => {
    signIn(flag(true));
    await requireSuperadmin();
    h.flag = flag(false);
    await expect(requireSuperadmin()).rejects.toMatchObject({ to: "/not-authorized" });
    expect(h.getUserCalls).toBe(2);
  });
});
