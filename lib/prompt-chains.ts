// Rules for editing prompt chains and their steps. Pure, so they run in tests
// and in the step form; the actions in app/(admin)/prompt-chains apply them
// before any write. Limits match the prompt chains migration, and the step
// changes mirror the functions in the editable chains migration.
import {
  buildVars,
  PLACEHOLDERS,
  placeholdersIn,
  toChain,
  validateChain,
  type Chain,
  type ChainRow,
  type ChainStep,
  type Example,
  type InputType,
  type OutputType,
  type Placeholder,
  type Term,
} from "@/lib/chains";
import { nouns } from "@/lib/format";
import {
  constraintField,
  lengthOk,
  parseId,
  readDecimal,
  readPrompt,
  readText,
  readWhole,
  type FormState,
} from "@/lib/forms";
import type { SearchParams } from "@/lib/params";
import { parseTopic, type Critic, type Topic } from "@/lib/roasts";

export const CHAIN_SLUG_RE = /^[a-z0-9-]{2,40}$/;
export const CHAIN_NAME_MAX = 60;
export const CHAIN_DESCRIPTION_MAX = 300;
export const STEPS_MAX = 10;
export const STEP_DESCRIPTION_MAX = 200;
export const SYSTEM_PROMPT_MAX = 20_000;
export const USER_PROMPT_MAX = 5_000;
export const TEMPERATURE_MAX = 2;
export const TEMPERATURE_PLACES = 2;

export const INPUT_TYPES = ["image", "text"] as const satisfies readonly InputType[];
export const OUTPUT_TYPES = ["text", "roast_json"] as const satisfies readonly OutputType[];

export const INPUT_LABELS: Record<InputType, string> = { image: "Photo and text", text: "Text only" };
export const OUTPUT_LABELS: Record<OutputType, string> = {
  text: "Notes for the next step",
  roast_json: "The reviews (JSON)",
};

type Errors<F extends string> = Partial<Record<F, string>>;
type Result<T, F extends string> = { ok: true; values: T } | { ok: false; errors: Errors<F> };

const done = <T, F extends string>(values: T, errors: Errors<F>): Result<T, F> =>
  Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, values };

// Chains --------------------------------------------------------------------

export type ChainField = "source" | "name" | "slug" | "description";
export type ChainFormState = FormState<ChainField>;

export const CHAIN_RULES: Record<ChainField, string> = {
  source: "Choose a chain to start from, or start blank.",
  name: `Write 1 to ${CHAIN_NAME_MAX} characters.`,
  slug: "Use 2 to 40 lowercase letters, digits or hyphens.",
  description: `Write 1 to ${CHAIN_DESCRIPTION_MAX} characters.`,
};

export const CHAIN_SLUG_TAKEN = "Another chain already uses this slug.";
export const SOURCE_GONE = "That chain no longer exists. Choose another.";

export type ChainDetails = { name: string; description: string };
// The value of "Start from" for a chain with no steps yet
export const BLANK_SOURCE = "blank";
// The arguments copy_prompt_chain takes, minus the p_ prefix. A null source is a
// blank chain, inserted as a plain row instead.
export type ChainCreate = ChainDetails & { source: number | null; slug: string };

function readDetails(fd: FormData, errors: Errors<ChainField>): ChainDetails {
  const name = readText(fd, "name");
  if (!lengthOk(name, 1, CHAIN_NAME_MAX)) errors.name = CHAIN_RULES.name;
  const description = readText(fd, "description");
  if (!lengthOk(description, 1, CHAIN_DESCRIPTION_MAX)) errors.description = CHAIN_RULES.description;
  return { name, description };
}

// Only the name and description: the slug is fixed once the chain exists, like
// a provider's, so a slug field in the form data is ignored, never saved
export function validateChainDetails(fd: FormData): Result<ChainDetails, ChainField> {
  const errors: Errors<ChainField> = {};
  const details = readDetails(fd, errors);
  return done(details, errors);
}

// A new chain is a copy of another one's steps, or blank with none
export function validateChainCreate(fd: FormData): Result<ChainCreate, ChainField> {
  const errors: Errors<ChainField> = {};
  const blank = fd.get("source") === BLANK_SOURCE;
  const source = blank ? null : parseId(fd.get("source"));
  if (!blank && source === null) errors.source = CHAIN_RULES.source;
  const slug = readText(fd, "slug");
  if (!CHAIN_SLUG_RE.test(slug)) errors.slug = CHAIN_RULES.slug;
  const details = readDetails(fd, errors);
  return done({ ...details, source, slug }, errors);
}

