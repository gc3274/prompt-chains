"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import type { ChainStep } from "@/lib/chains";
import { getChainDetail, getStepModel, type ChainDetail } from "@/lib/data/prompts";
import { requireSuperadmin } from "@/lib/dal";
import { DB_DOWN, FIX_FIELDS, isStillReferenced, parseId } from "@/lib/forms";
import { hrefWith } from "@/lib/params";
import {
  CHAIN_ERRORS,
  chainConstraintErrors,
  chainErrorCode,
  checkStepChange,
  isLive,
  LIVE_REFUSED,
  MODEL_GONE,
  SOURCE_GONE,
  stepConstraintErrors,
  toChainStep,
  validateChainCreate,
  validateChainDetails,
  validateNewStep,
  validateStep,
  type ChainFormState,
  type ChangeCheck,
  type ModelRow,
  type StepChange,
  type StepFormState,
} from "@/lib/prompt-chains";
import { adminDb } from "@/lib/supabase/admin";

// Chains and their steps. Steps are inserted, edited, moved and deleted through
// the migration's functions, which lock the chain and renumber in one
// transaction. Each passes the chain's updated_at from the read its check was
// made on, so a change that raced another one is refused (stale) rather than
// applied to a chain it was never checked against. Nothing caches these rows, so every save reaches
// the next roast. A change that would stop a live chain from running is
// refused (lib/prompt-chains.ts checkStepChange); drafts save in any state.

// New objects each time: the forms show a message only when the state changes,
// so a repeated refusal must not come back as the very same object
const chainGone = () => ({ ok: false, message: CHAIN_ERRORS.chain_not_found }) as const;
const stepGone = () => ({ ok: false, message: CHAIN_ERRORS.step_not_found }) as const;
const noModel = (): StepFormState => ({ ok: false, message: FIX_FIELDS, errors: { llm_model_id: MODEL_GONE } });

const LIST = "/prompt-chains";
const chainHref = (id: number) => `${LIST}/${id}`;

// The chain as it is now: null when it's gone, undefined when the read failed
async function readChain(id: number): Promise<ChainDetail | null | undefined> {
  try {
    return await getChainDetail(id);
  } catch (error) {
    unstable_rethrow(error);
    console.error("Reading the prompt chain before changing it failed", error);
    return undefined;
  }
}

async function readModel(id: number): Promise<ModelRow | null | undefined> {
  try {
    return await getStepModel(id);
  } catch (error) {
    unstable_rethrow(error);
    console.error("Reading the step's model failed", error);
    return undefined;
  }
}

// A refused check as the step form's state
function refused(check: Exclude<ChangeCheck, { ok: true }>): StepFormState {
  if ("code" in check) return { ok: false, message: CHAIN_ERRORS[check.code] };
  return { ok: false, message: LIVE_REFUSED, problems: check.problems };
}

// A step write's error: a field the admin can fix, a code from the chain
// functions, or the database being down
function stepWriteFailure(what: string, error: { code?: string; message?: string }): StepFormState {
  const errors = stepConstraintErrors(error);
  if (errors) return { ok: false, message: FIX_FIELDS, errors };
  // The model was deleted after the read above (the chain's own would raise chain_not_found first)
  if (isStillReferenced(error)) return noModel();
  const code = chainErrorCode(error);
  if (code) return { ok: false, message: CHAIN_ERRORS[code] };
  console.error(what, error);
  return { ok: false, message: DB_DOWN };
}

// Chains --------------------------------------------------------------------

