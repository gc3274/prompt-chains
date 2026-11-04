// Rules for the chain mix form (/chain-mix). Pure, so they run in tests and the
// form's live total adds up the same way the server checks it.
import { FIX_FIELDS, readWhole } from "@/lib/forms";

// Each weight is a percent of runs: 0 to 100 each, exactly 100 together
// (prompt_chain_mix_weight_range allows 0..100 per row; the total is this form's rule)
export const WEIGHT_MAX = 100;
export const MIX_TOTAL = 100;

export const WEIGHT_RULE = `Use a whole number from 0 to ${WEIGHT_MAX}.`;
export const CANT_RUN_WEIGHT = "This chain can’t run as it stands, so its share must be 0. Fix it on its page first.";
export const MIX_STALE = "The prompt chains changed since this page loaded. Reload the page and try again.";

const FIELD_PREFIX = "weight-";

// The form field for one chain's weight
export const weightField = (chainId: number) => `${FIELD_PREFIX}${chainId}`;

export type MixRow = { prompt_chain_id: number; weight: number };

export type MixResult =
  | { ok: true; rows: MixRow[] }
  | { ok: false; errors: Record<string, string>; message: string };

export function mixTotal(weights: readonly number[]): number {
  return weights.reduce((sum, w) => sum + w, 0);
}

// What one box adds to the live total while it's typed: its whole number, or 0
// while it's blank or not a whole number (the server refuses those on their own)
export function weightValue(raw: string): number {
  const v = raw.trim();
  return /^\d{1,5}$/.test(v) ? Number(v) : 0;
}

const STALE: MixResult = { ok: false, errors: {}, message: MIX_STALE };

// chainIds are every chain in the database. The form must send exactly one
// weight for each: a missing one is a chain added since the page loaded, and an
// unknown one is a chain that's gone, so both ask for a reload. cantRun are the
// chains that fail the runner's checks: they may only have 0, since a run that
// picked one would fall back to the default chain anyway.
export function validateMix(
  fd: FormData,
  chainIds: readonly number[],
  cantRun: readonly number[] = [],
): MixResult {
  const ids = [...new Set(chainIds)].sort((a, b) => a - b);
  if (ids.length === 0) return { ok: false, errors: {}, message: "There are no prompt chains to weigh." };

  const fields = new Set(ids.map(weightField));
  for (const key of new Set(fd.keys())) {
    if (key.startsWith(FIELD_PREFIX) && !fields.has(key)) return STALE;
  }
  if ([...fields].some((field) => !fd.has(field))) return STALE;

  const errors: Record<string, string> = {};
  const rows: MixRow[] = [];
  for (const id of ids) {
    const field = weightField(id);
    // A repeated field only comes from a hand-made request
    const weight = fd.getAll(field).length === 1 ? readWhole(fd, field, 0, WEIGHT_MAX) : null;
    if (weight === null) errors[field] = WEIGHT_RULE;
    else if (weight > 0 && cantRun.includes(id)) errors[field] = CANT_RUN_WEIGHT;
    else rows.push({ prompt_chain_id: id, weight });
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors, message: FIX_FIELDS };

  const total = mixTotal(rows.map((r) => r.weight));
  if (total !== MIX_TOTAL) {
    return {
      ok: false,
      errors: {},
      message: `The weights add up to ${total}. Make them add up to exactly ${MIX_TOTAL}.`,
    };
  }
  return { ok: true, rows };
}
