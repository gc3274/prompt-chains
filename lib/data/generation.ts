import "server-only";
import { unstable_rethrow } from "next/navigation";
import {
  CALLABLE_PROVIDER,
  CHAIN_SELECT,
  EXAMPLES_MAX,
  TERMS_MAX,
  clipText,
  responseRow,
  toChain,
  validateChain,
  type Chain,
  type ChainRow,
  type Example,
  type Price,
  type ResponseLog,
  type Term,
} from "@/lib/chains";
import { DAY_MS } from "@/lib/limits";
import type { Critic, Topic } from "@/lib/roasts";
import { adminDb } from "@/lib/supabase/admin";

// The roast pipeline's settings and logs for runs started here
// (app/(admin)/generate/actions.ts). Same steps as the main app's
// lib/generation.ts, logged as source 'admin' under the admin who ran them, so
// they never count toward anyone's daily posts. Like everything that reaches
// adminDb(), each call checks the superadmin gate first.

export type RequestStatus = "succeeded" | "rejected" | "busy" | "failed" | "limited";

export type RunConfig = {
  chain: Chain;
  // The topic's whole panel, as a run from the main app gets it
  critics: Critic[];
  terms: Term[];
  examples: Example[];
  // By model id; models without a price are left out, so their calls have no cost
  prices: Map<string, Price>;
  // What couldn't be read, for the request's log; the run goes ahead without it
  problem: string | null;
};

type Db = Awaited<ReturnType<typeof adminDb>>;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

// Written before the model is called. Null when it can't be written: the
// caller refuses to start a run it can't log.
// db: the client the run already built, so a run checks the gate once rather
// than on every write (a server action doesn't share cache() across calls)
export async function startRequest(
  input: {
    userId: string;
    imagePath: string;
    imageId: string;
    topic: Topic;
  },
  db?: Db,
): Promise<string | null> {
  try {
    db ??= await adminDb();
    const { data, error } = await db
      .from("generation_requests")
      .insert({
        user_id: input.userId,
        source: "admin",
        image_path: input.imagePath,
        image_id: input.imageId,
        topic: input.topic,
      })
      .select("id")
      .single<{ id: string }>();
    if (error || !data) {
      console.error("Logging the roast request failed", error?.message ?? "no row");
      return null;
    }
    return data.id;
  } catch (err) {
    unstable_rethrow(err);
    console.error("Logging the roast request failed", message(err));
    return null;
  }
}

type ChainRead =
  | { chain: Chain; problems: null }
  | { chain: null; problems: string[]; missing: boolean };

async function readChain(db: Db, id: number): Promise<ChainRead> {
  const { data, error } = await db.from("prompt_chains").select(CHAIN_SELECT).eq("id", id).maybeSingle<ChainRow>();
  if (error) throw new Error(`Reading chain ${id} failed: ${error.message}`);
  if (!data) return { chain: null, problems: [], missing: true };

  const chain = toChain(data);
  if (!chain) return { chain: null, problems: ["A step uses a model this app can’t call."], missing: false };
  const problems = validateChain(chain);
  if (problems.length > 0) return { chain: null, problems, missing: false };
  return { chain, problems: null };
}

type ExampleRow = {
  image_description: string;
  roast: string;
  tip: string | null;
  score: number;
  explanation: string;
};

type PriceRow = {
  provider_model_id: string;
  input_usd_per_million: number | string | null;
  output_usd_per_million: number | string | null;
};

function toPrices(rows: PriceRow[]): Map<string, Price> {
  const prices = new Map<string, Price>();
  for (const row of rows) {
    if (row.input_usd_per_million === null || row.output_usd_per_million === null) continue;
    const inputPerMillion = Number(row.input_usd_per_million);
    const outputPerMillion = Number(row.output_usd_per_million);
    if (!Number.isFinite(inputPerMillion) || !Number.isFinite(outputPerMillion)) continue;
    prices.set(row.provider_model_id, { inputPerMillion, outputPerMillion });
  }
  return prices;
}

// The topic's terms and examples as the prompt gets them, and every priced
// model the app can call (so the fallback and the built-in chain are priced
// too). Never throws: what can't be read is left empty and named in problems.
async function readPromptData(
  db: Db,
  topic: Topic,
): Promise<{ terms: Term[]; examples: Example[]; prices: Map<string, Price>; problems: string[] }> {
  const problems: string[] = [];
  const forTopic = `topic.is.null,topic.eq.${topic}`;
  const [termsRead, examplesRead, pricesRead] = await Promise.all([
    db
      .from("terms")
      .select("term, definition, example")
      .or(forTopic)
      .order("priority", { ascending: false })
      .order("term")
      .limit(TERMS_MAX),
    db
      .from("generation_examples")
      .select("image_description, roast, tip, score, explanation")
      .or(forTopic)
      .order("priority", { ascending: false })
      .order("id")
      .limit(EXAMPLES_MAX),
    db
      .from("llm_models")
      .select("provider_model_id, input_usd_per_million, output_usd_per_million, llm_providers!inner(slug)")
      .eq("llm_providers.slug", CALLABLE_PROVIDER)
      .not("input_usd_per_million", "is", null),
  ]).catch((err: unknown) => {
    problems.push(`reading terms, examples and prices failed: ${message(err)}`);
    return [null, null, null] as const;
  });

  if (termsRead?.error) problems.push(`reading terms failed: ${termsRead.error.message}`);
  if (examplesRead?.error) problems.push(`reading examples failed: ${examplesRead.error.message}`);
  if (pricesRead?.error) problems.push(`reading prices failed: ${pricesRead.error.message}`);

  const terms = ((termsRead && !termsRead.error ? termsRead.data : null) ?? []) as Term[];
  const examples = (((examplesRead && !examplesRead.error ? examplesRead.data : null) ?? []) as ExampleRow[]).map(
    (e) => ({
      imageDescription: e.image_description,
      roast: e.roast,
      tip: e.tip,
      score: e.score,
      explanation: e.explanation,
    }),
  );
  const prices = toPrices(((pricesRead && !pricesRead.error ? pricesRead.data : null) ?? []) as PriceRow[]);
  return { terms, examples, prices, problems };
}