// A copy of another chain's steps under a new slug, or a blank chain, with a
// share of 0, so no roast uses it until an admin makes it the default or gives
// it a share
export async function createChain(_prev: ChainFormState, fd: FormData): Promise<ChainFormState> {
  await requireSuperadmin();

  const result = validateChainCreate(fd);
  if (!result.ok) return { ok: false, message: FIX_FIELDS, errors: result.errors };
  const { source, slug, name, description } = result.values;

  const db = await adminDb();
  // A blank chain is one plain row: no steps to copy, and no mix row (a missing one reads as 0%)
  const { data, error } =
    source === null
      ? await db.from("prompt_chains").insert({ slug, name, description }).select("id").single<{ id: number }>()
      : await db.rpc("copy_prompt_chain", {
          p_source: source,
          p_slug: slug,
          p_name: name,
          p_description: description,
        });
  if (error) {
    const errors = chainConstraintErrors(error);
    if (errors) return { ok: false, message: FIX_FIELDS, errors };
    if (chainErrorCode(error) === "chain_not_found") return { ok: false, message: FIX_FIELDS, errors: { source: SOURCE_GONE } };
    console.error("Creating the prompt chain failed", error);
    return { ok: false, message: DB_DOWN };
  }
  const id = parseId(source === null ? data?.id : data);
  if (id === null) {
    console.error("Creating the prompt chain returned no id", data);
    return { ok: false, message: DB_DOWN };
  }

  revalidatePath("/", "layout");
  redirect(hrefWith(chainHref(id), {}, { created: 1 }));
}

// The name and description only: the slug never changes
export async function updateChainDetails(_prev: ChainFormState, fd: FormData): Promise<ChainFormState> {
  await requireSuperadmin();

  const id = parseId(fd.get("id"));
  if (id === null) return chainGone();

  const result = validateChainDetails(fd);
  if (!result.ok) return { ok: false, message: FIX_FIELDS, errors: result.errors };

  const db = await adminDb();
  const { data, error } = await db.from("prompt_chains").update(result.values).eq("id", id).select("id");
  if (error) {
    const errors = chainConstraintErrors(error);
    if (errors) return { ok: false, message: FIX_FIELDS, errors };
    console.error("Saving the prompt chain failed", error);
    return { ok: false, message: DB_DOWN };
  }
  if (!data || data.length === 0) return chainGone();

  revalidatePath("/", "layout");
  return { ok: true, message: "Saved" };
}

type StandingRow = { id: number; is_default: boolean; prompt_chain_mix: { weight: number } | { weight: number }[] | null };

// Refused for the default chain (a trigger backs this up) and for a chain new
// roasts still pick. Its steps and mix row go with it; generation_requests and
// llm_responses keep their prompts and lose only the link (on delete set null).
export async function deleteChain(fd: FormData): Promise<void> {
  await requireSuperadmin();

  const id = parseId(fd.get("id"));
  if (id === null) redirect(hrefWith(LIST, {}, { error: "gone" }));
  const here = chainHref(id);

  const db = await adminDb();
  const { data: row, error: readError } = await db
    .from("prompt_chains")
    .select("id, is_default, prompt_chain_mix(weight)")
    .eq("id", id)
    .maybeSingle<StandingRow>();
  if (readError) {
    console.error("Reading the prompt chain before deleting failed", readError);
    redirect(hrefWith(here, {}, { error: "delete" }));
  }
  if (!row) redirect(hrefWith(LIST, {}, { error: "gone" }));
  const mix = Array.isArray(row.prompt_chain_mix) ? row.prompt_chain_mix[0] : row.prompt_chain_mix;
  if (row.is_default) redirect(hrefWith(here, {}, { error: "default_chain" }));
  if ((mix?.weight ?? 0) > 0) redirect(hrefWith(here, {}, { error: "has_share" }));

  const { data, error } = await db.from("prompt_chains").delete().eq("id", id).select("id");
  if (error) {
    if (chainErrorCode(error) === "default_chain") redirect(hrefWith(here, {}, { error: "default_chain" }));
    console.error("Deleting the prompt chain failed", error);
    redirect(hrefWith(here, {}, { error: "delete" }));
  }
  if (!data || data.length === 0) redirect(hrefWith(LIST, {}, { error: "gone" }));

  revalidatePath("/", "layout");
  redirect(hrefWith(LIST, {}, { deleted: 1 }));
}

