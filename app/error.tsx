"use client";

import Link from "next/link";
import { useEffect } from "react";
import { button } from "@/components/ui";

// Never renders error.message: in development it can carry database details.
// The console gets the error, whose digest matches the server log in production.
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-16 sm:px-6">
      <h1 className="font-display text-3xl font-bold tracking-tight">This page didn’t load</h1>
      <p className="mt-2 max-w-prose text-muted">
        If you’ve been away for a while, your session may have ended, so sign in again.
        Otherwise, try once more.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" onClick={() => retry()} className={button("primary")}>
          Try again
        </button>
        <Link href="/login" className={button("secondary")}>
          Sign in again
        </Link>
        <Link href="/" className={button("ghost")}>
          Back to overview
        </Link>
      </div>
    </main>
  );
}
