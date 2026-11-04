import "server-only";
import { CHAIN_SELECT, toChain, type Chain, type ChainRow, type InputType, type OutputType } from "@/lib/chains";
import { emptyPastEnd, rangeFor } from "@/lib/params";
import { chainProblems, type ModelRow } from "@/lib/prompt-chains";
import type { ChainChoice } from "@/lib/runs";
import { adminDb } from "@/lib/supabase/admin";

// Reads for the prompt chain pages and the chain mix. The writes live in
// app/(admin)/prompt-chains/actions.ts (chains and steps, mostly through the
// migration's functions) and app/(admin)/chain-mix/actions.ts (the mix).
// Nothing here is cached, so an edit reaches the very next roast. Every read
// throws on error, so a page never shows half-loaded rows as real.

const fail = (what: string, error: { message: string }) => new Error(`${what} failed: ${error.message}`);

type MixEmbed = { weight: number; updated_at: string };

// prompt_chain_mix is keyed by the chain id, so PostgREST embeds it as one
// object; an array is read the same way in case it's ever seen as one-to-many
const mixOf = (embed: MixEmbed | MixEmbed[] | null): MixEmbed | null =>
  Array.isArray(embed) ? (embed[0] ?? null) : embed;

// Each chain with its steps read exactly as the runner reads them (CHAIN_SELECT),
// so the problems shown are the ones a run would hit
const WITH_STEPS = `${CHAIN_SELECT}, name, description, is_default, updated_at, prompt_chain_mix(weight, updated_at)`;

type ChainWithSteps = ChainRow & {
  name: string;
  description: string;
  is_default: boolean;
  updated_at: string;
  prompt_chain_mix: MixEmbed | MixEmbed[] | null;
};

export type DefaultChain = { id: number; name: string };

async function readDefault(db: Awaited<ReturnType<typeof adminDb>>): Promise<DefaultChain | null> {
  const { data, error } = await db
    .from("prompt_chains")
    .select("id, name")
    .eq("is_default", true)
    .maybeSingle<DefaultChain>();
  if (error) throw fail("Default chain", error);
  return data;
}

export type ChainSummary = {
  id: number;
  slug: string;
  name: string;
  description: string;
  isDefault: boolean;
  steps: number;
  // Percent of runs; 0 when the chain has no mix row
  weight: number;
  // How many things stop it from running (lib/chains.ts validateChain)
  problems: number;
  updatedAt: string;
};

export async function listChains(
  page: number,
): Promise<{ rows: ChainSummary[]; total: number; defaultChain: DefaultChain | null }> {
  const db = await adminDb();
  const [from, to] = rangeFor(page);
  const [list, defaultChain] = await Promise.all([
    db
      .from("prompt_chains")
      .select(WITH_STEPS, { count: "exact" })
      .order("id")
      .range(from, to)
      .overrideTypes<ChainWithSteps[], { merge: false }>()
      .then(emptyPastEnd),
    readDefault(db),
  ]);
  const { data, error, count } = list;
  if (error) throw fail("Prompt chains", error);

  return {
    rows: (data ?? []).map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      description: c.description,
      isDefault: c.is_default,
      steps: c.prompt_chain_steps?.length ?? 0,
      weight: mixOf(c.prompt_chain_mix)?.weight ?? 0,
      problems: chainProblems(toChain(c)).length,
      updatedAt: c.updated_at,
    })),
    total: count ?? 0,
    defaultChain,
  };
}

type StepRow = {
  id: number;
  step_order: number;
  description: string;
  input_type: string;
  output_type: string;
  // numeric(3, 2)
  temperature: number | string | null;
  system_prompt: string;
  user_prompt: string;
  llm_models: {
    id: number;
    name: string;
    provider_model_id: string;
    is_temperature_supported: boolean;
    thinking_level: string | null;
    llm_providers: { id: number; name: string; slug: string } | null;
  } | null;
};

type ChainDetailRow = {
  id: number;
  slug: string;
  name: string;
  description: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  prompt_chain_mix: MixEmbed | MixEmbed[] | null;
  prompt_chain_steps: StepRow[] | null;
};

export type StepModel = {
  id: number;
  name: string;
  providerModelId: string;
  temperatureSupported: boolean;
  thinkingLevel: string | null;
  provider: { id: number; name: string; slug: string } | null;
};

export type StepDetail = {
  id: number;
  order: number;
  description: string;
  inputType: InputType | null;
  outputType: OutputType | null;
  temperature: number | null;
  systemPrompt: string;
  userPrompt: string;
  // The foreign key is not null and restricts deletes, so this is only a safety net
  model: StepModel | null;
};

export type ChainDetail = {
  id: number;
  slug: string;
  name: string;
  description: string;
  isDefault: boolean;
  weight: number;
  createdAt: string;
  updatedAt: string;
  steps: StepDetail[];
  // The chain as the runner reads it, or null when a step has no usable model
  runnable: Chain | null;
  // What stops the runner from using this chain (lib/chains.ts validateChain).
  // A run that picks it falls back to the default chain, or the built-in one.
  problems: string[];
  // The chain runs fall back to; null when no chain is marked default
  defaultChain: DefaultChain | null;
};

const inputType = (v: string): InputType | null => (v === "image" || v === "text" ? v : null);
const outputType = (v: string): OutputType | null => (v === "text" || v === "roast_json" ? v : null);

