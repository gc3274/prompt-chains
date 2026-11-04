import Link from "next/link";
import type { ReactNode } from "react";
import { button } from "./ui";

type EmptyStateProps = {
  title: string;
  children?: ReactNode;
  action?: { href: string; label: string };
};

// What to show when a list or chart has nothing yet, and what to do about it
export default function EmptyState({ title, children, action }: EmptyStateProps) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface px-5 py-8">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 max-w-prose text-sm text-muted">{children}</div>}
      {action && (
        <Link href={action.href} className={`${button("secondary", "sm")} mt-4`}>
          {action.label}
        </Link>
      )}
    </div>
  );
}
