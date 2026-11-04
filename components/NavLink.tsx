"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { isActive } from "@/lib/nav";
import { focusRing } from "./ui";

// Client-side only to read the pathname: layouts don't re-render on navigation,
// so the server can't keep aria-current up to date. A full-width row in the side bar.
export default function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const active = isActive(usePathname(), href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex rounded-lg px-3 py-2 text-sm transition-colors motion-reduce:transition-none ${
        active ? "bg-accent/10 font-semibold text-accent" : "font-medium text-muted hover:bg-canvas hover:text-ink"
      } ${focusRing}`}
    >
      {children}
    </Link>
  );
}
