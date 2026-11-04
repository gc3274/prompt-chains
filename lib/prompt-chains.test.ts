import { describe, expect, it } from "vitest";
import { DEFAULT_CHAIN, PLACEHOLDERS, renderTemplate, validateChain, type Chain, type ChainStep } from "@/lib/chains";
import {
  applyStepChange,
  CHAIN_DESCRIPTION_MAX,
  CHAIN_ERROR_CODES,
  CHAIN_ERRORS,
  CHAIN_NAME_MAX,
  CHAIN_PAGE_ERRORS,
  CHAIN_RULES,
  CHAIN_SLUG_RE,
  CHAIN_SLUG_TAKEN,
  chainConstraintErrors,
  chainErrorCode,
  chainProblems,
  chainStatus,
  changeChain,
  checkStepChange,
  INPUT_TYPES,
  isLive,
  liveChangeProblems,
  OUTPUT_TYPES,
  parseChainPageQuery,
  placeholderReport,
  previewVars,
  previousStandIn,
  refusedChange,
  SAMPLE_NOTE,
  statusLine,
  suggestSlug,
  STEP_DESCRIPTION_MAX,
  STEP_RULES,
  stepConstraintErrors,
  stepLocks,
  STEPS_MAX,
  stepWarnings,
  SYSTEM_PROMPT_MAX,
  TEMPERATURE_MAX,
  TEMPERATURE_PLACES,
  toChainStep,
  UNUSABLE_STEP,
  USER_PROMPT_MAX,
  validateChainCreate,
  validateChainDetails,
  validateNewStep,
  validateStep,
  type ModelRow,
  type StepValues,
} from "@/lib/prompt-chains";

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

// Copied from 20261028120000_prompt_chains_and_observability.sql and
// 20261104120000_editable_chains_limits_costs.sql
const SQL = {
  slug: "^[a-z0-9-]{2,40}$",
  nameMax: 60,
  descriptionMax: 300,
  stepOrderMax: 10,
  stepDescriptionMax: 200,
  inputTypes: ["image", "text"],
  outputTypes: ["text", "roast_json"],
  temperatureMax: 2,
  // numeric(3, 2)
  temperaturePlaces: 2,
  systemPromptMax: 20000,
  userPromptMax: 5000,
  codes: ["chain_not_found", "step_not_found", "chain_full", "only_step", "bad_direction", "default_chain", "stale"],
};

// How Postgres words a unique (23505) or check (23514) violation
const violation = (code: string, constraint: string, table = "prompt_chains") => ({
  code,
  message:
    code === "23505"
      ? `duplicate key value violates unique constraint "${constraint}"`
      : `new row for relation "${table}" violates check constraint "${constraint}"`,
});

const STEP_FORM = {
  description: "Roast the photo",
  input_type: "image",
  output_type: "roast_json",
  llm_model_id: "3",
  temperature: "1",
  system_prompt: "Critics:\n{{critics}}",
  user_prompt: "Roast this.{{note}}",
};

const GEMINI: ModelRow = {
  id: 3,
  provider_model_id: "gemini-3.5-flash",
  is_temperature_supported: true,
  thinking_level: "minimal",
  llm_providers: { slug: "google" },
};

const step = (id: number, order: number, extra: Partial<ChainStep> = {}): ChainStep => ({
  ...DEFAULT_CHAIN.steps[0],
  id,
  order,
  ...extra,
});

const notes = (id: number, order: number, extra: Partial<ChainStep> = {}) =>
  step(id, order, { outputType: "text", systemPrompt: "Look closely at the photo.", userPrompt: "Notes, please.", ...extra });

const chainOf = (...steps: ChainStep[]): Chain => ({ id: 7, slug: "test", steps });

// Look, then roast: notes first, then the reviews
const twoStep = () =>
  chainOf(notes(11, 1), step(12, 2, { systemPrompt: "Notes:\n{{previous}}\nCritics:\n{{critics}}" }));

const orders = (steps: { id: number | null; order: number }[]) => steps.map((s) => [s.id, s.order]);