// Marks the chain default and gives it every new roast (set_default_prompt_chain
// sets its share to 100 and every other chain's to 0). Only a chain that can run.
export async function setDefaultChain(fd: FormData): Promise<void> {
  await requireSuperadmin();

  const id = parseId(fd.get("id"));
  if (id === null) redirect(hrefWith(LIST, {}, { error: "gone" }));
  const here = chainHref(id);

  const chain = await readChain(id);
  if (chain === undefined) redirect(hrefWith(here, {}, { error: "make_default" }));
  if (chain === null) redirect(hrefWith(LIST, {}, { error: "gone" }));
  if (chain.problems.length > 0) redirect(hrefWith(here, {}, { error: "cant_run" }));

  const db = await adminDb();
  const { error } = await db.rpc("set_default_prompt_chain", { p_chain: id, p_expected: chain.updatedAt });
  if (error) {
    const code = chainErrorCode(error);
    if (code === "chain_not_found") redirect(hrefWith(LIST, {}, { error: "gone" }));
    if (code === "one_default" || code === "stale") redirect(hrefWith(here, {}, { error: code }));
    console.error("Making the prompt chain the default failed", error);
    redirect(hrefWith(here, {}, { error: "make_default" }));
  }

  revalidatePath("/", "layout");
  redirect(hrefWith(here, {}, { default: 1 }));
}

// Steps ---------------------------------------------------------------------

export async function createStep(_prev: StepFormState, fd: FormData): Promise<StepFormState> {
  await requireSuperadmin();

  const chainId = parseId(fd.get("chain"));
  if (chainId === null) return chainGone();

  const result = validateNewStep(fd);
  if (!result.ok) return { ok: false, message: FIX_FIELDS, errors: result.errors };
  const { step, position } = result.values;

  const [chain, model] = await Promise.all([readChain(chainId), readModel(step.llm_model_id)]);
  if (chain === undefined || model === undefined) return { ok: false, message: DB_DOWN };
  if (!chain) return chainGone();
  const added = model && toChainStep(step, model, null, position);
  if (!added) return noModel();

  const check = checkStepChange(chain, chain.runnable, { kind: "insert", position, step: added });
  if (!check.ok) return refused(check);

  const db = await adminDb();
  const { error } = await db.rpc("insert_prompt_chain_step", {
    p_chain: chainId,
    p_position: position,
    p_step: step,
    p_expected: chain.updatedAt,
  });
  if (error) return stepWriteFailure("Adding the step failed", error);

  revalidatePath("/", "layout");
  redirect(hrefWith(chainHref(chainId), {}, { step: "added" }));
}

// Saves the step's settings and prompts; where it sits only changes by moving it
export async function updateStep(_prev: StepFormState, fd: FormData): Promise<StepFormState> {
  await requireSuperadmin();

  const chainId = parseId(fd.get("chain"));
  const stepId = parseId(fd.get("id"));
  if (chainId === null) return chainGone();
  if (stepId === null) return stepGone();

  const result = validateStep(fd);
  if (!result.ok) return { ok: false, message: FIX_FIELDS, errors: result.errors };

  const [chain, model] = await Promise.all([readChain(chainId), readModel(result.values.llm_model_id)]);
  if (chain === undefined || model === undefined) return { ok: false, message: DB_DOWN };
  if (!chain) return chainGone();
  // The step must belong to the chain in the URL
  const current = chain.steps.find((s) => s.id === stepId);
  if (!current) return stepGone();
  const edited = model && toChainStep(result.values, model, stepId, current.order);
  if (!edited) return noModel();

  const check = checkStepChange(chain, chain.runnable, { kind: "edit", id: stepId, step: edited });
  if (!check.ok) return refused(check);

  const db = await adminDb();
  const { error } = await db.rpc("update_prompt_chain_step", {
    p_chain: chainId,
    p_step: stepId,
    p_data: result.values,
    p_expected: chain.updatedAt,
  });
  if (error) return stepWriteFailure("Saving the step failed", error);

  revalidatePath("/", "layout");
  return {
    ok: true,
    message: isLive(chain) ? "Saved. The next roast uses it." : "Saved. This chain is a draft, so no roasts use it yet.",
  };
}

