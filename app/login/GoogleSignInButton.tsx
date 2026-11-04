// Copied from gc3274/hw1@3eb3337 app/login/GoogleSignInButton.tsx; keep in sync
// Only the sign-in logic is shared; restyled as Google's light button for the admin theme
"use client";

import { useEffect, useState } from "react";
import Spinner from "@/components/Spinner";
import { focusRing } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="size-5 shrink-0" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

export default function GoogleSignInButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Coming back from Google with the back button restores this page from the
  // bfcache with the spinner still showing, so reset it.
  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) setPending(false);
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  async function signIn() {
    setPending(true);
    setError(null);
    try {
      const { error: oauthError } = await createClient().auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          queryParams: { prompt: "select_account" },
        },
      });
      if (oauthError) throw oauthError;
      // On success the browser is already on its way to Google, so stay pending
    } catch {
      setPending(false);
      setError("Couldn’t reach Google. Please try again.");
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={signIn}
        disabled={pending}
        className={`flex w-full cursor-pointer items-center justify-center gap-3 rounded-full border border-[#747775] bg-white px-4 py-2.5 text-sm font-medium text-[#1f1f1f] transition-colors hover:bg-[#f8f9fa] motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-70 ${focusRing}`}
      >
        {pending ? <Spinner className="size-5" /> : <GoogleLogo />}
        {pending ? "Redirecting to Google…" : "Sign in with Google"}
      </button>
      <p role="alert" className="mt-3 text-sm text-danger empty:mt-0">
        {error}
      </p>
    </div>
  );
}