// What the new chain form fills the slug in with while the admin hasn't typed
// one: the name in lowercase, with hyphens between the words
export function suggestSlug(name: string): string {
  return name
    .normalize("NFKD")
    // Accents come apart from their letters and are dropped
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

const CHAIN_CONSTRAINTS: Record<string, ChainField> = {
  prompt_chains_slug_key: "slug",
  prompt_chains_slug_format: "slug",
  prompt_chains_name_len: "name",
  prompt_chains_description_len: "description",
};

// The field errors for a 23505 or 23514 a form field can fix, or null
export function chainConstraintErrors(
  error: { code?: string; message?: string } | null | undefined,
): Errors<ChainField> | null {
  const field = constraintField(error, CHAIN_CONSTRAINTS);
  if (!field) return null;
  return { [field]: error?.code === "23505" ? CHAIN_SLUG_TAKEN : CHAIN_RULES[field] };
}

// Steps ---------------------------------------------------------------------

export type StepField =
  | "position"
  | "description"
  | "input_type"
  | "output_type"
  | "llm_model_id"
  | "temperature"
  | "system_prompt"
  | "user_prompt";

// problems: why a live chain refused the change, listed under the message
export type StepFormState = FormState<StepField> & { problems?: string[] };

export const STEP_RULES: Record<StepField, string> = {
  position: `Choose a place from step 1 to step ${STEPS_MAX}.`,
  description: `Write 1 to ${STEP_DESCRIPTION_MAX} characters.`,
  input_type: "Choose what the step sends the model.",
  output_type: "Choose what the step writes.",
  llm_model_id: "Choose a model.",
  temperature: `Use a number from 0 to ${TEMPERATURE_MAX} with at most ${TEMPERATURE_PLACES} decimal places, or leave it empty.`,
  system_prompt: `Write 1 to ${SYSTEM_PROMPT_MAX.toLocaleString("en-US")} characters.`,
  user_prompt: `Write 1 to ${USER_PROMPT_MAX.toLocaleString("en-US")} characters.`,
};

export const MODEL_GONE = "That model no longer exists. Choose another.";

// Named after the columns, which are also the keys insert_prompt_chain_step reads
export type StepValues = {
  description: string;
  input_type: InputType;
  output_type: OutputType;
  llm_model_id: number;
  // null = not sent
  temperature: number | null;
  system_prompt: string;
  user_prompt: string;
};

export type NewStep = { step: StepValues; position: number };

const pick = <T extends string>(allowed: readonly T[], v: unknown): T | undefined => allowed.find((a) => a === v);

function readStep(fd: FormData, errors: Errors<StepField>): StepValues {
  const description = readText(fd, "description");
  if (!lengthOk(description, 1, STEP_DESCRIPTION_MAX)) errors.description = STEP_RULES.description;

  const inputType = pick(INPUT_TYPES, fd.get("input_type"));
  if (!inputType) errors.input_type = STEP_RULES.input_type;
  const outputType = pick(OUTPUT_TYPES, fd.get("output_type"));
  if (!outputType) errors.output_type = STEP_RULES.output_type;

  const modelId = parseId(fd.get("llm_model_id"));
  if (modelId === null) errors.llm_model_id = STEP_RULES.llm_model_id;

  const temperature = readDecimal(fd, "temperature", { min: 0, max: TEMPERATURE_MAX, places: TEMPERATURE_PLACES });
  if (temperature === undefined) errors.temperature = STEP_RULES.temperature;

  // Prompts keep their line breaks (readPrompt), and are counted in code points like char_length
  const systemPrompt = readPrompt(fd, "system_prompt");
  if (!lengthOk(systemPrompt, 1, SYSTEM_PROMPT_MAX)) errors.system_prompt = STEP_RULES.system_prompt;
  const userPrompt = readPrompt(fd, "user_prompt");
  if (!lengthOk(userPrompt, 1, USER_PROMPT_MAX)) errors.user_prompt = STEP_RULES.user_prompt;

  return {
    description,
    input_type: inputType ?? "image",
    output_type: outputType ?? "text",
    llm_model_id: modelId ?? 0,
    temperature: temperature ?? null,
    system_prompt: systemPrompt,
    user_prompt: userPrompt,
  };
}

// An edit. Where the step sits only changes by moving it.
export function validateStep(fd: FormData): Result<StepValues, StepField> {
  const errors: Errors<StepField> = {};
  const step = readStep(fd, errors);
  return done(step, errors);
}

// A new step and where it goes: 1 is first, and past the last step means last
// (insert_prompt_chain_step clamps it the same way)
export function validateNewStep(fd: FormData): Result<NewStep, StepField> {
  const errors: Errors<StepField> = {};
  const position = readWhole(fd, "position", 1, STEPS_MAX + 1);
  if (position === null) errors.position = STEP_RULES.position;
  const step = readStep(fd, errors);
  return done({ step, position: position ?? STEPS_MAX + 1 }, errors);
}

const STEP_CONSTRAINTS: Record<string, StepField> = {
  prompt_chain_steps_description_len: "description",
  prompt_chain_steps_input_type_check: "input_type",
  prompt_chain_steps_output_type_check: "output_type",
  prompt_chain_steps_temperature_range: "temperature",
  prompt_chain_steps_system_prompt_len: "system_prompt",
  prompt_chain_steps_user_prompt_len: "user_prompt",
};

export function stepConstraintErrors(
  error: { code?: string; message?: string } | null | undefined,
): Errors<StepField> | null {
  const field = constraintField(error, STEP_CONSTRAINTS);
  return field ? { [field]: STEP_RULES[field] } : null;
}

// Errors from the chain functions -------------------------------------------

// The codes the editable chains migration raises (P0001, the code as the
// message), plus a second default chain set at the same moment
export const CHAIN_ERROR_CODES = [
  "chain_not_found",
  "step_not_found",
  "chain_full",
  "only_step",
  "bad_direction",
  "default_chain",
  "one_default",
  "stale",
] as const;

export type ChainErrorCode = (typeof CHAIN_ERROR_CODES)[number];

export const CHAIN_ERRORS: Record<ChainErrorCode, string> = {
  chain_not_found: "This chain no longer exists. Go back to the list.",
  step_not_found: "That step no longer exists. Reload the chain to see its steps as they are now.",
  chain_full: `A chain has at most ${STEPS_MAX} steps. Delete one before adding another.`,
  only_step: "A chain needs at least one step, so its only step can’t be deleted.",
  bad_direction: "A step moves one place up or down.",
  default_chain: "This is the default chain, so it can’t be deleted. Make another chain the default first.",
  one_default: "The default chain was changed somewhere else at the same moment. Reload the page and try again.",
  stale: "This chain was changed somewhere else at the same moment. Reload the page, check it, and try again.",
};

export function chainErrorCode(error: { code?: string; message?: string } | null | undefined): ChainErrorCode | null {
  if (!error) return null;
  if (error.code === "P0001") {
    return CHAIN_ERROR_CODES.find((c) => c !== "one_default" && c === error.message?.trim()) ?? null;
  }
  // At most one default (the prompt_chains_one_default index)
  if (error.code === "23505" && /constraint "prompt_chains_one_default"/.test(error.message ?? "")) {
    return "one_default";
  }
  return null;
}

// Step changes --------------------------------------------------------------

type Ordered = { id: number | null; order: number };

export type StepChange<S extends Ordered> =
  | { kind: "insert"; position: number; step: S }
  | { kind: "edit"; id: number; step: S }
  | { kind: "move"; id: number; direction: -1 | 1 }
  | { kind: "delete"; id: number };

export type StepChangeResult<S> =
  | { ok: true; steps: S[] }
  | { ok: false; code: Extract<ChainErrorCode, "chain_full" | "only_step" | "step_not_found"> };

// The steps as they'd be after the change, numbered 1..n, the way the
// migration's functions leave them: an insert lands at its position (clamped
// to 1..n+1) and pushes the later steps down, a move swaps a step with its
// neighbour and does nothing at either end, and a delete closes the gap. An
// 11th step is refused for every chain, live or not.
export function applyStepChange<S extends Ordered>(steps: readonly S[], change: StepChange<S>): StepChangeResult<S> {
  const list = [...steps].sort((a, b) => a.order - b.order || (a.id ?? 0) - (b.id ?? 0));
  const renumbered = (): StepChangeResult<S> => ({ ok: true, steps: list.map((s, i) => ({ ...s, order: i + 1 })) });

  if (change.kind === "insert") {
    if (list.length >= STEPS_MAX) return { ok: false, code: "chain_full" };
    const position = Number.isFinite(change.position) ? Math.trunc(change.position) : list.length + 1;
    const at = Math.min(Math.max(position, 1), list.length + 1);
    list.splice(at - 1, 0, change.step);
    return renumbered();
  }

  const i = list.findIndex((s) => s.id === change.id);
  if (i === -1) return { ok: false, code: "step_not_found" };

  if (change.kind === "edit") {
    list[i] = change.step;
  } else if (change.kind === "move") {
    const j = i + change.direction;
    if (j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]];
  } else {
    if (list.length <= 1) return { ok: false, code: "only_step" };
    list.splice(i, 1);
  }
  return renumbered();
}

