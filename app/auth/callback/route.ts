// Copied from gc3274/hw1@3eb3337 app/auth/callback/route.ts; keep in sync
// Only the code exchange is shared; the destination and the error handling are admin-only
import type { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// No `next` param, so this can never redirect off-site. Provider and exchange errors
// are logged, not reflected: the login page only sees error=1.
// redirect() sends a relative Location and keeps the session cookies set through cookies().
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const providerError = params.get("error_description") ?? params.get("error");
  const code = params.get("code");

  if (providerError) {
    // Quoted so a newline in the provider text can't fake a log line
    console.error("Google sign-in returned an error:", JSON.stringify(providerError.slice(0, 200)));
    redirect("/login?error=1");
  }
  if (!code) redirect("/login?error=1");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    console.error("Sign-in code exchange failed:", error?.message ?? "no user");
    redirect("/login?error=1");
  }

  // Through the user's own RLS-bound client. Only a real true goes on to the admin area;
  // anything else, including a failed read, lands on /not-authorized.
  const { data: profile, error: flagError } = await supabase
    .from("profiles")
    .select("is_superadmin")
    .eq("id", data.user.id)
    .maybeSingle<{ is_superadmin: boolean }>();
  if (flagError) console.error("Superadmin check failed", flagError);

  redirect(profile?.is_superadmin === true ? "/" : "/not-authorized");
}
