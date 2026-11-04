import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/app/auth/actions";
import SubmitButton from "@/components/SubmitButton";
import Wordmark from "@/components/Wordmark";
import { button, card } from "@/components/ui";
import { getViewer } from "@/lib/dal";

export const metadata: Metadata = {
  title: "No access",
};

// Session only: any signed-in person may load this page and post signOut to it.
// It shows nothing but the caller's own email and never touches the service key.
export default async function NotAuthorizedPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (viewer.isSuperadmin === true) redirect("/");

  // null means the flag couldn't be read, which is not the same as "no"
  const checkFailed = viewer.isSuperadmin === null;

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className={`${card} w-full max-w-md p-6 sm:p-8`}>
        <Wordmark />
        <h1 className="mt-8 font-display text-2xl font-bold tracking-tight">
          {checkFailed ? "We couldn’t check your access" : "This account can’t open the prompt chain tool"}
        </h1>
        <p className="mt-2 text-sm break-words text-muted">
          {viewer.email ? (
            <>
              Signed in as <span className="font-medium text-ink">{viewer.email}</span>.
            </>
          ) : (
            "You’re signed in."
          )}
        </p>

        {checkFailed ? (
          <p className="mt-6 text-sm">
            The database didn’t answer the access check. Try again in a minute.
          </p>
        ) : (
          <>
            <h2 className="mt-6 text-sm font-semibold">How to get access</h2>
            <p className="mt-1 text-sm">
              Ask the project owner to turn on admin access for this email. They set it in
              the database; it can’t be requested or granted from inside the app. Once it’s
              on, choose Check again. You don’t need to sign in again.
            </p>
          </>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link href="/" className={button("primary")}>
            {checkFailed ? "Try again" : "Check again"}
          </Link>
          <form action={signOut}>
            <SubmitButton variant="secondary" pendingText="Signing out…">
              Sign out
            </SubmitButton>
          </form>
        </div>
        <p className="mt-4 text-xs text-muted">
          Wrong account? Sign out, then pick another Google account.
        </p>
      </div>
    </main>
  );
}
