"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { IMAGE_BUCKET, IMAGE_MAX_BYTES } from "@/lib/captions";
import { RUN_BUDGET_MS } from "@/lib/chains";
import {
  finishRequest,
  loadRunConfig,
  logResponse,
  readBudget,
  startRequest,
  type RequestStatus,
  type RunConfig,
} from "@/lib/data/generation";
import { requireSuperadmin } from "@/lib/dal";
import { generateRoasts } from "@/lib/gemini";
import { parseTopic, type Topic } from "@/lib/roasts";
import { budgetRefusal, GENERATE_ERRORS, isJpeg, parseRunForm, RUN_ERRORS, type RunInput, type RunState } from "@/lib/runs";
import { adminDb } from "@/lib/supabase/admin";

type Photo = { id: string; image_path: string; topic: Topic; context: string | null };

type Db = Awaited<ReturnType<typeof adminDb>>;

// Ready to call the model, or why not. Nothing is logged for a refusal: no
// model was called and no money was spent. db is gated once here and reused
// for every write of the run, so a gate check can't fail partway through it.
type Prepared = { ok: true; db: Db; photo: Photo; config: RunConfig } | { ok: false; state: RunState };

const PHOTO_MB = IMAGE_MAX_BYTES / (1024 * 1024);

const refuse = (error: string, problems?: string[]): Prepared => ({ ok: false, state: { error, problems } });

async function prepare(input: RunInput): Promise<Prepared> {
  const db = await adminDb();
  const { data: row, error } = await db
    .from("images")
    .select("id, image_path, topic, context")
    .eq("id", input.imageId)
    .maybeSingle<{ id: string; image_path: string; topic: string | null; context: string | null }>();
  if (error) {
    console.error("Reading the photo failed", error);
    return refuse(RUN_ERRORS.dbDown);
  }
  if (!row) return refuse(RUN_ERRORS.photoGone);
  const topic = parseTopic(row.topic);
  if (!topic) return refuse(RUN_ERRORS.legacy);

  const read = await loadRunConfig(input.chainId, topic);
  if (!read.ok) return read.reason === "gone" ? refuse(RUN_ERRORS.chainGone) : refuse(RUN_ERRORS.cantRun, read.problems);
  if (read.config.critics.length === 0) return refuse(RUN_ERRORS.noCritics);

  let refusal: string | null;
  try {
    refusal = budgetRefusal(await readBudget());
  } catch (err) {
    unstable_rethrow(err);
    console.error("Checking the daily budget failed", err);
    refusal = RUN_ERRORS.budgetUnknown;
  }
  if (refusal) return refuse(refusal);

  return { ok: true, db, photo: { ...row, topic }, config: read.config };
}

// What the request log records about the run once it has started
type Run = { status: RequestStatus; detail: string | null };

// Everything after the log row is written. Its failures land in run; anything
// it throws is caught by the caller, which finishes the log row first.
async function callModel(db: Db, requestId: string, photo: Photo, config: RunConfig, startedAt: number, run: Run) {
  const fail = (detail: string) => {
    run.detail = detail;
  };

  const { data: file, error: downloadError } = await db.storage.from(IMAGE_BUCKET).download(photo.image_path);
  if (downloadError || !file) {
    console.error("Downloading the photo failed", downloadError?.message ?? "no data");
    return fail("The photo couldn't be downloaded.");
  }
  if (file.size > IMAGE_MAX_BYTES) return fail(`The photo is over ${PHOTO_MB} MB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isJpeg(bytes)) return fail("The file isn't a JPEG.");

  const result = await generateRoasts({
    chain: config.chain,
    context: {
      topic: photo.topic,
      critics: config.critics,
      note: photo.context ?? "",
      terms: config.terms,
      examples: config.examples,
    },
    image: { data: Buffer.from(bytes).toString("base64"), mimeType: "image/jpeg" },
    deadline: startedAt + RUN_BUDGET_MS,
    onResponse: (log) => logResponse(requestId, log, db),
    prices: config.prices,
  });
  if (!result.ok) {
    if (result.reason !== "not_configured") run.status = result.reason;
    return fail(`${GENERATE_ERRORS[result.reason]} ${result.error}`);
  }
  run.status = "succeeded";
}

// One chain on one photo, for the photo topic's whole panel, as a post from the
// main app would run. The reviews are never saved as roasts: they stay on the
// run's page, read back from the log. Logged in generation_requests as source
// 'admin' under the admin, so it never spends anyone's daily posts; its model
// calls do count toward the daily budget. /generate sets maxDuration for them.
export async function runChain(_prev: RunState, fd: FormData): Promise<RunState> {
  const { userId } = await requireSuperadmin();
  // The model calls' time budget counts from here
  const startedAt = Date.now();

  const parsed = parseRunForm(fd);
  if (!parsed.ok) return { error: parsed.error };

  let prepared: Prepared;
  try {
    prepared = await prepare(parsed.input);
  } catch (error) {
    unstable_rethrow(error);
    console.error("Preparing the run failed", error);
    return { error: RUN_ERRORS.dbDown };
  }
  if (!prepared.ok) return prepared.state;
  const { db, photo, config } = prepared;

  // Logged before the model is called, like a run from the main app
  const requestId = await startRequest(
    { userId, imagePath: photo.image_path, imageId: photo.id, topic: photo.topic },
    db,
  );
  if (!requestId) return { error: RUN_ERRORS.logFailed };

  const run: Run = { status: "failed", detail: null };
  let thrown: { error: unknown } | null = null;
  try {
    await callModel(db, requestId, photo, config, startedAt, run);
  } catch (error) {
    thrown = { error };
    run.status = "failed";
    run.detail = `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
  }

  const notes = [run.detail, config.problem].filter(Boolean);
  await finishRequest(
    requestId,
    {
      status: run.status,
      error: notes.length > 0 ? notes.join(" ") : null,
      chainId: config.chain.id,
      imageId: photo.id,
      // Nothing is saved as a roast
      roastCount: 0,
      durationMs: Date.now() - startedAt,
    },
    db,
  );
  if (thrown) {
    // Only now that the run is finished in the log: a redirect or other Next.js signal goes on
    unstable_rethrow(thrown.error);
    console.error("Running the chain failed", thrown.error);
  }

  revalidatePath("/", "layout");
  // Outside the try: redirect() works by throwing. A failed run's page shows how far it got.
  redirect(`/runs/${requestId}?ran=1`);
}