// The chain a change would leave, or why the change can't be made
export function changeChain(
  chain: Chain,
  change: StepChange<ChainStep>,
): { ok: true; chain: Chain } | { ok: false; code: ChainErrorCode } {
  const result = applyStepChange(chain.steps, change);
  return result.ok ? { ok: true, chain: { ...chain, steps: result.steps } } : result;
}

// One llm_models row as the chain reads embed it
export type ModelRow = {
  id: number;
  provider_model_id: string;
  is_temperature_supported: boolean;
  thinking_level: string | null;
  llm_providers: { slug: string } | null;
};

// A step's form values as the runner would read them: put through toChain
// itself, so the model's provider, temperature support and thinking level
// come out exactly as on a real run. Null when the runner couldn't use it.
export function toChainStep(values: StepValues, model: ModelRow, id: number | null, order: number): ChainStep | null {
  const row: ChainRow = {
    id: 0,
    slug: "",
    prompt_chain_steps: [
      {
        id: id ?? 0,
        step_order: order,
        input_type: values.input_type,
        output_type: values.output_type,
        temperature: values.temperature,
        system_prompt: values.system_prompt,
        user_prompt: values.user_prompt,
        llm_models: model,
      },
    ],
  };
  const step = toChain(row)?.steps[0];
  return step ? { ...step, id } : null;
}

