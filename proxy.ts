import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Strict on purpose: no file-extension or auth/callback exclusions, so every page
  // path, and every server action posted to it, reaches the gate. Only build assets skip it,
  // matched exactly so a look-alike such as /icon.svgx still goes through.
  matcher: ["/((?!_next/static/|_next/image$|favicon\\.ico$|icon\\.svg$).*)"],
};