// null when no chain has this id, so the page can 404. The step actions read
// it too, to check a change against the chain as it is now.
export async function getChainDetail(id: number): Promise<ChainDetail | null> {
  const db = await adminDb();
  const [read, defaultChain] = await Promise.all([
    db
      .from("prompt_chains")
      .select(
        "id, slug, name, description, is_default, created_at, updated_at, prompt_chain_mix(weight, updated_at), prompt_chain_steps(id, step_order, description, input_type, output_type, temperature, system_prompt, user_prompt, llm_models(id, name, provider_model_id, is_temperature_supported, thinking_level, llm_providers(id, name, slug)))",
      )
      .eq("id", id)
      .maybeSingle<ChainDetailRow>(),
    readDefault(db),
  ]);
  const { data: row, error } = read;
  if (error) throw fail("Prompt chain", error);
  if (!row) return null;

  const stepRows = [...(row.prompt_chain_steps ?? [])].sort((a, b) => a.step_order - b.step_order || a.id - b.id);
  // The same checks the runner makes before it uses a chain
  const runnable = toChain({ id: row.id, slug: row.slug, prompt_chain_steps: stepRows });

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    isDefault: row.is_default,
    weight: mixOf(row.prompt_chain_mix)?.weight ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    runnable,
    problems: chainProblems(runnable),
    defaultChain,
    steps: stepRows.map((s) => {
      const temperature = s.temperature === null ? null : Number(s.temperature);
      const m = s.llm_models;
      return {
        id: s.id,
        order: s.step_order,
        description: s.description,
        inputType: inputType(s.input_type),
        outputType: outputType(s.output_type),
        temperature: temperature !== null && Number.isFinite(temperature) ? temperature : null,
        systemPrompt: s.system_prompt,
        userPrompt: s.user_prompt,
        model: m && {
          id: m.id,
          name: m.name,
          providerModelId: m.provider_model_id,
          temperatureSupported: m.is_temperature_supported,
          thinkingLevel: m.thinking_level,
          provider: m.llm_providers,
        },
      };
    }),
  };
}

export type MixChain = {
  id: number;
  slug: string;
  name: string;
  description: string;
  isDefault: boolean;
  weight: number;
  // Why it can't run; a chain with any may only have 0
  problems: string[];
};

// Every chain, for the one mix form. updatedAt is the newest change to any weight.
export async function listMix(): Promise<{ chains: MixChain[]; updatedAt: string | null }> {
  const db = await adminDb();
  const { data, error } = await db
    .from("prompt_chains")
    .select(WITH_STEPS)
    .order("id")
    .overrideTypes<ChainWithSteps[], { merge: false }>();
  if (error) throw fail("Chain mix", error);

  const chains: MixChain[] = [];
  let updatedAt: string | null = null;
  for (const c of data ?? []) {
    const mix = mixOf(c.prompt_chain_mix);
    chains.push({
      id: c.id,
      slug: c.slug,
      name: c.name,
      description: c.description,
      isDefault: c.is_default,
      weight: mix?.weight ?? 0,
      problems: chainProblems(toChain(c)),
    });
    if (mix && (updatedAt === null || Date.parse(mix.updated_at) > Date.parse(updatedAt))) updatedAt = mix.updated_at;
  }
  return { chains, updatedAt };
}

export type ChainOption = { id: number; name: string };

// The chain filter on /runs
export async function listChainOptions(): Promise<ChainOption[]> {
  const db = await adminDb();
  const { data, error } = await db
    .from("prompt_chains")
    .select("id, name")
    .order("name")
    .order("id")
    .overrideTypes<ChainOption[], { merge: false }>();
  if (error) throw fail("Prompt chain options", error);
  return data ?? [];
}

// The chain picker on /generate: every chain, with how many things stop it running
export async function listChainChoices(): Promise<ChainChoice[]> {
  const db = await adminDb();
  const { data, error } = await db
    .from("prompt_chains")
    .select(WITH_STEPS)
    .order("name")
    .order("id")
    .overrideTypes<ChainWithSteps[], { merge: false }>();
  if (error) throw fail("Prompt chains to run", error);
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    isDefault: c.is_default,
    problems: chainProblems(toChain(c)).length,
  }));
}

export type ChainSource = { id: number; name: string; isDefault: boolean };

// The "Start from" choices on the new chain form
export async function listChainSources(): Promise<ChainSource[]> {
  const db = await adminDb();
  const { data, error } = await db
    .from("prompt_chains")
    .select("id, name, is_default")
    .order("name")
    .order("id")
    .overrideTypes<{ id: number; name: string; is_default: boolean }[], { merge: false }>();
  if (error) throw fail("Prompt chains to copy", error);
  return (data ?? []).map((c) => ({ id: c.id, name: c.name, isDefault: c.is_default }));
}

export type ModelChoice = {
  id: number;
  name: string;
  providerModelId: string;
  temperatureSupported: boolean;
  provider: { name: string; slug: string } | null;
};

type ModelChoiceRow = {
  id: number;
  name: string;
  provider_model_id: string;
  is_temperature_supported: boolean;
  llm_providers: { name: string; slug: string } | null;
};

// Every model, for the step form's select
export async function listModelChoices(): Promise<ModelChoice[]> {
  const db = await adminDb();
  const { data, error } = await db
    .from("llm_models")
    .select("id, name, provider_model_id, is_temperature_supported, llm_providers(name, slug)")
    .order("name")
    .order("id")
    .overrideTypes<ModelChoiceRow[], { merge: false }>();
  if (error) throw fail("Models", error);
  return (data ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    providerModelId: m.provider_model_id,
    temperatureSupported: m.is_temperature_supported,
    provider: m.llm_providers,
  }));
}

// One model as a step would call it (lib/prompt-chains.ts toChainStep); null
// when it's gone
export async function getStepModel(id: number): Promise<ModelRow | null> {
  const db = await adminDb();
  const { data, error } = await db
    .from("llm_models")
    .select("id, provider_model_id, is_temperature_supported, thinking_level, llm_providers(slug)")
    .eq("id", id)
    .maybeSingle<ModelRow>();
  if (error) throw fail("Step model", error);
  return data;
}