describe("parity with the migrations", () => {
  it("uses the same patterns and limits as the checks", () => {
    expect(CHAIN_SLUG_RE.source).toBe(SQL.slug);
    expect(CHAIN_NAME_MAX).toBe(SQL.nameMax);
    expect(CHAIN_DESCRIPTION_MAX).toBe(SQL.descriptionMax);
    expect(STEPS_MAX).toBe(SQL.stepOrderMax);
    expect(STEP_DESCRIPTION_MAX).toBe(SQL.stepDescriptionMax);
    expect([...INPUT_TYPES]).toEqual(SQL.inputTypes);
    expect([...OUTPUT_TYPES]).toEqual(SQL.outputTypes);
    expect(TEMPERATURE_MAX).toBe(SQL.temperatureMax);
    expect(TEMPERATURE_PLACES).toBe(SQL.temperaturePlaces);
    expect(SYSTEM_PROMPT_MAX).toBe(SQL.systemPromptMax);
    expect(USER_PROMPT_MAX).toBe(SQL.userPromptMax);
  });

  it("knows every code the chain functions raise", () => {
    for (const code of SQL.codes) {
      expect(CHAIN_ERROR_CODES).toContain(code);
      expect(chainErrorCode({ code: "P0001", message: code })).toBe(code);
    }
  });

  it.each([
    ["one-pass", true],
    ["look-then-roast", true],
    ["v2", true],
    ["a".repeat(40), true],
    ["a", false],
    ["a".repeat(41), false],
    ["One-pass", false],
    ["one_pass", false],
    ["one pass", false],
    ["", false],
  ])("slug %j is %s", (slug, ok) => {
    expect(CHAIN_SLUG_RE.test(slug)).toBe(ok);
  });
});

describe("validateChainCreate", () => {
  const create = (extra: Record<string, string> = {}) =>
    validateChainCreate(
      form({ source: "1", slug: "one-pass-v2", name: "One pass, v2", description: "Tries a shorter prompt.", ...extra }),
    );

  it("reads a copy of a chain", () => {
    expect(create()).toEqual({
      ok: true,
      values: { source: 1, slug: "one-pass-v2", name: "One pass, v2", description: "Tries a shorter prompt." },
    });
  });

  it("collapses whitespace in the name and description", () => {
    expect(create({ name: "  One   pass ", description: "Two\nlines" })).toMatchObject({
      ok: true,
      values: { name: "One pass", description: "Two lines" },
    });
  });

  it("measures the name and description in code points, like char_length", () => {
    expect(create({ name: "🔥".repeat(CHAIN_NAME_MAX) }).ok).toBe(true);
    expect(create({ name: "🔥".repeat(CHAIN_NAME_MAX + 1) })).toEqual({
      ok: false,
      errors: { name: CHAIN_RULES.name },
    });
    expect(create({ description: "x".repeat(CHAIN_DESCRIPTION_MAX + 1) })).toEqual({
      ok: false,
      errors: { description: CHAIN_RULES.description },
    });
  });

  it("marks every bad field at once", () => {
    expect(create({ source: "0", slug: "Bad Slug", name: " ", description: "" })).toEqual({
      ok: false,
      errors: {
        source: CHAIN_RULES.source,
        slug: CHAIN_RULES.slug,
        name: CHAIN_RULES.name,
        description: CHAIN_RULES.description,
      },
    });
  });

  it.each(["", "abc", "-1", "1.5"])("refuses %j as the chain to start from", (source) => {
    expect(create({ source })).toEqual({ ok: false, errors: { source: CHAIN_RULES.source } });
  });
});

describe("suggestSlug", () => {
  it.each([
    ["One pass, v2", "one-pass-v2"],
    ["  Look, then roast!  ", "look-then-roast"],
    ["Crème brûlée test", "creme-brulee-test"],
    ["🔥 Spicy 🔥", "spicy"],
    ["a".repeat(39) + " b", "a".repeat(39)],
    ["", ""],
  ])("turns %j into %j", (name, slug) => {
    expect(suggestSlug(name)).toBe(slug);
  });

  it("only ever suggests a valid slug or nothing", () => {
    for (const name of ["Short", "x", "Ünïcödé chain", "-- dashes --", "x".repeat(80)]) {
      const slug = suggestSlug(name);
      expect(slug === "" || slug.length < 2 || CHAIN_SLUG_RE.test(slug)).toBe(true);
    }
  });
});

