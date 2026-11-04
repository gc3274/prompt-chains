// Shared rules for the admin forms (terms, examples, models, providers, sign-up
// lists, photos). Pure, so they run in tests; each section's actions apply its
// validator before any write.
import { codePoints } from "@/lib/format";
import { parseTopic, type Topic } from "@/lib/roasts";

// What an edit or create action hands back to its form. A create that works
// redirects instead.
export type FormState<F extends string = string> = {
  ok: boolean;
  message: string;
  errors?: Partial<Record<F, string>>;
};

export const FORM_INITIAL: FormState = { ok: false, message: "" };

export const FIX_FIELDS = "Fix the fields marked above.";
export const DB_DOWN = "Couldn’t save: the database didn’t answer. Try again.";

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

// One line of text: whitespace collapsed, so what's saved is what the prompt sends
export function readText(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? collapse(v) : "";
}

// Within min..max code points, the same count as Postgres char_length
export function lengthOk(value: string, min: number, max: number): boolean {
  const n = codePoints(value);
  return n >= min && n <= max;
}

// Prompt templates keep their line breaks: only Windows line endings become
// \n and the ends are trimmed, so a prompt of only whitespace reads as empty
export function readPrompt(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim() : "";
}

// A number input can send "5.0" for a whole number
const WHOLE_RE = /^\d{1,5}(?:\.0+)?$/;

// A whole number in min..max, or null when it isn't one
export function readWhole(fd: FormData, key: string, min: number, max: number): number | null {
  const raw = readText(fd, key);
  if (!WHOLE_RE.test(raw)) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
}

// A decimal in min..max with at most `places` digits after the point, so
// Postgres never rounds what was typed. Blank is null (the column's "not
// set"); anything else that isn't such a number is undefined.
export function readDecimal(
  fd: FormData,
  key: string,
  { min, max, places }: { min: number; max: number; places: number },
): number | null | undefined {
  const raw = readText(fd, key);
  if (raw === "") return null;
  // A number input accepts ".5" as well as "0.5"
  const match = /^(\d{0,7})(?:\.(\d+))?$/.exec(raw);
  if (!match || (match[1] === "" && match[2] === undefined) || (match[2] ?? "").length > places) return undefined;
  const n = Number(raw);
  return n >= min && n <= max ? n : undefined;
}

// A topic select whose empty option means "every topic". Undefined when the
// value is neither, which only a hand-made request sends.
export function readTopicOrAll(fd: FormData, key = "topic"): Topic | null | undefined {
  const raw = fd.get(key);
  if (raw === "" || raw === null) return null;
  return parseTopic(raw) ?? undefined;
}

// Ids of the new tables are identity bigints
const ID_RE = /^[1-9]\d{0,15}$/;

export function parseId(v: unknown): number | null {
  const raw = Array.isArray(v) ? v[0] : v;
  if (typeof raw === "number") return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
  return typeof raw === "string" && ID_RE.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
}

// Postgres names the failing constraint in the message of a 23505 (unique) or
// 23514 (check) error: violates unique constraint "terms_term_lower_key". The
// map turns the ones a form field can fix into that field.
export function constraintField<F extends string>(
  error: { code?: string; message?: string } | null | undefined,
  map: Record<string, F>,
): F | null {
  if (!error || (error.code !== "23505" && error.code !== "23514")) return null;
  const name = /constraint "([a-z0-9_]+)"/.exec(error.message ?? "")?.[1];
  return (name && map[name]) || null;
}

// 23503: a foreign key still points at the row (on delete restrict)
export const isStillReferenced = (error: { code?: string } | null | undefined) => error?.code === "23503";
