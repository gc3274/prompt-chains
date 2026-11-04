import { redirect } from "next/navigation";
import { requireSuperadmin } from "@/lib/dal";

// The home page is the chain list; signed-out visitors go to /login first
export default async function HomePage() {
  await requireSuperadmin();
  redirect("/prompt-chains");
}
