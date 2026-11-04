// Shared by server code and tests, so nothing here may touch the server,
// Supabase or env. The main app's daily budget and the cost of logged model
// calls. The admin sets the budget (Limits & cost); runs from Generate here
// check it before calling a model, and the run pages add up what calls cost.

const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

// Where the budget stands. The app refuses a post once spend reaches the
// budget, so a budget of 0 refuses every one.
export type BudgetState = "none" | "paused" | "under" | "reached";

export function budgetState(budget: number | null, spentUsd: number): BudgetState {
  if (budget === null) return "none";
  if (budget === 0) return "paused";
  return spentUsd >= budget ? "reached" : "under";
}

// Spend ------------------------------------------------------------------------

// One logged model call. cost_usd is numeric, so it can arrive as a string.
export type CallUsage = {
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | string | null;
};

export type Tally = {
  calls: number;
  // Calls without a recorded count add nothing
  inputTokens: number;
  outputTokens: number;
  // Of the calls with a cost only
  costUsd: number;
  // No price for the model, no answer, or logged before costs were
  withoutCost: number;
};

const MICRO = 1_000_000;

// A numeric column as a number, or null when it's missing or unreadable
export function toUsd(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const tokens = (n: number | null) => (n !== null && Number.isFinite(n) && n > 0 ? n : 0);

// Costs add up in micro-dollars, the column's precision, so many small ones don't drift
export function tally(rows: readonly CallUsage[]): Tally {
  let micro = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let withoutCost = 0;
  for (const r of rows) {
    inputTokens += tokens(r.input_tokens);
    outputTokens += tokens(r.output_tokens);
    const cost = toUsd(r.cost_usd);
    if (cost === null) withoutCost++;
    else micro += Math.round(cost * MICRO);
  }
  return { calls: rows.length, inputTokens, outputTokens, costUsd: micro / MICRO, withoutCost };
}

// "YYYY-MM-DD" New York days, newest first, today included
