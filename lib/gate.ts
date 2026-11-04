// The proxy's decision table, kept pure so every row is unit-tested.
// The proxy is only the first layer: pages and actions still call
// requireSuperadmin(), because server actions can be posted to any path.
export type Tier = "public" | "session" | "admin";

export type GateDecision =
  | { kind: "next" }
  | { kind: "redirect"; to: "/login" | "/not-authorized" }
  | { kind: "deny"; status: 401 | 403 | 405 | 503 };

export type GateInput = {
  tier: Tier;
  method: string;
  signedIn: boolean;
  // null means the flag read failed, which counts as "no"
  isSuperadmin: boolean | null;
};

// Exact matches only, so /login/x or /auth/callbackX can't borrow a public tier
const PUBLIC_PATHS = new Set(["/login", "/auth/callback"]);
const SESSION_PATHS = new Set(["/not-authorized"]);

export function pathTier(p: string): Tier {
  if (PUBLIC_PATHS.has(p)) return "public";
  if (SESSION_PATHS.has(p)) return "session";
  return "admin";
}

// Only GET and HEAD are navigations; everything else gets a bare status, never a redirect
const isNavigation = (method: string) => method === "GET" || method === "HEAD";

export function gateDecision({ tier, method, signedIn, isSuperadmin }: GateInput): GateDecision {
  const nav = isNavigation(method);

  // /login has no actions, so refusing POST closes the action-ID side door
  if (tier === "public") return nav ? { kind: "next" } : { kind: "deny", status: 405 };

  // The page itself sends admins on to /, so these two pages can't loop
  if (tier === "session") {
    if (nav) return { kind: "next" };
    if (method !== "POST") return { kind: "deny", status: 405 };
    return signedIn ? { kind: "next" } : { kind: "deny", status: 401 };
  }

  if (!signedIn) return nav ? { kind: "redirect", to: "/login" } : { kind: "deny", status: 401 };
  if (isSuperadmin === true) return { kind: "next" };
  if (nav) return { kind: "redirect", to: "/not-authorized" };
  return { kind: "deny", status: isSuperadmin === false ? 403 : 503 };
}
