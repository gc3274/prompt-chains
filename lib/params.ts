// Search params for the list pages. Every value is parsed against a fixed set
// or pattern, so nothing raw reaches a PostgREST filter, and every link the
// pages build goes through hrefWith, so it targets a real route.
import { parseId } from "@/lib/forms";

export const PAGE_SIZE = 25;
export const MAX_PAGE = 1000;
// Cards on one page of /media; each holds a photo and its reviews
export const MEDIA_PER_PAGE = 12;

export type SearchParams = Record<string, string | string[] | undefined>;

// Search params can arrive as a string, a repeated param (array), or not at all
const firstParam = (v: unknown) => (Array.isArray(v) ? v[0] : v);

// Whole numbers 1..1000; anything else is page 1
export function parsePage(v: unknown): number {
  const raw = firstParam(v);
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(n)) return 1;
  return Math.min(Math.max(n, 1), MAX_PAGE);
}

// Inclusive bounds for .range()
export function rangeFor(page: number, size = PAGE_SIZE): [number, number] {
  const p = parsePage(page);
  return [(p - 1) * size, p * size - 1];
}

export type MediaQuery = {
  // A prompt chain id
  chain: number | null;
  page: number;
};

export function parseMediaQuery(sp: SearchParams): MediaQuery {
  return { chain: parseId(sp.chain), page: parsePage(sp.page) };
}

type PageResult = {
  data: unknown[] | null;
  error: { code?: string; details?: string | null } | null;
  count: number | null;
};

// PostgREST answers a page past the last row with an error (416, PGRST103) instead
// of an empty page. Its details say how many rows there are ("An offset of 1000 was
// requested, but there are only 11 rows."), so this turns it back into an empty page
// with that total, and the list shows "past the end" instead of "couldn't load".
export function emptyPastEnd<R extends PageResult>(result: R): R {
  if (result.error?.code !== "PGRST103") return result;
  const total = /only (\d+) rows?/.exec(result.error.details ?? "")?.[1];
  return { ...result, data: [], error: null, count: total === undefined ? null : Number(total) };
}

export type ParamValue = string | number | null | undefined;

// Values that are the parsers' defaults, so links leave them out
const DEFAULTS: Record<string, string> = { page: "1" };

// Canonical link: current params with the patch applied, empty values and
// defaults dropped, keys sorted. Changing anything but the page starts again
// at page 1, so a filter link can't land past the last page.
export function hrefWith(pathname: string, current: Record<string, ParamValue>, patch: Record<string, ParamValue> = {}): string {
  const merged: Record<string, ParamValue> = { ...current, ...patch };
  if (!("page" in patch) && Object.keys(patch).length > 0) delete merged.page;

  const params = new URLSearchParams();
  for (const key of Object.keys(merged).sort()) {
    const value = merged[key];
    if (value === null || value === undefined || value === "") continue;
    if (String(value) === DEFAULTS[key]) continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
