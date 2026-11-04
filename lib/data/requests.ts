import "server-only";
import { IMAGE_BUCKET } from "@/lib/captions";
import type { FallbackReason, ResponseStatus } from "@/lib/chains";
import { tally, type CallUsage, type Tally } from "@/lib/limits";
import { emptyPastEnd, MEDIA_PER_PAGE, rangeFor, type MediaQuery } from "@/lib/params";
import type { RequestQuery, RequestSource, RequestStatus } from "@/lib/requests";
import { adminDb } from "@/lib/supabase/admin";

// Reads for the run log: generation_requests (/runs, /media) with their
// llm_responses. Both are written only by the roast pipeline
// (lib/data/generation.ts here, lib/generation.ts in the main app and the
// admin's copy), so there are no writes here. Every read throws on error, so a
// page never shows half-loaded rows as real.

const fail = (what: string, error: { message: string }) => new Error(`${what} failed: ${error.message}`);

type Db = Awaited<ReturnType<typeof adminDb>>;

// numeric(3, 2) and numeric(12, 6) can arrive as strings
const toNumber = (v: number | string | null): number | null => {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// "Ada Lovelace", or null before onboarding. Never falls back to the email:
// profiles.email is user-supplied, so it can't stand in for who someone is.
function fullName(first: string | null, last: string | null): string | null {
  return [first, last].map((v) => v?.trim()).filter(Boolean).join(" ") || null;
}

async function ownerNames(db: Db, ids: string[]): Promise<Map<string, string | null>> {
  const names = new Map<string, string | null>();
  if (ids.length === 0) return names;
  const { data, error } = await db
    .from("profiles")
    .select("id, first_name, last_name")
    .in("id", ids)
    .overrideTypes<{ id: string; first_name: string | null; last_name: string | null }[], { merge: false }>();
  if (error) throw fail("Owners", error);
  for (const p of data ?? []) names.set(p.id, fullName(p.first_name, p.last_name));
  return names;
}

const photoUrl = (db: Db, image: { image_path: string } | null) =>
  image ? db.storage.from(IMAGE_BUCKET).getPublicUrl(image.image_path).data.publicUrl : null;

type RequestListRow = {
  id: string;
  user_id: string;
  source: RequestSource;
  image_id: string | null;
  topic: string | null;
  prompt_chain_id: number | null;
  status: RequestStatus;
  error: string | null;
  roast_count: number;
  duration_ms: number | null;
  created_at: string;
  prompt_chains: { id: number; name: string } | null;
  images: { id: string; image_path: string } | null;
  llm_responses: CallUsage[] | null;
};

export type RequestRow = {
  id: string;
  createdAt: string;
  source: RequestSource;
  status: RequestStatus;
  topic: string | null;
  chainId: number | null;
  // null when the chain was deleted since, or none ran
  chainName: string | null;
  // Read only to tell the built-in chain apart (it notes "config_fallback")
  error: string | null;
  roastCount: number;
  durationMs: number | null;
  imageId: string | null;
  imageUrl: string | null;
  who: { id: string; name: string | null };
  // Its model calls' tokens and the costs they recorded
  usage: Tally;
};

// readAt is when the rows were read, the moment a pending run's age is judged
// against (lib/requests.ts displayStatus)
export async function listRequests(q: RequestQuery): Promise<{ rows: RequestRow[]; total: number; readAt: number }> {
  const db = await adminDb();

  let query = db
    .from("generation_requests")
    .select(
      "id, user_id, source, image_id, topic, prompt_chain_id, status, error, roast_count, duration_ms, created_at, prompt_chains(id, name), images(id, image_path), llm_responses(input_tokens, output_tokens, cost_usd)",
      { count: "exact" },
    );
  if (q.status !== null) query = query.eq("status", q.status);
  if (q.source !== null) query = query.eq("source", q.source);
  if (q.chain !== null) query = query.eq("prompt_chain_id", q.chain);

  const [from, to] = rangeFor(q.page);
  // id last, so pages never overlap when two runs share a timestamp
  const { data, error, count } = emptyPastEnd(
    await query
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to)
      .overrideTypes<RequestListRow[], { merge: false }>(),
  );
  if (error) throw fail("Generation requests", error);
  const readAt = Date.now();

  const rows = data ?? [];
  const names = await ownerNames(db, [...new Set(rows.map((r) => r.user_id))]);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      source: r.source,
      status: r.status,
      topic: r.topic,
      chainId: r.prompt_chain_id,
      chainName: r.prompt_chains?.name ?? null,
      error: r.error,
      roastCount: r.roast_count,
      durationMs: r.duration_ms,
      imageId: r.image_id,
      imageUrl: photoUrl(db, r.images),
      who: { id: r.user_id, name: names.get(r.user_id) ?? null },
      usage: tally(r.llm_responses ?? []),
    })),
    total: count ?? 0,
    readAt,
  };
}

type ResponseSummaryRow = {
  id: string;
  step_order: number;
  provider_model_id: string;
  is_fallback: boolean;
  fallback_reason: FallbackReason | null;
  status: ResponseStatus;
  error: string | null;
  duration_ms: number;
  created_at: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | string | null;
  system_prompt: string;
  user_prompt: string;
  temperature: number | string | null;
  response_text: string | null;
  prompt_chain_steps: { description: string } | null;
};

type RequestDetailRow = Omit<RequestListRow, "prompt_chains" | "llm_responses"> & {
  image_path: string;
  finished_at: string | null;
  prompt_chains: { id: number; name: string; slug: string } | null;
  llm_responses: ResponseSummaryRow[] | null;
};