// Live chains ---------------------------------------------------------------

export type ChainStanding = { isDefault: boolean; weight: number };

// New roasts can reach it: the mix picks it, or it's the backup
export const isLive = (chain: ChainStanding) => chain.isDefault || chain.weight > 0;

export const UNUSABLE_STEP = "A step has no usable model or holds a value the runner doesn’t know.";

// What stops a chain from running, as the runner checks it. Null is a chain
// toChain couldn't read.
export function chainProblems(chain: Chain | null): string[] {
  return chain ? validateChain(chain) : [UNUSABLE_STEP];
}

export const LIVE_REFUSED = "Not saved: this chain is live, and the change would stop it from running.";
export const LIVE_TIP = "Duplicate this chain, change the copy, then make it the default.";

// The safety rule. A change may not stop a live chain that runs now from
// running: the problems it would cause, or none when it can go ahead. Drafts
// save in any state, and runs that pick a live chain that already can't run
// use the default instead, so a change there can only help.
export function liveChangeProblems(standing: ChainStanding, before: Chain | null, after: Chain | null): string[] {
  if (!isLive(standing) || chainProblems(before).length > 0) return [];
  return chainProblems(after);
}

export type ChangeCheck = { ok: true } | { ok: false; code: ChainErrorCode } | { ok: false; problems: string[] };

// Whether a step change may be saved: refused with the code the database
// would raise too, or with the problems it would cause a live chain. A chain
// toChain couldn't read can't run now, so only the database's own checks apply.
export function checkStepChange(standing: ChainStanding, before: Chain | null, change: StepChange<ChainStep>): ChangeCheck {
  if (!before) return { ok: true };
  const changed = changeChain(before, change);
  if (!changed.ok) return changed;
  const problems = liveChangeProblems(standing, before, changed.chain);
  return problems.length > 0 ? { ok: false, problems } : { ok: true };
}

export type StepLock = { up: string[]; down: string[]; remove: string[] };

