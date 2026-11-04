import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Wordmark from "@/components/Wordmark";
import { card, errorBox } from "@/components/ui";
import { getViewer } from "@/lib/dal";
import GoogleSignInButton from "./GoogleSignInButton";

export const metadata: Metadata = {
  title: "Sign in",
};

// Public. The proxy lets every state through here, so the page sends signed-in
// people on itself (admins to /, everyone else to /not-authorized) and can't loop.
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const viewer = await getViewer();
  if (viewer) redirect(viewer.isSuperadmin === true ? "/" : "/not-authorized");

  // Only used as a flag; the raw value is never shown
  const { error } = await searchParams;
  const failed = Boolean(error);

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className={`${card} w-full max-w-sm p-6 sm:p-8`}>
        <Wordmark />
        <h1 className="mt-8 font-display text-2xl font-bold tracking-tight">
          Sign in to the prompt chain tool
        </h1>
        <p className="mt-2 text-sm text-muted">
          Build, edit and test the prompt chains behind every roast. For superadmins only: use the
          Google account that has admin access.
        </p>

        {failed && (
          <div role="alert" className={`${errorBox} mt-6`}>
            That sign-in didn’t go through. Try again.
          </div>
        )}

        <div className="mt-6">
          <GoogleSignInButton />
        </div>

        <p className="mt-4 text-xs text-muted">
          This sign-in is separate from the main app and the admin, so you may need to sign in here
          too.
        </p>
      </div>
    </main>
  );
}
