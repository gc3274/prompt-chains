// Copied from gc3274/hw1@3eb3337 lib/supabase/proxy.ts; keep in sync
// Only the cookie plumbing is shared; the gate is admin-only
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { gateDecision, pathTier } from "@/lib/gate";
import { AUTH_COOKIE_NAME, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/env";

// Read through the caller's own RLS-bound client, never the service key.
// Only a real true counts; a failed read is null, which the gate treats as "no".
async function readSuperadminFlag(supabase: SupabaseClient, userId: string) {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("is_superadmin")
      .eq("id", userId)
      .maybeSingle<{ is_superadmin: boolean }>();
    if (error) {
      console.error("Superadmin check failed", error);
      return null;
    }
    return data?.is_superadmin === true;
  } catch (error) {
    console.error("Superadmin check failed", error);
    return null;
  }
}

// Layer 1 of the gate. It covers every method, not just navigations, because a
// server action is a POST that Next resolves by action ID on any path. It is
// optimistic (getClaims() checks only the JWT), so pages and actions re-check
// with getUser() through lib/dal.ts.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const noCacheHeaders: Record<string, string> = {};

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookieOptions: { name: AUTH_COOKIE_NAME },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        // Responses that carry auth cookies must never be cached by a CDN
        Object.assign(noCacheHeaders, headers);
        Object.entries(noCacheHeaders).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  // Nothing should run between createServerClient and getClaims()
  let userId: string | null = null;
  try {
    const { data } = await supabase.auth.getClaims();
    userId = data?.claims.sub || null;
  } catch (error) {
    // Counts as signed out, so the gate fails closed
    console.error("Session check failed", error);
  }

  const tier = pathTier(request.nextUrl.pathname);
  // Read on every request rather than kept in the JWT, so revoking it bites on the next click
  const isSuperadmin = tier === "admin" && userId ? await readSuperadminFlag(supabase, userId) : null;
  const decision = gateDecision({
    tier,
    method: request.method,
    signedIn: userId !== null,
    isSuperadmin,
  });

  // Redirects and denials keep any refreshed auth cookies and the no-cache headers
  const withSession = (res: NextResponse) => {
    response.cookies.getAll().forEach((c) => res.cookies.set(c));
    Object.entries(noCacheHeaders).forEach(([k, v]) => res.headers.set(k, v));
    return res;
  };

  // The query goes in url.search: a "?" written into pathname would be percent-encoded
  const redirectTo = (pathname: string, search = "") => {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    url.search = search;
    return withSession(NextResponse.redirect(url));
  };

  if (decision.kind === "redirect") return redirectTo(decision.to);
  if (decision.kind === "deny") {
    const denied = withSession(new NextResponse(null, { status: decision.status }));
    if (decision.status === 405) {
      denied.headers.set("Allow", tier === "session" ? "GET, HEAD, POST" : "GET, HEAD");
    }
    return denied;
  }
  return response;
}
