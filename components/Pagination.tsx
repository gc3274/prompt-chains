import Link from "next/link";
import { hrefWith, PAGE_SIZE, type ParamValue } from "@/lib/params";
import { button } from "./ui";

type PaginationProps = {
  pathname: string;
  // The page's parsed query, so the links keep every filter
  query: Record<string, ParamValue>;
  page: number;
  total: number;
};

// Previous / next links built with hrefWith, so they always target a real route
export default function Pagination({ pathname, query, page, total }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1 && page <= 1) return null;

  // Past the end (a hand-typed ?page=), Previous goes back to the last real page
  const prev = page > pages ? pages : page - 1;
  const next = page + 1;

  const step = (to: number, text: string) =>
    to >= 1 && to <= pages ? (
      <Link href={hrefWith(pathname, query, { page: to })} className={button("secondary", "sm")}>
        {text}
      </Link>
    ) : (
      <span aria-disabled="true" className={`${button("secondary", "sm")} pointer-events-none opacity-50`}>
        {text}
      </span>
    );

  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted">
        Page {page} of {pages}
      </p>
      <div className="flex gap-2">
        {step(prev, "Previous")}
        {step(next, "Next")}
      </div>
    </nav>
  );
}
