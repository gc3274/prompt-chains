import type { Metadata } from "next";
import Link from "next/link";
import { button } from "@/components/ui";

export const metadata: Metadata = {
  title: "Not found",
};

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-16 sm:px-6">
      <h1 className="font-display text-3xl font-bold tracking-tight">Page not found</h1>
      <p className="mt-2 max-w-prose text-muted">
        There’s nothing at this address. The link may be wrong, or what it pointed to was
        deleted.
      </p>
      <Link href="/" className={`${button("secondary")} mt-6`}>
        Back to overview
      </Link>
    </main>
  );
}
