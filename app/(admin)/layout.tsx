import AdminShell from "@/components/AdminShell";
import { requireSuperadmin } from "@/lib/dal";

// UI only, not the gate: a layout doesn't re-render on client navigation and can be
// skipped by an RSC request, so every page and action calls requireSuperadmin() itself.
// It is called here for the email in the side bar (cache() makes it one check per request).
export default async function AdminLayout({ children }: LayoutProps<"/">) {
  const { email } = await requireSuperadmin();
  return <AdminShell email={email}>{children}</AdminShell>;
}
