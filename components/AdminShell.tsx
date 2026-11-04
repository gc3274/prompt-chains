import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/auth/actions";
import { ADMIN_NAV_GROUPS } from "@/lib/nav";
import type { Theme } from "@/lib/theme";
import NavLink from "./NavLink";
import NavToggle from "./NavToggle";
import SubmitButton from "./SubmitButton";
import ThemeSwitch from "./ThemeSwitch";
import Wordmark from "./Wordmark";
import { focusRing } from "./ui";

type AdminShellProps = {
  email: string | null;
  theme: Theme;
  children: ReactNode;
};

// Side bar plus the page frame. From xl up the bar is a column on the left that
// stays put while the page scrolls (and scrolls on its own if the window is
// short): the wordmark, the sections, then the theme and the account at the
// foot. Below xl it is a top row whose Menu button shows the same nav. Each
// group's bold label sits right over its own tabs with a rule above it, so a
// group's tabs never read as part of the next.
export default function AdminShell({ email, theme, children }: AdminShellProps) {
  return (
    <>
      <a
        href="#main"
        className={`sr-only rounded-full bg-surface px-4 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 ${focusRing}`}
      >
        Skip to content
      </a>
      <div className="flex flex-1 flex-col xl:flex-row">
        {/* The page header: the brand, the nav and the account, at the side from xl up */}
        <header className="border-b border-line bg-surface xl:sticky xl:top-0 xl:h-dvh xl:w-64 xl:shrink-0 xl:overflow-y-auto xl:border-r xl:border-b-0">
          <NavToggle
            brand={
              <Link href="/" className={`min-w-0 flex-1 rounded-md ${focusRing}`}>
                <Wordmark />
              </Link>
            }
          >
            {/* Two or four columns while it folds out under the top row, one in the side bar */}
            <nav aria-label="Sections" className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-1">
              {ADMIN_NAV_GROUPS.map((group) => (
                <div key={group.label} className="border-t border-line pt-3">
                  {/* Not a heading: it would come before each page's h1 */}
                  <p
                    id={`nav-${group.label.toLowerCase()}`}
                    className="px-3 text-xs font-bold tracking-wide text-ink uppercase"
                  >
                    {group.label}
                  </p>
                  <ul aria-labelledby={`nav-${group.label.toLowerCase()}`} className="mt-1.5 flex flex-col gap-0.5">
                    {group.items.map((item) => (
                      <li key={item.href}>
                        <NavLink href={item.href}>{item.label}</NavLink>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
            <div className="flex flex-wrap items-center gap-3 border-t border-line px-3 pt-4 xl:mt-auto xl:flex-col xl:flex-nowrap xl:items-stretch">
              <ThemeSwitch initial={theme} />
              {email && (
                <p className="min-w-0 flex-1 truncate text-sm text-muted xl:flex-none" title={email}>
                  {email}
                </p>
              )}
              <form action={signOut}>
                <SubmitButton variant="secondary" size="sm" pendingText="Signing out…">
                  Sign out
                </SubmitButton>
              </form>
            </div>
          </NavToggle>
        </header>
        <main id="main" className="min-w-0 flex-1">
          <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</div>
        </main>
      </div>
    </>
  );
}