export type PromptInputs = { critics: Critic[]; terms: Term[]; examples: Example[]; problems: string[] };

// What a run for this topic would fill the placeholders with: the topic's
// whole panel, its terms and its examples. For the step preview; throws only
// when the admin client can't be made.
export async function loadPromptInputs(topic: Topic): Promise<PromptInputs> {
  const db = await adminDb();
  const [critics, data] = await Promise.all([
    db
      .from("critics")
      .select("id, slug, name, emoji, description")
      .or(`topic.is.null,topic.eq.${topic}`)
      .order("sort_order")
      .overrideTypes<Critic[], { merge: false }>(),
    readPromptData(db, topic),
  ]);
  const problems = [...data.problems];
  if (critics.error) problems.push(`reading the critics failed: ${critics.error.message}`);
  return { critics: critics.data ?? [], terms: data.terms, examples: data.examples, problems };
}

export type RunConfigRead =
  | { ok: true; config: RunConfig }
  | { ok: false; reason: "gone" }
  | { ok: false; reason: "cant_run"; problems: string[] };

// Everything one run of this chain needs for this topic. Unlike a run from the
// main app, it never swaps in another chain: one that can't run is refused,
// with why. Throws when the chain or the panel can't be read.
export async function loadRunConfig(chainId: number, topic: Topic): Promise<RunConfigRead> {
  const db = await adminDb();
  const [read, critics, data] = await Promise.all([readChain(db, chainId), loadPanel(topic), readPromptData(db, topic)]);
  if (!read.chain) {
    return read.missing ? { ok: false, reason: "gone" } : { ok: false, reason: "cant_run", problems: read.problems };
  }

  const unique = [...new Set(data.problems)];
  return {
    ok: true,
    config: {
      chain: read.chain,
      critics,
      terms: data.terms,
      examples: data.examples,
      prices: data.prices,
      problem: unique.length > 0 ? clipText(unique.join("; ")) : null,
    },
  };
}

// The topic's panel as a run gets it, to read a logged answer back. Throws on error.
export async function loadPanel(topic: Topic): Promise<Critic[]> {
  const db = await adminDb();
  const { data, error } = await db
    .from("critics")
    .select("id, slug, name, emoji, description")
    .or(`topic.is.null,topic.eq.${topic}`)
    .order("sort_order")
    .overrideTypes<Critic[], { merge: false }>();
  if (error) throw new Error(`Reading the critics failed: ${error.message}`);
  return data ?? [];
}

type SettingsRow = { daily_budget_usd: number | string | null };

export type Budget = {
  // Spend across everyone in any 24 hours; null = no cap
  dailyBudgetUsd: number | null;
  // What the logged model calls cost in the last 24 hours, every source included
  spentUsd: number;
};

// The main app's daily budget, which runs from here count toward and respect.
// No settings row means no budget. Throws when either read fails, so a run
// never spends money it can't account for.
export async function readBudget(): Promise<Budget> {
  const db = await adminDb();
  const [settings, spend] = await Promise.all([
    db.from("generation_settings").select("daily_budget_usd").maybeSingle<SettingsRow>(),
    db.rpc("llm_spend_since", { p_since: new Date(Date.now() - DAY_MS).toISOString() }),
  ]);
  if (settings.error) throw new Error(`Reading the daily budget failed: ${settings.error.message}`);
  if (spend.error) throw new Error(`Adding up the spend failed: ${spend.error.message}`);

  const raw = settings.data?.daily_budget_usd ?? null;
  const budget = raw === null ? null : Number(raw);
  const spent = Number(spend.data);
  if (!Number.isFinite(spent)) throw new Error("Adding up the spend failed: not a number");
  return { dailyBudgetUsd: budget !== null && Number.isFinite(budget) ? budget : null, spentUsd: spent };
}

// Best effort: a lost log row never breaks a roast
export async function logResponse(requestId: string, log: ResponseLog, db?: Db): Promise<void> {
  try {
    db ??= await adminDb();
    const { error } = await db.from("llm_responses").insert(responseRow(requestId, log));
    if (error) console.warn("Logging a model response failed", error.message);
  } catch (err) {
    unstable_rethrow(err);
    console.warn("Logging a model response failed", message(err));
  }
}

// Best effort, and only from pending, so a finished run is never rewritten
export async function finishRequest(
  requestId: string,
  outcome: {
    status: RequestStatus;
    error: string | null;
    chainId: number | null;
    imageId: string | null;
    roastCount: number;
    durationMs: number;
  },
  db?: Db,
): Promise<void> {
  try {
    db ??= await adminDb();
    const { error } = await db
      .from("generation_requests")
      .update({
        status: outcome.status,
        error: outcome.error === null ? null : clipText(outcome.error),
        prompt_chain_id: outcome.chainId,
        image_id: outcome.imageId,
        roast_count: outcome.roastCount,
        duration_ms: Math.max(0, Math.round(outcome.durationMs)),
        finished_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .eq("status", "pending");
    if (error) console.warn("Finishing the roast request log failed", error.message);
  } catch (err) {
    unstable_rethrow(err);
    console.warn("Finishing the roast request log failed", message(err));
  }
}
