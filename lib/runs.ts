// Shared by server code and tests, so nothing here may touch the server,
// Supabase or env. The rules for running one chosen chain on one photo
// (/generate) and for reading a run's result back (/runs/[id]).
import { isUuid } from "@/lib/captions";
import { parseId } from "@/lib/forms";
import { budgetState } from "@/lib/limits";
import { parsePage, type SearchParams } from "@/lib/params";
import { parseRoastResponse, parseTopic, type Critic, type RoastDraft, type Topic } from "@/lib/roasts";

// Photos on one page of the picker
export const PHOTOS_PER_PAGE = 24;

// What runChain hands back to the form. On success it redirects instead.
export type RunState = { error: string | null; problems?: string[] };

export const RUN_INITIAL: RunState = { error: null };

export const RUN_ERRORS = {
  noChain: "Pick a chain.",
  noPhoto: "Pick a photo.",
  chainGone: "That chain no longer exists. Pick another.",
  cantRun: "This chain can’t run as it stands. Fix these on its page, or pick another chain:",
  photoGone: "That photo no longer exists. Pick another.",
  legacy: "Legacy caption photos have no topic, so no panel can roast them. Pick another.",
  noCritics: "This photo’s topic has no critics, so there’s no one to write the reviews.",
  budgetPaused: "Runs are paused: the daily budget is set to $0 in the admin’s Limits & cost.",
  budgetReached:
    "The daily budget for the last 24 hours is used up, so nothing new can run until older calls age out. The admin’s Limits & cost has the numbers.",
  budgetUnknown: "Couldn’t check the daily budget, so nothing was run. Try again.",
  dbDown: "Couldn’t start: the database didn’t answer. Try again.",
  logFailed: "Couldn’t start: the run log couldn’t be written. Try again.",
} as const;

export type RunInput = { chainId: number; imageId: string };

export function parseRunForm(fd: FormData): { ok: true; input: RunInput } | { ok: false; error: string } {
  const chainId = parseId(fd.get("chainId"));
  if (chainId === null) return { ok: false, error: RUN_ERRORS.noChain };
  const imageId = fd.get("imageId");
  if (!isUuid(imageId)) return { ok: false, error: RUN_ERRORS.noPhoto };
  return { ok: true, input: { chainId, imageId: imageId.toLowerCase() } };
}

// Why the daily budget stops a run, or null when it doesn't. Runs from here
// count toward the main app's budget, so they respect it too.
export function budgetRefusal(budget: { dailyBudgetUsd: number | null; spentUsd: number }): string | null {
  const state = budgetState(budget.dailyBudgetUsd, budget.spentUsd);
  if (state === "paused") return RUN_ERRORS.budgetPaused;
  if (state === "reached") return RUN_ERRORS.budgetReached;
  return null;
}

export type GenerateFailure = "not_configured" | "rejected" | "busy" | "failed";

// What the run's page says when the model calls didn't end in reviews
export const GENERATE_ERRORS: Record<GenerateFailure, string> = {
  not_configured: "GEMINI_API_KEY isn’t set on this deployment, so no model was called.",
  rejected: "The model declined this photo (safety filter, or the main subject is a person).",
  busy: "The model was busy, or the run ran out of time.",
  failed: "The model’s answer couldn’t be used.",
};

// JPEG files always start with FF D8 FF (same check as the main app's upload action)
export const isJpeg = (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

export type GenerateQuery = {
  // The chain to preselect; else the default
  chain: number | null;
  // Only photos of this topic
  topic: Topic | null;
  page: number;
};

export function parseGenerateQuery(sp: SearchParams): GenerateQuery {
  return {
    chain: parseId(sp.chain),
    topic: parseTopic(sp.topic),
    page: parsePage(sp.page),
  };
}

// The rows of the picker's page, as a range for .range()
export function photoRange(page: number): [number, number] {
  const p = Math.max(1, page);
  return [(p - 1) * PHOTOS_PER_PAGE, p * PHOTOS_PER_PAGE - 1];
}

export type ChainChoice = { id: number; name: string; isDefault: boolean; problems: number };

// The option text in the chain picker
export function chainChoiceLabel(c: ChainChoice): string {
  const tags = [c.isDefault ? "default" : null, c.problems > 0 ? "can’t run" : null].filter(Boolean);
  return tags.length > 0 ? `${c.name} (${tags.join(", ")})` : c.name;
}

// Which chain the picker starts on: the asked-for one if it can run, else the
// default if it can, else the first that can. null when none can run.
export function initialChain(choices: readonly ChainChoice[], asked: number | null): number | null {
  const runnable = choices.filter((c) => c.problems === 0);
  return (
    runnable.find((c) => c.id === asked)?.id ??
    runnable.find((c) => c.isDefault)?.id ??
    runnable[0]?.id ??
    null
  );
}

type Answer = { stepOrder: number; status: string; responseText: string | null };

// The call whose answer holds the reviews, for a run that succeeded: the last
// one that answered at the run's last step. A run only succeeds once its last
// step returned the reviews, and when that step's first try failed, the
// fallback's answer comes after it. Not for other runs, which may have stopped
// partway, with a text step's answer last.
export function finalAnswer<A extends Answer>(calls: readonly A[]): A | null {
  if (calls.length === 0) return null;
  const last = Math.max(...calls.map((c) => c.stepOrder));
  const answered = calls.filter((c) => c.stepOrder === last && c.status === "ok" && c.responseText !== null);
  return answered.at(-1) ?? null;
}

export type RunReview = RoastDraft & { critic: Critic };

export type RunResult =
  | { kind: "reviews"; reviews: RunReview[] }
  // The run succeeded, but its answer no longer reads as reviews for today's panel
  | { kind: "unreadable" }
  | { kind: "none" };

// The reviews a successful run got back, read from its log with the topic's
// panel. Nothing else stores them: a run from here never saves roasts.
export function readResult<A extends Answer>(
  run: { status: string; responses: readonly A[] },
  critics: readonly Critic[],
): RunResult {
  if (run.status !== "succeeded") return { kind: "none" };
  const answer = finalAnswer(run.responses);
  const parsed = answer?.responseText ? parseRoastResponse(answer.responseText, [...critics]) : null;
  if (!parsed?.ok) return { kind: "unreadable" };
  const byId = new Map(critics.map((c) => [c.id, c]));
  return {
    kind: "reviews",
    reviews: parsed.roasts.flatMap((r) => {
      const critic = byId.get(r.criticId);
      return critic ? [{ ...r, critic }] : [];
    }),
  };
}