describe("validateChainDetails", () => {
  it("reads the name and description only, never a slug", () => {
    expect(validateChainDetails(form({ name: "One pass", description: "One call.", slug: "new-slug" }))).toEqual({
      ok: true,
      values: { name: "One pass", description: "One call." },
    });
  });

  it("marks an empty name or description", () => {
    expect(validateChainDetails(form({ name: "", description: "" }))).toEqual({
      ok: false,
      errors: { name: CHAIN_RULES.name, description: CHAIN_RULES.description },
    });
  });
});

describe("chainConstraintErrors", () => {
  it("turns a taken slug into a slug error", () => {
    expect(chainConstraintErrors(violation("23505", "prompt_chains_slug_key"))).toEqual({ slug: CHAIN_SLUG_TAKEN });
  });

  it.each([
    ["prompt_chains_slug_format", "slug"],
    ["prompt_chains_name_len", "name"],
    ["prompt_chains_description_len", "description"],
  ] as const)("turns %s into the %s rule", (constraint, field) => {
    expect(chainConstraintErrors(violation("23514", constraint))).toEqual({ [field]: CHAIN_RULES[field] });
  });

  it("leaves the one-default index and other errors to the caller", () => {
    expect(chainConstraintErrors(violation("23505", "prompt_chains_one_default"))).toBeNull();
    expect(chainConstraintErrors({ code: "P0001", message: "chain_not_found" })).toBeNull();
    expect(chainConstraintErrors(null)).toBeNull();
  });
});

describe("validateStep", () => {
  it("reads a step", () => {
    expect(validateStep(form(STEP_FORM))).toEqual({
      ok: true,
      values: {
        description: "Roast the photo",
        input_type: "image",
        output_type: "roast_json",
        llm_model_id: 3,
        temperature: 1,
        system_prompt: "Critics:\n{{critics}}",
        user_prompt: "Roast this.{{note}}",
      },
    });
  });

  it("keeps the prompts' line breaks, turning Windows endings into \\n", () => {
    const result = validateStep(form({ ...STEP_FORM, system_prompt: "  Line one\r\n\r\n  - two\r\n" }));
    expect(result).toMatchObject({ ok: true, values: { system_prompt: "Line one\n\n  - two" } });
  });

  it.each([
    ["", null],
    ["0", 0],
    ["0.05", 0.05],
    ["1.25", 1.25],
    ["2", 2],
  ])("reads temperature %j as %j (blank is not sent)", (temperature, expected) => {
    expect(validateStep(form({ ...STEP_FORM, temperature }))).toMatchObject({ ok: true, values: { temperature: expected } });
  });

  it.each(["2.01", "-0.5", "1.255", "abc", "1e0", "3"])("marks temperature %j", (temperature) => {
    expect(validateStep(form({ ...STEP_FORM, temperature }))).toEqual({
      ok: false,
      errors: { temperature: STEP_RULES.temperature },
    });
  });

  it("holds the prompts to their code point limits", () => {
    const at = { system_prompt: "🔥".repeat(SYSTEM_PROMPT_MAX), user_prompt: "🔥".repeat(USER_PROMPT_MAX) };
    expect(validateStep(form({ ...STEP_FORM, ...at })).ok).toBe(true);
    const over = { system_prompt: `${at.system_prompt}x`, user_prompt: `${at.user_prompt}x` };
    expect(validateStep(form({ ...STEP_FORM, ...over }))).toEqual({
      ok: false,
      errors: { system_prompt: STEP_RULES.system_prompt, user_prompt: STEP_RULES.user_prompt },
    });
  });

  it("marks every bad field at once", () => {
    const bad = {
      description: " ",
      input_type: "video",
      output_type: "json",
      llm_model_id: "x",
      temperature: "9",
      system_prompt: " \n ",
      user_prompt: "",
    };
    expect(validateStep(form(bad))).toEqual({
      ok: false,
      errors: {
        description: STEP_RULES.description,
        input_type: STEP_RULES.input_type,
        output_type: STEP_RULES.output_type,
        llm_model_id: STEP_RULES.llm_model_id,
        temperature: STEP_RULES.temperature,
        system_prompt: STEP_RULES.system_prompt,
        user_prompt: STEP_RULES.user_prompt,
      },
    });
  });

  it("ignores a position: an edit never moves a step", () => {
    expect(validateStep(form({ ...STEP_FORM, position: "99" })).ok).toBe(true);
  });
});

