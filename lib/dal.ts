import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export type Viewer = {
  user: User;
  email: string | null;
  // null means the flag read failed, which counts as "no"
  isSuperadmin: boolean | null;
};

// getUser() asks Supabase Auth to validate the token, so a signed-out or deleted
// session fails here even while its JWT is unexpired (the proxy's getClaims() can't
// tell). The flag is read fresh; cache() only dedupes within one request.
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return null;

  let isSuperadmin: boolean | null = null;
  try {
    const { data: row, error } = await supabase
      .from("profiles")
      .select("is_superadmin")
      .eq("id", user.id)
      .maybeSingle<{ is_superadmin: boolean }>();
    if (error) console.error("Superadmin check failed", error);
    else isSuperadmin = row?.is_superadmin === true;
  } catch (error) {
    console.error("Superadmin check failed", error);
  }

  return { user, email: user.email ?? null, isSuperadmin };
});

// The real gate: the first line of every admin page and server action, and of adminDb().
// The proxy and the (admin) layout are only earlier, optimistic layers.
export const requireSuperadmin = cache(
  async (): Promise<{ userId: string; email: string | null }> => {
    const viewer = await getViewer();
    if (!viewer) redirect("/login");
    if (viewer.isSuperadmin !== true) redirect("/not-authorized");
    return { userId: viewer.user.id, email: viewer.email };
  },
);
