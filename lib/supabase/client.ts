// Copied from gc3274/hw1@3eb3337 lib/supabase/client.ts; keep in sync
import { createBrowserClient } from "@supabase/ssr";
import { AUTH_COOKIE_NAME, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/env";

export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookieOptions: { name: AUTH_COOKIE_NAME },
  });
}
