// Copied from gc3274/hw1@3eb3337 app/auth/actions.ts; keep in sync
// signOut always lands on /login here
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// The one action without requireSuperadmin(): a signed-in non-admin on
// /not-authorized must be able to leave. It only ends the caller's own session.
export async function signOut() {
  const supabase = await createClient();
  // The default scope is "global", which would end sessions on every device
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) console.error("Sign out failed:", error.message);

  revalidatePath("/", "layout");
  redirect("/login");
}