describe("validateNewStep", () => {
  it.each([
    ["1", 1],
    ["5", 5],
    [String(STEPS_MAX + 1), STEPS_MAX + 1],
  ])("reads position %j", (position, expected) => {
    expect(validateNewStep(form({ ...STEP_FORM, position }))).toMatchObject({ ok: true, values: { position: expected } });
  });

  it.each(["", "0", String(STEPS_MAX + 2), "1.5", "first"])("marks position %j", (position) => {
    expect(validateNewStep(form({ ...STEP_FORM, position }))).toEqual({
      ok: false,
      errors: { position: STEP_RULES.position },
    });
  });
});

describe("stepConstraintErrors", () => {
  it.each([
    ["prompt_chain_steps_description_len", "description"],
    ["prompt_chain_steps_input_type_check", "input_type"],
    ["prompt_chain_steps_output_type_check", "output_type"],
    ["prompt_chain_steps_temperature_range", "temperature"],
    ["prompt_chain_steps_system_prompt_len", "system_prompt"],
    ["prompt_chain_steps_user_prompt_len", "user_prompt"],
  ] as const)("turns %s into the %s rule", (constraint, field) => {
    expect(stepConstraintErrors(violation("23514", constraint, "prompt_chain_steps"))).toEqual({
      [field]: STEP_RULES[field],
    });
  });

  it("leaves the order checks and foreign keys to the caller", () => {
    expect(stepConstraintErrors(violation("23514", "prompt_chain_steps_order_range", "prompt_chain_steps"))).toBeNull();
    expect(stepConstraintErrors({ code: "23503", message: "violates foreign key constraint" })).toBeNull();
  });
});

describe("chainErrorCode", () => {
  it("reads the second default from the unique index", () => {
    expect(chainErrorCode(violation("23505", "prompt_chains_one_default"))).toBe("one_default");
  });

  it("has a message for every code", () => {
    for (const code of CHAIN_ERROR_CODES) expect(CHAIN_ERRORS[code]).toBeTruthy();
  });

  it.each([
    [null],
    [{ code: "P0001", message: "something_else" }],
    [{ code: "P0001", message: "one_default" }],
    [violation("23505", "prompt_chains_slug_key")],
    [{ code: "08006", message: "connection failure" }],
  ])("is null for %j", (error) => {
    expect(chainErrorCode(error)).toBeNull();
  });
});

describe("applyStepChange", () => {
  const three = [notes(1, 1), notes(2, 2), step(3, 3)];
  const fresh = () => notes(0, 0, { id: null });

  it.each([
    [1, [[null, 1], [1, 2], [2, 3], [3, 4]]],
    [2, [[1, 1], [null, 2], [2, 3], [3, 4]]],
    [4, [[1, 1], [2, 2], [3, 3], [null, 4]]],
    // Clamped to 1..n+1, like insert_prompt_chain_step
    [0, [[null, 1], [1, 2], [2, 3], [3, 4]]],
    [-3, [[null, 1], [1, 2], [2, 3], [3, 4]]],
    [11, [[1, 1], [2, 2], [3, 3], [null, 4]]],
    [Number.NaN, [[1, 1], [2, 2], [3, 3], [null, 4]]],
  ])("inserts at position %j and pushes the later steps down", (position, expected) => {
    const result = applyStepChange(three, { kind: "insert", position, step: fresh() });
    expect(result.ok && orders(result.steps)).toEqual(expected);
  });

  it("refuses an 11th step for every chain", () => {
    const ten = Array.from({ length: STEPS_MAX }, (_, i) => notes(i + 1, i + 1));
    for (const position of [1, 5, STEPS_MAX + 1]) {
      expect(applyStepChange(ten, { kind: "insert", position, step: fresh() })).toEqual({ ok: false, code: "chain_full" });
    }
    expect(applyStepChange(ten.slice(1), { kind: "insert", position: 1, step: fresh() }).ok).toBe(true);
  });

  it("edits a step in place, keeping its place", () => {
    const result = applyStepChange(three, { kind: "edit", id: 2, step: notes(2, 9, { userPrompt: "Changed." }) });
    expect(result.ok && orders(result.steps)).toEqual([[1, 1], [2, 2], [3, 3]]);
    expect(result.ok && result.steps[1].userPrompt).toBe("Changed.");
  });

  it("swaps a step with its neighbour", () => {
    const up = applyStepChange(three, { kind: "move", id: 3, direction: -1 });
    expect(up.ok && orders(up.steps)).toEqual([[1, 1], [3, 2], [2, 3]]);
    const down = applyStepChange(three, { kind: "move", id: 1, direction: 1 });
    expect(down.ok && orders(down.steps)).toEqual([[2, 1], [1, 2], [3, 3]]);
  });

  it("does nothing when moving past either end", () => {
    for (const change of [
      { kind: "move", id: 1, direction: -1 },
      { kind: "move", id: 3, direction: 1 },
    ] as const) {
      const result = applyStepChange(three, change);
      expect(result.ok && orders(result.steps)).toEqual([[1, 1], [2, 2], [3, 3]]);
    }
  });

  it("deletes a step and closes the gap", () => {
    const result = applyStepChange(three, { kind: "delete", id: 2 });
    expect(result.ok && orders(result.steps)).toEqual([[1, 1], [3, 2]]);
  });

  it("keeps at least one step", () => {
    expect(applyStepChange([step(1, 1)], { kind: "delete", id: 1 })).toEqual({ ok: false, code: "only_step" });
  });

  it("refuses a step that isn't in the chain", () => {
    for (const change of [
      { kind: "edit", id: 9, step: notes(9, 1) },
      { kind: "move", id: 9, direction: 1 },
      { kind: "delete", id: 9 },
    ] as const) {
      expect(applyStepChange(three, change)).toEqual({ ok: false, code: "step_not_found" });
    }
  });

  it("sorts by order first and renumbers from 1, never changing the input", () => {
    const shuffled = [notes(2, 5), step(3, 9), notes(1, 2)];
    const result = applyStepChange(shuffled, { kind: "move", id: 1, direction: 1 });
    expect(result.ok && orders(result.steps)).toEqual([[2, 1], [1, 2], [3, 3]]);
    expect(orders(shuffled)).toEqual([[2, 5], [3, 9], [1, 2]]);
  });
});

