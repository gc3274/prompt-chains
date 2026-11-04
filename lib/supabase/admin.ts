import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireSuperadmin } from "@/lib/dal";
import { SUPABASE_URL } from "@/lib/supabase/env";

// The only way to the service role, which bypasses RLS. It checks the caller before
// building anything, so a check forgotten upstream still fails closed. Built with
// supabase-js on purpose: an @supabase/ssr client would send the user's cookie token
// instead of this key and silently run as the user.
export async function adminDb(): Promise<SupabaseClient> {
  await requireSuperadmin();

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");

  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