// Where a refused move or delete sends the admin: the database's code, or the
// live-chain refusal with the change, so the page can list what it would break
function refusedHref(here: string, check: Exclude<ChangeCheck, { ok: true }>, change: "up" | "down" | "delete", id: number) {
  return "code" in check
    ? hrefWith(here, {}, { error: check.code })
    : hrefWith(here, {}, { error: "live", change, target: id });
}

// Swaps the step with the one above or below it; nothing happens at either end
export async function moveStep(fd: FormData): Promise<void> {
  await requireSuperadmin();

  const chainId = parseId(fd.get("chain"));
  if (chainId === null) redirect(hrefWith(LIST, {}, { error: "gone" }));
  const here = chainHref(chainId);
  const stepId = parseId(fd.get("id"));
  const way = fd.get("direction");
  if (stepId === null) redirect(hrefWith(here, {}, { error: "step_not_found" }));
  if (way !== "up" && way !== "down") redirect(hrefWith(here, {}, { error: "bad_direction" }));

  const chain = await readChain(chainId);
  if (chain === undefined) redirect(hrefWith(here, {}, { error: "move" }));
  if (chain === null) redirect(hrefWith(LIST, {}, { error: "gone" }));
  if (!chain.steps.some((s) => s.id === stepId)) redirect(hrefWith(here, {}, { error: "step_not_found" }));

  const change: StepChange<ChainStep> = { kind: "move", id: stepId, direction: way === "up" ? -1 : 1 };
  const check = checkStepChange(chain, chain.runnable, change);
  if (!check.ok) redirect(refusedHref(here, check, way, stepId));

  const db = await adminDb();
  const { error } = await db.rpc("move_prompt_chain_step", {
    p_step: stepId,
    p_direction: change.direction,
    p_expected: chain.updatedAt,
  });
  if (error) {
    const code = chainErrorCode(error);
    if (code) redirect(hrefWith(here, {}, { error: code }));
    console.error("Moving the step failed", error);
    redirect(hrefWith(here, {}, { error: "move" }));
  }

  revalidatePath("/", "layout");
  redirect(hrefWith(here, {}, { step: "moved" }));
}

// Deletes the step and closes the gap. A chain keeps at least one step. Its
// logged responses keep the prompts they sent (on delete set null).
export async function deleteStep(fd: FormData): Promise<void> {
  await requireSuperadmin();

  const chainId = parseId(fd.get("chain"));
  if (chainId === null) redirect(hrefWith(LIST, {}, { error: "gone" }));
  const here = chainHref(chainId);
  const stepId = parseId(fd.get("id"));
  if (stepId === null) redirect(hrefWith(here, {}, { error: "step_not_found" }));

  const chain = await readChain(chainId);
  if (chain === undefined) redirect(hrefWith(here, {}, { error: "step_delete" }));
  if (chain === null) redirect(hrefWith(LIST, {}, { error: "gone" }));
  if (!chain.steps.some((s) => s.id === stepId)) redirect(hrefWith(here, {}, { error: "step_not_found" }));
  if (chain.steps.length <= 1) redirect(hrefWith(here, {}, { error: "only_step" }));

  const check = checkStepChange(chain, chain.runnable, { kind: "delete", id: stepId });
  if (!check.ok) redirect(refusedHref(here, check, "delete", stepId));

  const db = await adminDb();
  const { error } = await db.rpc("delete_prompt_chain_step", { p_step: stepId, p_expected: chain.updatedAt });
  if (error) {
    const code = chainErrorCode(error);
    if (code) redirect(hrefWith(here, {}, { error: code }));
    console.error("Deleting the step failed", error);
    redirect(hrefWith(here, {}, { error: "step_delete" }));
  }

  revalidatePath("/", "layout");
  redirect(hrefWith(here, {}, { step: "deleted" }));
}