describe("changeChain", () => {
  it("returns the chain after the change", () => {
    const result = changeChain(twoStep(), { kind: "move", id: 12, direction: -1 });
    expect(result.ok && result.chain.steps.map((s) => s.id)).toEqual([12, 11]);
    expect(result.ok && result.chain.id).toBe(7);
  });

  it("passes on the refusal", () => {
    expect(changeChain(chainOf(step(1, 1)), { kind: "delete", id: 1 })).toEqual({ ok: false, code: "only_step" });
  });
});

describe("toChainStep", () => {
  const values: StepValues = {
    description: "Roast the photo",
    input_type: "text",
    output_type: "roast_json",
    llm_model_id: 3,
    temperature: 0.7,
    system_prompt: "{{critics}}",
    user_prompt: "Go.",
  };

  it("reads the step the way the runner does", () => {
    expect(toChainStep(values, GEMINI, null, 2)).toEqual({
      id: null,
      order: 2,
      inputType: "text",
      outputType: "roast_json",
      model: {
        id: 3,
        providerModelId: "gemini-3.5-flash",
        providerSlug: "google",
        temperatureSupported: true,
        thinkingLevel: "minimal",
      },
      temperature: 0.7,
      systemPrompt: "{{critics}}",
      userPrompt: "Go.",
    });
  });

  it("keeps the step's id and drops a thinking level the runner doesn't know", () => {
    const step = toChainStep(values, { ...GEMINI, thinking_level: "max" }, 12, 1);
    expect(step?.id).toBe(12);
    expect(step?.model.thinkingLevel).toBeNull();
  });

  it("is null for a model without a provider", () => {
    expect(toChainStep(values, { ...GEMINI, llm_providers: null }, null, 1)).toBeNull();
  });
});