// For each step of a live chain, what moving or deleting it would break, so
// the page can lock those buttons before the server refuses them. Empty for a
// draft or a chain that can't run anyway.
export function stepLocks(standing: ChainStanding, chain: Chain | null): Map<number, StepLock> {
  const locks = new Map<number, StepLock>();
  if (!chain || !isLive(standing) || chainProblems(chain).length > 0) return locks;
  const after = (change: StepChange<ChainStep>) => {
    const check = checkStepChange(standing, chain, change);
    // only_step: the delete button says so on its own
    return !check.ok && "problems" in check ? check.problems : [];
  };
  for (const step of chain.steps) {
    if (step.id === null) continue;
    locks.set(step.id, {
      up: after({ kind: "move", id: step.id, direction: -1 }),
      down: after({ kind: "move", id: step.id, direction: 1 }),
      remove: after({ kind: "delete", id: step.id }),
    });
  }
  return locks;
}

export type ChainStatus = { tone: "accent" | "neutral" | "danger"; label: string };

// The short status in the lists
export function chainStatus(chain: ChainStanding & { problems: number }): ChainStatus {
  if (chain.problems > 0) return { tone: "danger", label: `Can’t run (${nouns(chain.problems, "problem")})` };
  if (chain.weight > 0) return { tone: "accent", label: `Live · ${chain.weight}%` };
  if (chain.isDefault) return { tone: "accent", label: "Live · backup only" };
  return { tone: "neutral", label: "Draft" };
}

// One sentence on what new roasts do with this chain
export function statusLine(chain: ChainStanding & { problems: number }): string {
  const share = chain.weight === 100 ? "Every new roast" : `${chain.weight}% of new roasts`;
  if (chain.problems > 0) {
    if (chain.isDefault) {
      return "This is the default chain, but it can’t run, so roasts that need it use the one-pass prompt built into the app.";
    }
    return chain.weight > 0
      ? `It can’t run, so the ${chain.weight}% of new roasts that pick it use the default chain instead.`
      : "Draft: it can’t run yet, and no roasts use it.";
  }
  if (chain.isDefault) {
    return chain.weight > 0
      ? `The default chain. ${share} ${chain.weight === 100 ? "uses" : "use"} it, and it’s the backup when a picked chain can’t run.`
      : "The default chain. Chain mix gives it 0%, but it’s the backup when a picked chain can’t run.";
  }
  if (chain.weight > 0) return `Live. ${share} ${chain.weight === 100 ? "uses" : "use"} it.`;
  return "Draft: no roasts use it until you make it the default or give it a share on Chain mix.";
}

// The chain page's query ------------------------------------------------------

// Set by the chain actions' redirects: what went wrong, or what just worked
export const CHAIN_PAGE_ERRORS = {
  ...CHAIN_ERRORS,
  delete: "Couldn’t delete the chain: the database didn’t answer. Try again.",
  has_share: "Couldn’t delete: new roasts still use this chain. Set its share to 0 on Chain mix first.",
  cant_run: "Couldn’t make this the default: it can’t run as it stands. Fix the problems listed below first.",
  make_default: "Couldn’t make this the default: the database didn’t answer. Try again.",
  move: "Couldn’t move the step: the database didn’t answer. Try again.",
  step_delete: "Couldn’t delete the step: the database didn’t answer. Try again.",
  live: LIVE_REFUSED,
} as const satisfies Record<string, string>;

export type ChainPageError = keyof typeof CHAIN_PAGE_ERRORS;

const STEP_NOTICES = ["added", "moved", "deleted"] as const;
export type ChainNotice = "created" | "default" | (typeof STEP_NOTICES)[number];

export type ChainPageQuery = {
  error: ChainPageError | null;
  // With error=live: the change that was refused, and its step
  change: "up" | "down" | "delete" | null;
  target: number | null;
  notice: ChainNotice | null;
  // The preview's topic; null when none was chosen
  topic: Topic | null;
};

const firstParam = (v: unknown) => (Array.isArray(v) ? v[0] : v);

