// Small display and text helpers. Pure, so they run in tests.

// "1 roast", "2,400 roasts"; pass the plural when adding "s" is wrong
export function nouns(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

// Postgres char_length counts code points, so emoji count as 1
export function codePoints(s: string): number {
  return Array.from(s).length;
}

const DOLLARS = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// "$12.40" from a dollar up. Under a dollar, two significant digits (to the
// micro-dollar a cost is kept to), so a fraction of a cent never reads as
// "$0.00": "$0.37", "$0.05", "$0.0033". "—" when there is no number.
export function formatUsd(x: number): string {
  if (!Number.isFinite(x)) return "—";
  const dollars = Math.round(x * 1_000_000) / 1_000_000;
  if (dollars === 0 || Math.abs(dollars) >= 1) return DOLLARS.format(dollars);
  const places = Math.min(6, Math.max(2, 1 - Math.floor(Math.log10(Math.abs(dollars)))));
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: places,
  });
}

const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

// Token counts at a glance: "850", "12.4K", "1.3M"
export function formatTokens(n: number): string {
  return Number.isFinite(n) ? COMPACT.format(n) : "—";
}