describe("live chains", () => {
  it.each([
    [{ isDefault: true, weight: 0 }, true],
    [{ isDefault: true, weight: 100 }, true],
    [{ isDefault: false, weight: 1 }, true],
    [{ isDefault: false, weight: 0 }, false],
  ])("%j is live: %s", (standing, live) => {
    expect(isLive(standing)).toBe(live);
  });

  it("reads a chain toChain couldn't read as unusable", () => {
    expect(chainProblems(null)).toEqual([UNUSABLE_STEP]);
    expect(chainProblems(twoStep())).toEqual([]);
  });

  const live = { isDefault: false, weight: 40 };
  const draft = { isDefault: false, weight: 0 };
  const swapped = () => {
    const changed = changeChain(twoStep(), { kind: "move", id: 12, direction: -1 });
    if (!changed.ok) throw new Error("move failed");
    return changed.chain;
  };

  it("refuses a change that stops a live chain from running, with the problems", () => {
    const after = swapped();
    expect(liveChangeProblems(live, twoStep(), after)).toEqual(validateChain(after));
    expect(liveChangeProblems(live, twoStep(), after).length).toBeGreaterThan(0);
    expect(liveChangeProblems({ isDefault: true, weight: 0 }, twoStep(), after).length).toBeGreaterThan(0);
    expect(liveChangeProblems(live, twoStep(), null)).toEqual([UNUSABLE_STEP]);
  });

  it("lets a live chain take a change that keeps it running", () => {
    const edited = changeChain(twoStep(), { kind: "edit", id: 11, step: notes(11, 1, { userPrompt: "Shorter notes." }) });
    expect(edited.ok && liveChangeProblems(live, twoStep(), edited.chain)).toEqual([]);
  });

  it("saves a draft in any state", () => {
    expect(liveChangeProblems(draft, twoStep(), swapped())).toEqual([]);
    expect(liveChangeProblems(draft, twoStep(), null)).toEqual([]);
  });

  it("lets a live chain that already can't run change, since its runs fall back anyway", () => {
    expect(liveChangeProblems(live, swapped(), swapped())).toEqual([]);
    expect(liveChangeProblems(live, null, swapped())).toEqual([]);
  });
});

describe("checkStepChange", () => {
  const live = { isDefault: true, weight: 100 };

  it("passes a change that keeps a live chain running", () => {
    expect(checkStepChange(live, twoStep(), { kind: "edit", id: 11, step: notes(11, 1) })).toEqual({ ok: true });
  });

  it("refuses with the problems when it would stop a live chain", () => {
    const check = checkStepChange(live, twoStep(), { kind: "move", id: 12, direction: -1 });
    expect(check.ok).toBe(false);
    expect(!check.ok && "problems" in check && check.problems.length).toBeGreaterThan(0);
  });

  it("refuses with the database's code first, live or not", () => {
    const full = chainOf(...Array.from({ length: STEPS_MAX }, (_, i) => notes(i + 1, i + 1)));
    for (const standing of [live, { isDefault: false, weight: 0 }]) {
      expect(checkStepChange(standing, full, { kind: "insert", position: 1, step: notes(0, 0, { id: null }) })).toEqual({
        ok: false,
        code: "chain_full",
      });
      expect(checkStepChange(standing, twoStep(), { kind: "delete", id: 99 })).toEqual({ ok: false, code: "step_not_found" });
    }
  });

  it("leaves a chain toChain couldn't read to the database", () => {
    expect(checkStepChange(live, null, { kind: "delete", id: 1 })).toEqual({ ok: true });
  });
});

describe("stepLocks", () => {
  it("locks the moves and deletes that would break a live chain", () => {
    const locks = stepLocks({ isDefault: true, weight: 100 }, twoStep());
    // Either move puts the reviews first; deleting the reviews step leaves notes last
    expect(locks.get(11)?.down.length).toBeGreaterThan(0);
    expect(locks.get(12)?.up.length).toBeGreaterThan(0);
    expect(locks.get(12)?.remove.length).toBeGreaterThan(0);
    // Moving past an end changes nothing
    expect(locks.get(11)?.up).toEqual([]);
    expect(locks.get(12)?.down).toEqual([]);
  });

  it("leaves a step free when the chain would still run without it", () => {
    // Deleting the notes step leaves the reviews step first, where {{previous}} isn't allowed
    expect(stepLocks({ isDefault: false, weight: 50 }, twoStep()).get(11)?.remove.length).toBeGreaterThan(0);
    const plain = chainOf(notes(11, 1), step(12, 2));
    expect(stepLocks({ isDefault: false, weight: 50 }, plain).get(11)?.remove).toEqual([]);
  });

  it("locks nothing on a draft, or on a chain that can't run anyway", () => {
    expect(stepLocks({ isDefault: false, weight: 0 }, twoStep()).size).toBe(0);
    expect(stepLocks({ isDefault: true, weight: 100 }, chainOf(step(1, 1), notes(2, 2))).size).toBe(0);
    expect(stepLocks({ isDefault: true, weight: 100 }, null).size).toBe(0);
  });

  it("doesn't lock deleting the only step: the database refuses that on its own", () => {
    expect(stepLocks({ isDefault: true, weight: 100 }, chainOf(step(1, 1))).get(1)).toEqual({
      up: [],
      down: [],
      remove: [],
    });
  });
});