export function parseChainPageQuery(sp: SearchParams): ChainPageQuery {
  const error = firstParam(sp.error);
  const change = firstParam(sp.change);
  const step = firstParam(sp.step);
  const known = typeof error === "string" && Object.hasOwn(CHAIN_PAGE_ERRORS, error) ? (error as ChainPageError) : null;
  let notice: ChainNotice | null = null;
  if (firstParam(sp.created) === "1") notice = "created";
  else if (firstParam(sp.default) === "1") notice = "default";
  else notice = STEP_NOTICES.find((n) => n === step) ?? null;
  return {
    error: known,
    change: change === "up" || change === "down" || change === "delete" ? change : null,
    target: parseId(sp.target),
    // A failure wins over a success flag left in the URL
    notice: known ? null : notice,
    topic: parseTopic(sp.topic),
  };
}

// The change a ?change= names, for showing what it would break
export function refusedChange(change: ChainPageQuery["change"], target: number | null): StepChange<ChainStep> | null {
  if (change === null || target === null) return null;
  return change === "delete" ? { kind: "delete", id: target } : { kind: "move", id: target, direction: change === "up" ? -1 : 1 };
}

// Placeholders --------------------------------------------------------------

const BRACES_RE = /\{\{[^}]*\}\}/g;
const EXACT_RE = /\{\{[a-z_]+\}\}/;

export type PlaceholderReport = {
  // Filled in on every run
  known: Placeholder[];
  // {{name}} in the placeholder shape but not one of them: the chain can't run
  unknown: string[];
  // Anything else in double braces, like {{ note }} or {{Note}}: sent to the
  // model as typed. suggestion is the placeholder it probably meant.
  ignored: { text: string; suggestion: Placeholder | null }[];
};

const isPlaceholder = (key: string): key is Placeholder => (PLACEHOLDERS as readonly string[]).includes(key);

export function placeholderReport(...templates: string[]): PlaceholderReport {
  const report: PlaceholderReport = { known: [], unknown: [], ignored: [] };
  const seen = new Set<string>();
  for (const template of templates) {
    for (const key of placeholdersIn(template)) {
      if (seen.has(key)) continue;
      seen.add(key);
      if (isPlaceholder(key)) report.known.push(key);
      else report.unknown.push(key);
    }
  }
  const ignored = new Set<string>();
  for (const template of templates) {
    for (const [text] of template.matchAll(BRACES_RE)) {
      // {{{note}} still has {{note}} in it, which is filled in
      if (EXACT_RE.test(text) || ignored.has(text)) continue;
      ignored.add(text);
      const guess = text.slice(2, -2).trim().toLowerCase().replace(/\s+/g, "_");
      report.ignored.push({ text, suggestion: isPlaceholder(guess) ? guess : null });
    }
  }
  return report;
}

// What validateChain would say about this step where it sits, so the form can
// warn before saving. The other steps can still break the chain: the chain
// page lists those problems.
export function stepWarnings(step: {
  order: number;
  // It's the chain's last step
  last: boolean;
  outputType: OutputType;
  systemPrompt: string;
  userPrompt: string;
}): string[] {
  const used = new Set([...placeholdersIn(step.systemPrompt), ...placeholdersIn(step.userPrompt)]);
  const warnings: string[] = [];
  if (step.last && step.outputType !== "roast_json") {
    warnings.push("As the last step it must write the reviews.");
  }
  if (!step.last && step.outputType !== "text") {
    warnings.push("Only the last step writes the reviews; this one must write notes for the next step.");
  }
  if (step.order === 1 && used.has("previous")) {
    warnings.push("As step 1 it can’t use {{previous}}: no step runs before it.");
  }
  if (step.outputType === "roast_json" && !used.has("critics")) {
    warnings.push("A step that writes the reviews must list the critics with {{critics}}.");
  }
  return warnings;
}

// Preview -------------------------------------------------------------------

// Stands in for the uploader's note in the preview
export const SAMPLE_NOTE = "First time making this, be honest.";

export const previousStandIn = (order: number) => `(step ${order - 1}’s answer goes here)`;

// What a step's placeholders become in the preview: the topic's real panel,
// terms and examples, a sample note, and a marker where the step before's
// answer would go
export function previewVars(
  inputs: { critics: Critic[]; terms: Term[]; examples: Example[] },
  topic: Topic,
  order: number,
): Record<Placeholder, string> {
  return buildVars(
    { topic, critics: inputs.critics, note: SAMPLE_NOTE, terms: inputs.terms, examples: inputs.examples },
    order > 1 ? previousStandIn(order) : "",
  );
}