export type ResponseSummary = {
  id: string;
  stepOrder: number;
  // The step as it is now (steps are edited in place); null when it was deleted
  // since, or for the built-in chain
  step: { description: string } | null;
  providerModelId: string;
  isFallback: boolean;
  fallbackReason: FallbackReason | null;
  status: ResponseStatus;
  error: string | null;
  durationMs: number;
  createdAt: string;
  // null when not recorded: logged before tokens were, or the call never answered.
  // Output includes thinking.
  inputTokens: number | null;
  outputTokens: number | null;
  // null when the model had no price, or nothing was recorded
  costUsd: number | null;
  // Exactly what was sent, and the raw answer (null when none came back)
  systemPrompt: string;
  userPrompt: string;
  temperature: number | null;
  responseText: string | null;
};

// The token and cost columns of a logged call
const usageOf = (r: CallUsage) => ({
  inputTokens: r.input_tokens,
  outputTokens: r.output_tokens,
  costUsd: toNumber(r.cost_usd),
});

export type RequestDetail = RequestRow & {
  // When the row was read, as for listRequests
  readAt: number;
  finishedAt: string | null;
  chainSlug: string | null;
  // Its model calls, in the order they were made
  responses: ResponseSummary[];
};

const byCreated = (a: { created_at: string; id: string }, b: { created_at: string; id: string }) =>
  Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id);

// null when no run has this id, so the page can 404
export async function getRequest(id: string): Promise<RequestDetail | null> {
  const db = await adminDb();
  const { data: row, error } = await db
    .from("generation_requests")
    .select(
      "id, user_id, source, image_path, image_id, topic, prompt_chain_id, status, error, roast_count, duration_ms, created_at, finished_at, prompt_chains(id, name, slug), images(id, image_path), llm_responses(id, step_order, provider_model_id, is_fallback, fallback_reason, status, error, duration_ms, created_at, input_tokens, output_tokens, cost_usd, system_prompt, user_prompt, temperature, response_text, prompt_chain_steps(description))",
    )
    .eq("id", id)
    .maybeSingle<RequestDetailRow>();
  if (error) throw fail("Generation request", error);
  if (!row) return null;
  const readAt = Date.now();

  const names = await ownerNames(db, [row.user_id]);

  return {
    id: row.id,
    readAt,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    source: row.source,
    status: row.status,
    topic: row.topic,
    chainId: row.prompt_chain_id,
    chainName: row.prompt_chains?.name ?? null,
    chainSlug: row.prompt_chains?.slug ?? null,
    error: row.error,
    roastCount: row.roast_count,
    durationMs: row.duration_ms,
    imageId: row.image_id,
    imageUrl: photoUrl(db, row.images),
    who: { id: row.user_id, name: names.get(row.user_id) ?? null },
    usage: tally(row.llm_responses ?? []),
    responses: [...(row.llm_responses ?? [])].sort(byCreated).map((r) => ({
      id: r.id,
      stepOrder: r.step_order,
      step: r.prompt_chain_steps && { description: r.prompt_chain_steps.description },
      providerModelId: r.provider_model_id,
      isFallback: r.is_fallback,
      fallbackReason: r.fallback_reason,
      status: r.status,
      error: r.error,
      durationMs: r.duration_ms,
      createdAt: r.created_at,
      ...usageOf(r),
      systemPrompt: r.system_prompt,
      userPrompt: r.user_prompt,
      temperature: toNumber(r.temperature),
      responseText: r.response_text,
    })),
  };
}

type MediaListRow = Pick<
  RequestListRow,
  "id" | "source" | "image_id" | "topic" | "prompt_chain_id" | "status" | "error" | "created_at" | "prompt_chains" | "images"
> & {
  llm_responses: { id: string; step_order: number; status: ResponseStatus; response_text: string | null; created_at: string }[] | null;
};

export type MediaRow = Pick<
  RequestRow,
  "id" | "createdAt" | "source" | "status" | "topic" | "chainId" | "chainName" | "error" | "imageId" | "imageUrl"
> & {
  // Its model calls in the order they were made, so lib/runs.ts readResult can
  // find the answer that holds the reviews
  responses: { stepOrder: number; status: ResponseStatus; responseText: string | null }[];
};

// What the chains made: runs that succeeded, newest first. Read the same way
// for every source, since a run from Generate keeps its reviews only in the log.
export async function listMedia(q: MediaQuery): Promise<{ rows: MediaRow[]; total: number }> {
  const db = await adminDb();

  let query = db
    .from("generation_requests")
    .select(
      "id, source, image_id, topic, prompt_chain_id, status, error, created_at, prompt_chains(id, name), images(id, image_path), llm_responses(id, step_order, status, response_text, created_at)",
      { count: "exact" },
    )
    .eq("status", "succeeded");
  if (q.chain !== null) query = query.eq("prompt_chain_id", q.chain);

  const [from, to] = rangeFor(q.page, MEDIA_PER_PAGE);
  // id last, so pages never overlap when two runs share a timestamp
  const { data, error, count } = emptyPastEnd(
    await query
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to)
      .overrideTypes<MediaListRow[], { merge: false }>(),
  );
  if (error) throw fail("Media", error);

  return {
    rows: (data ?? []).map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      source: r.source,
      status: r.status,
      topic: r.topic,
      chainId: r.prompt_chain_id,
      chainName: r.prompt_chains?.name ?? null,
      error: r.error,
      imageId: r.image_id,
      imageUrl: photoUrl(db, r.images),
      responses: [...(r.llm_responses ?? [])].sort(byCreated).map((c) => ({
        stepOrder: c.step_order,
        status: c.status,
        responseText: c.response_text,
      })),
    })),
    total: count ?? 0,
  };
}