describe("chainStatus and statusLine", () => {
  it.each([
    [{ isDefault: true, weight: 100, problems: 0 }, "accent", "Live · 100%"],
    [{ isDefault: true, weight: 0, problems: 0 }, "accent", "Live · backup only"],
    [{ isDefault: false, weight: 25, problems: 0 }, "accent", "Live · 25%"],
    [{ isDefault: false, weight: 0, problems: 0 }, "neutral", "Draft"],
    [{ isDefault: false, weight: 0, problems: 1 }, "danger", "Can’t run (1 problem)"],
    [{ isDefault: true, weight: 100, problems: 3 }, "danger", "Can’t run (3 problems)"],
  ] as const)("%j reads %s %j", (chain, tone, label) => {
    expect(chainStatus(chain)).toEqual({ tone, label });
  });

  it.each([
    [{ isDefault: true, weight: 100, problems: 0 }, "Every new roast uses it"],
    [{ isDefault: true, weight: 60, problems: 0 }, "60% of new roasts use it"],
    [{ isDefault: true, weight: 0, problems: 0 }, "the backup"],
    [{ isDefault: false, weight: 40, problems: 0 }, "Live. 40% of new roasts use it."],
    [{ isDefault: false, weight: 0, problems: 0 }, "Draft: no roasts use it"],
    [{ isDefault: false, weight: 40, problems: 2 }, "use the default chain instead"],
    [{ isDefault: true, weight: 100, problems: 2 }, "one-pass prompt built into the app"],
    [{ isDefault: false, weight: 0, problems: 2 }, "can’t run yet"],
  ])("%j says %j", (chain, text) => {
    expect(statusLine(chain)).toContain(text);
  });
});

describe("parseChainPageQuery", () => {
  it("reads nothing from an empty query", () => {
    expect(parseChainPageQuery({})).toEqual({ error: null, change: null, target: null, notice: null, topic: null });
  });

  it.each([
    [{ created: "1" }, "created"],
    [{ default: "1" }, "default"],
    [{ step: "added" }, "added"],
    [{ step: "moved" }, "moved"],
    [{ step: "deleted" }, "deleted"],
    [{ step: "created" }, null],
    [{ created: "yes" }, null],
  ])("reads %j as the notice %j", (sp, notice) => {
    expect(parseChainPageQuery(sp).notice).toBe(notice);
  });

  it("reads a refused live change with its step", () => {
    expect(parseChainPageQuery({ error: "live", change: "up", target: "12" })).toMatchObject({
      error: "live",
      change: "up",
      target: 12,
    });
  });

  it("knows every error the actions send, and nothing else", () => {
    for (const error of Object.keys(CHAIN_PAGE_ERRORS)) expect(parseChainPageQuery({ error }).error).toBe(error);
    for (const error of ["", "toString", "__proto__", "LIVE"]) expect(parseChainPageQuery({ error }).error).toBeNull();
  });

  it("lets an error win over a success flag left in the URL", () => {
    expect(parseChainPageQuery({ error: "move", step: "moved" })).toMatchObject({ error: "move", notice: null });
  });

  it("reads the preview topic", () => {
    expect(parseChainPageQuery({ topic: "art" }).topic).toBe("art");
    expect(parseChainPageQuery({ topic: "nope" }).topic).toBeNull();
  });
});

describe("refusedChange", () => {
  it("rebuilds the change a redirect named", () => {
    expect(refusedChange("up", 4)).toEqual({ kind: "move", id: 4, direction: -1 });
    expect(refusedChange("down", 4)).toEqual({ kind: "move", id: 4, direction: 1 });
    expect(refusedChange("delete", 4)).toEqual({ kind: "delete", id: 4 });
    expect(refusedChange(null, 4)).toBeNull();
    expect(refusedChange("up", null)).toBeNull();
  });
});

