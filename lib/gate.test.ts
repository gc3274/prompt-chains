import { describe, expect, it } from "vitest";
import { gateDecision, pathTier, type GateDecision } from "@/lib/gate";

const next: GateDecision = { kind: "next" };
const toLogin: GateDecision = { kind: "redirect", to: "/login" };
const toNotAuthorized: GateDecision = { kind: "redirect", to: "/not-authorized" };
const deny = (status: 401 | 403 | 405 | 503): GateDecision => ({ kind: "deny", status });

describe("pathTier", () => {
  it("treats only the exact sign-in paths as public", () => {
    expect(pathTier("/login")).toBe("public");
    expect(pathTier("/auth/callback")).toBe("public");
  });

  it("treats /not-authorized as session only", () => {
    expect(pathTier("/not-authorized")).toBe("session");
  });

  it("puts everything else behind the admin check, including look-alikes", () => {
    for (const p of [
      "/",
      "/users",
      "/media/new",
      "/media/x.png",
      "/login/x",
      "/login/",
      "/auth/callbackX",
      "/auth/callback/x",
      "/not-authorized/x",
      "/LOGIN",
      "",
    ]) {
      expect(pathTier(p), p).toBe("admin");
    }
  });
});

describe("gateDecision: public tier", () => {
  const states = [
    { signedIn: false, isSuperadmin: null },
    { signedIn: true, isSuperadmin: false },
    { signedIn: true, isSuperadmin: true },
    { signedIn: true, isSuperadmin: null },
  ];

  it("lets GET and HEAD through in every state, so the page redirects onward", () => {
    for (const s of states) {
      expect(gateDecision({ tier: "public", method: "GET", ...s })).toEqual(next);
      expect(gateDecision({ tier: "public", method: "HEAD", ...s })).toEqual(next);
    }
  });

  it("refuses POST and other methods with 405 in every state", () => {
    for (const s of states) {
      for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
        expect(gateDecision({ tier: "public", method, ...s })).toEqual(deny(405));
      }
    }
  });
});

describe("gateDecision: session tier", () => {
  it("lets GET and HEAD through signed in or not", () => {
    expect(gateDecision({ tier: "session", method: "GET", signedIn: false, isSuperadmin: null })).toEqual(next);
    expect(gateDecision({ tier: "session", method: "HEAD", signedIn: false, isSuperadmin: null })).toEqual(next);
    expect(gateDecision({ tier: "session", method: "GET", signedIn: true, isSuperadmin: false })).toEqual(next);
    expect(gateDecision({ tier: "session", method: "GET", signedIn: true, isSuperadmin: true })).toEqual(next);
  });

  it("allows POST (sign out) only with a session", () => {
    expect(gateDecision({ tier: "session", method: "POST", signedIn: false, isSuperadmin: null })).toEqual(deny(401));
    expect(gateDecision({ tier: "session", method: "POST", signedIn: true, isSuperadmin: false })).toEqual(next);
    expect(gateDecision({ tier: "session", method: "POST", signedIn: true, isSuperadmin: null })).toEqual(next);
  });

  it("refuses other methods with 405", () => {
    expect(gateDecision({ tier: "session", method: "PUT", signedIn: true, isSuperadmin: false })).toEqual(deny(405));
    expect(gateDecision({ tier: "session", method: "DELETE", signedIn: false, isSuperadmin: null })).toEqual(deny(405));
  });
});

describe("gateDecision: admin tier", () => {
  it("sends signed-out navigations to /login and denies everything else with 401", () => {
    expect(gateDecision({ tier: "admin", method: "GET", signedIn: false, isSuperadmin: null })).toEqual(toLogin);
    expect(gateDecision({ tier: "admin", method: "HEAD", signedIn: false, isSuperadmin: null })).toEqual(toLogin);
    expect(gateDecision({ tier: "admin", method: "POST", signedIn: false, isSuperadmin: null })).toEqual(deny(401));
    expect(gateDecision({ tier: "admin", method: "PUT", signedIn: false, isSuperadmin: null })).toEqual(deny(401));
  });

  it("ignores a flag that came without a session", () => {
    expect(gateDecision({ tier: "admin", method: "GET", signedIn: false, isSuperadmin: true })).toEqual(toLogin);
    expect(gateDecision({ tier: "admin", method: "POST", signedIn: false, isSuperadmin: true })).toEqual(deny(401));
  });

  it("sends non-admins to /not-authorized and denies everything else with 403", () => {
    expect(gateDecision({ tier: "admin", method: "GET", signedIn: true, isSuperadmin: false })).toEqual(toNotAuthorized);
    expect(gateDecision({ tier: "admin", method: "HEAD", signedIn: true, isSuperadmin: false })).toEqual(toNotAuthorized);
    expect(gateDecision({ tier: "admin", method: "POST", signedIn: true, isSuperadmin: false })).toEqual(deny(403));
    expect(gateDecision({ tier: "admin", method: "DELETE", signedIn: true, isSuperadmin: false })).toEqual(deny(403));
  });

  it("fails closed when the flag check failed: redirect for navigations, 503 otherwise", () => {
    expect(gateDecision({ tier: "admin", method: "GET", signedIn: true, isSuperadmin: null })).toEqual(toNotAuthorized);
    expect(gateDecision({ tier: "admin", method: "POST", signedIn: true, isSuperadmin: null })).toEqual(deny(503));
    expect(gateDecision({ tier: "admin", method: "PATCH", signedIn: true, isSuperadmin: null })).toEqual(deny(503));
  });

  it("lets superadmins through on every method", () => {
    for (const method of ["GET", "HEAD", "POST", "PUT", "DELETE"]) {
      expect(gateDecision({ tier: "admin", method, signedIn: true, isSuperadmin: true })).toEqual(next);
    }
  });

  it("does not treat a lowercase method as a navigation", () => {
    expect(gateDecision({ tier: "admin", method: "get", signedIn: false, isSuperadmin: null })).toEqual(deny(401));
  });
});

describe("gateDecision: no redirect loops", () => {
  it("only ever redirects to /login or /not-authorized, and both let GET through", () => {
    const targets = new Set<string>();
    for (const tier of ["public", "session", "admin"] as const) {
      for (const method of ["GET", "HEAD", "POST", "PUT"]) {
        for (const signedIn of [false, true]) {
          for (const isSuperadmin of [true, false, null]) {
            const d = gateDecision({ tier, method, signedIn, isSuperadmin });
            if (d.kind === "redirect") {
              expect(["GET", "HEAD"]).toContain(method);
              targets.add(d.to);
            }
          }
        }
      }
    }
    expect([...targets].sort()).toEqual(["/login", "/not-authorized"]);
    for (const to of targets) {
      for (const signedIn of [false, true]) {
        for (const isSuperadmin of [true, false, null]) {
          expect(gateDecision({ tier: pathTier(to), method: "GET", signedIn, isSuperadmin })).toEqual(next);
        }
      }
    }
  });
});
