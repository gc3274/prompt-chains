import Link from "next/link";
import type { ReactNode } from "react";
import { button, textLink } from "./ui";

type FilterBarProps = {
  // The list route the filters apply to, e.g. "/runs"
  action: string;
  // The filter fields: inputs and selects named after the page's search params
  children: ReactNode;
  // Shown only when a filter is set
  showClear?: boolean;
  // Where "Clear filters" goes, when the bare route isn't the unfiltered list
  // (e.g. /votes?view=ratings). Defaults to action.
  clearHref?: string;
};

// A plain GET form, so filtering works without JavaScript and every result is a
// shareable URL. Submitting starts again at page 1 because no page field is sent.
export default function FilterBar({ action, children, showClear = false, clearHref = action }: FilterBarProps) {
  return (
    <form
      method="get"
      action={action}
      className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-3"
    >
      {children}
      <div className="flex items-center gap-4">
        <button type="submit" className={button("primary", "sm")}>
          Apply filters
        </button>
        {showClear && (
          <Link href={clearHref} className={`text-sm ${textLink}`}>
            Clear filters
          </Link>
        )}
      </div>
    </form>
  );
}