describe("placeholderReport", () => {
  it("sorts every {{…}} into filled, unknown and sent as typed", () => {
    expect(
      placeholderReport("Topic: {{topic}}\n{{critics}}\n{{ note }} {{Note}} {{critic}}", "{{topic}} {{note}} {{}} {{tip-max}}"),
    ).toEqual({
      known: ["topic", "critics", "note"],
      unknown: ["critic"],
      ignored: [
        { text: "{{ note }}", suggestion: "note" },
        { text: "{{Note}}", suggestion: "note" },
        { text: "{{}}", suggestion: null },
        { text: "{{tip-max}}", suggestion: null },
      ],
    });
  });

  it("suggests the placeholder a spaced-out or capitalised one meant", () => {
    expect(placeholderReport("{{ Rating Max }} {{ROAST_MAX}}").ignored).toEqual([
      { text: "{{ Rating Max }}", suggestion: "rating_max" },
      { text: "{{ROAST_MAX}}", suggestion: "roast_max" },
    ]);
  });

  it("agrees with the runner on what gets filled in", () => {
    const template = "{{{note}}} {{ note }} {{previous}}";
    const filled = renderTemplate(template, Object.fromEntries(PLACEHOLDERS.map((p) => [p, "X"])) as never);
    expect(filled).toBe("{X} {{ note }} X");
    expect(placeholderReport(template)).toEqual({
      known: ["note", "previous"],
      unknown: [],
      ignored: [{ text: "{{ note }}", suggestion: "note" }],
    });
  });

  it("is empty for plain text", () => {
    expect(placeholderReport("Roast this.", "")).toEqual({ known: [], unknown: [], ignored: [] });
  });
});

describe("stepWarnings", () => {
  const base = { order: 2, last: false, outputType: "text" as const, systemPrompt: "", userPrompt: "" };

  it("warns about {{previous}} on step 1 only", () => {
    expect(stepWarnings({ ...base, order: 1, userPrompt: "{{previous}}" })).toHaveLength(1);
    expect(stepWarnings({ ...base, order: 2, userPrompt: "{{previous}}" })).toEqual([]);
  });

  it("warns when the reviews step never lists the critics", () => {
    const last = { ...base, last: true, outputType: "roast_json" as const };
    expect(stepWarnings({ ...last, systemPrompt: "Roast it." })).toHaveLength(1);
    expect(stepWarnings({ ...last, systemPrompt: "{{critics}}" })).toEqual([]);
  });

  it("warns when the output doesn't fit where the step sits", () => {
    expect(stepWarnings({ ...base, last: true })).toEqual(["As the last step it must write the reviews."]);
    expect(stepWarnings({ ...base, outputType: "roast_json", systemPrompt: "{{critics}}" })).toHaveLength(1);
    expect(stepWarnings(base)).toEqual([]);
  });

  it("finds as many problems as validateChain does for a one-step chain", () => {
    for (const lone of [
      { outputType: "roast_json" as const, systemPrompt: "{{previous}}", userPrompt: "Go." },
      { outputType: "text" as const, systemPrompt: "{{critics}}", userPrompt: "Go." },
      { outputType: "roast_json" as const, systemPrompt: "{{critics}}", userPrompt: "{{note}}" },
    ]) {
      const problems = validateChain(chainOf(step(1, 1, lone)));
      expect(stepWarnings({ order: 1, last: true, ...lone })).toHaveLength(problems.length);
    }
  });
});

describe("previewVars", () => {
  const inputs = {
    critics: [{ id: 1, slug: "chef-scorch", name: "Chef Scorch", emoji: "🔥", description: "A burnt-out TV chef." }],
    terms: [],
    examples: [],
  };

  it("fills in the topic's panel and a sample note", () => {
    const vars = previewVars(inputs, "food", 1);
    expect(vars.critics).toBe("- chef-scorch (Chef Scorch): A burnt-out TV chef.");
    expect(vars.note).toBe(`\nUploader's note: ${SAMPLE_NOTE}`);
    expect(vars.topic).toContain("Food");
  });

  it("marks where the step before's answer goes, and leaves it empty on step 1", () => {
    expect(previewVars(inputs, "art", 1).previous).toBe("");
    expect(previewVars(inputs, "art", 3).previous).toBe(previousStandIn(3));
    expect(previousStandIn(3)).toBe("(step 2’s answer goes here)");
  });
});
