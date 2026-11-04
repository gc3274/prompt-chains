// Copied from gc3274/hw1@0c21549 lib/chain-runner.test.ts; keep in sync
import { describe, expect, it } from "vitest";
import {
  ATTEMPT_MAX_MS,
  DEFAULT_CHAIN,
  FALLBACK_MODEL,
  MARGIN_MS,
  runChain,
  type CallOutcome,
  type CallRequest,
  type Chain,
  type ChainContext,
  type ChainStep,
  type Price,
  type ResponseLog,
} from "./chains";
import type { Critic } from "./roasts";

const critics: Critic[] = [
  { id: 1, slug: "chef-scorch", name: "Chef Scorch", emoji: "🔥", description: "A burnt-out TV chef." },
  { id: 5, slug: "jaded-new-yorker", name: "Jaded New Yorker", emoji: "🗽", description: "Has seen it all." },
];

const ctx: ChainContext = { topic: "food", critics, note: "", terms: [], examples: [] };

const reviews = JSON.stringify({
  allowed: true,
  reviews: [
    { critic_slug: "chef-scorch", roast: "Soggy.", tip: "Salt the water.", score: 3 },
    { critic_slug: "jaded-new-yorker", roast: "Seen worse.", tip: "Plate it.", score: 4 },
  ],
});

const ok = (text: string, model = "gemini-3.5-flash-001"): CallOutcome => ({ ok: true, text, model });
const err = (kind: Extract<CallOutcome, { ok: false }>["kind"], error: string = kind): CallOutcome => ({
  ok: false,
  kind,
  error,
});

// Each call takes `costMs` on a fake clock and answers from the queue in order
function harness(answers: CallOutcome[], { costMs = 1_000, budgetMs = 48_000 } = {}) {
  let clock = 0;
  const calls: CallRequest[] = [];
  const logs: ResponseLog[] = [];
  const opts = {
    now: () => clock,
    deadline: budgetMs,
    call: async (req: CallRequest) => {
      calls.push(req);
      clock += costMs;
      const next = answers.shift();
      if (!next) throw new Error("no answer queued");
      return next;
    },
    onResponse: (log: ResponseLog) => {
      logs.push(log);
    },
  };
  return { opts, calls, logs, advance: (ms: number) => (clock += ms) };
}

const roastStep = DEFAULT_CHAIN.steps[0];
const lookStep: ChainStep = {
  ...roastStep,
  id: 21,
  outputType: "text",
  systemPrompt: "Look at it. {{topic}}",
  userPrompt: "Notes.{{note}}",
};
const twoStep: Chain = {
  id: 2,
  slug: "look-then-roast",
  steps: [lookStep, { ...roastStep, id: 22, order: 2, userPrompt: "Roast.\n{{previous}}" }],
};

describe("runChain", () => {
  it("returns the roasts, the last step's prompt and the model that answered", async () => {
    const { opts, calls, logs } = harness([ok(reviews)]);
    const result = await runChain(DEFAULT_CHAIN, ctx, opts);

    expect(result.ok && result.roasts.map((r) => r.criticId)).toEqual([1, 5]);
    expect(result.ok && result.model).toBe("gemini-3.5-flash-001");
    expect(result.ok && result.prompt).toBe(`${calls[0].system}\n\n${calls[0].user}`);
    expect(calls[0]).toMatchObject({
      model: "gemini-3.5-flash",
      withImage: true,
      criticSlugs: ["chef-scorch", "jaded-new-yorker"],
      temperature: 1,
      thinkingLevel: "minimal",
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      stepOrder: 1,
      isFallback: false,
      fallbackReason: null,
      providerModelId: "gemini-3.5-flash-001",
      status: "ok",
      responseText: reviews,
      durationMs: 1_000,
    });
  });

  it.each([
    ["busy", "busy"],
    ["not_found", "not_found"],
    ["bad_request", "bad_request"],
  ] as const)("falls back once when the model is %s", async (kind, reason) => {
    const { opts, calls, logs } = harness([err(kind, "boom"), ok(reviews, "gemini-flash-lite-002")]);
    const result = await runChain(DEFAULT_CHAIN, ctx, opts);

    expect(result.ok).toBe(true);
    expect(calls.map((c) => c.model)).toEqual(["gemini-3.5-flash", FALLBACK_MODEL]);
    expect(logs.map((l) => [l.status, l.isFallback, l.fallbackReason, l.modelId])).toEqual([
      [kind === "busy" ? "busy" : "failed", false, null, null],
      ["ok", true, reason, null],
    ]);
    expect(logs[0].error).toBe("boom");
    expect(logs[0].providerModelId).toBe("gemini-3.5-flash");
  });

  it.each([
    ["a safety block", err("rejected", "SAFETY"), "rejected"],
    ["an unknown error", err("failed", "500"), "failed"],
    ["the model refusing the photo", ok(JSON.stringify({ allowed: false, reviews: [] })), "rejected"],
    ["an unusable answer", ok("not json"), "failed"],
  ] as const)("never falls back on %s", async (_, answer, reason) => {
    const { opts, calls, logs } = harness([answer]);
    const result = await runChain(DEFAULT_CHAIN, ctx, opts);

    expect(result).toMatchObject({ ok: false, reason });
    expect(calls).toHaveLength(1);
    expect(logs[0].status).toBe(reason);
  });

  it("goes straight to the fallback for a provider it can't call", async () => {
    const chain: Chain = {
      ...DEFAULT_CHAIN,
      steps: [{ ...roastStep, model: { ...roastStep.model, id: 9, providerSlug: "openai", providerModelId: "gpt-x" } }],
    };
    const { opts, calls, logs } = harness([ok(reviews)]);
    const result = await runChain(chain, ctx, opts);

    expect(result.ok).toBe(true);
    expect(calls.map((c) => c.model)).toEqual([FALLBACK_MODEL]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ isFallback: true, fallbackReason: "unsupported_provider", modelId: null });
  });

  it("doesn't call the fallback model twice", async () => {
    const chain: Chain = {
      ...DEFAULT_CHAIN,
      steps: [{ ...roastStep, model: { ...roastStep.model, providerModelId: FALLBACK_MODEL } }],
    };
    const { opts, calls } = harness([err("busy")]);
    expect(await runChain(chain, ctx, opts)).toMatchObject({ ok: false, reason: "busy" });
    expect(calls).toHaveLength(1);
  });

  it("passes each step's notes to the next as {{previous}}", async () => {
    const { opts, calls, logs } = harness([ok("  - a soggy risotto\n"), ok(reviews)]);
    const result = await runChain(twoStep, ctx, opts);

    expect(result.ok).toBe(true);
    expect(calls[0]).toMatchObject({ criticSlugs: null });
    expect(calls[1].user).toBe("Roast.\n- a soggy risotto");
    expect(logs.map((l) => [l.stepId, l.stepOrder])).toEqual([
      [21, 1],
      [22, 2],
    ]);
  });

  it("fails a text step that comes back empty", async () => {
    const { opts } = harness([ok("   ")]);
    expect(await runChain(twoStep, ctx, opts)).toMatchObject({
      ok: false,
      reason: "failed",
      error: "Step 1: Empty answer.",
    });
  });

  it("shares the time left between the steps still to run", async () => {
    const { opts, calls } = harness([err("busy"), ok("- notes"), ok(reviews)], { costMs: 10_000 });
    const result = await runChain(twoStep, ctx, opts);

    expect(result.ok).toBe(true);
    // 48s for two steps: 23s, then the fallback gets (38s - 2s) / 2, then step 2 gets the rest
    expect(calls.map((c) => c.timeoutMs)).toEqual([
      Math.min(ATTEMPT_MAX_MS, (48_000 - MARGIN_MS) / 2),
      (38_000 - MARGIN_MS) / 2,
      28_000 - MARGIN_MS > ATTEMPT_MAX_MS ? ATTEMPT_MAX_MS : 28_000 - MARGIN_MS,
    ]);
  });

  it("stops as busy when no time is left to start a call", async () => {
    const { opts, calls } = harness([ok(reviews)], { budgetMs: 4_000 });
    expect(await runChain(DEFAULT_CHAIN, ctx, opts)).toMatchObject({ ok: false, reason: "busy" });
    expect(calls).toHaveLength(0);
  });

  it("keeps the first failure when the fallback has no time", async () => {
    const { opts, calls } = harness([err("busy", "429")], { costMs: 44_000 });
    expect(await runChain(DEFAULT_CHAIN, ctx, opts)).toEqual({
      ok: false,
      reason: "busy",
      error: "Step 1: 429",
    });
    expect(calls).toHaveLength(1);
  });

  it("leaves temperature out for models that don't take it", async () => {
    const chain: Chain = {
      ...DEFAULT_CHAIN,
      steps: [{ ...roastStep, model: { ...roastStep.model, temperatureSupported: false, thinkingLevel: null } }],
    };
    const { opts, calls, logs } = harness([ok(reviews)]);
    await runChain(chain, ctx, opts);
    expect(calls[0]).toMatchObject({ temperature: null, thinkingLevel: null });
    expect(logs[0].temperature).toBeNull();
  });

  it("treats a throwing caller as a failed call", async () => {
    const { opts } = harness([]);
    expect(await runChain(DEFAULT_CHAIN, ctx, opts)).toEqual({
      ok: false,
      reason: "failed",
      error: "Step 1: no answer queued",
    });
  });

  it("keeps going when logging throws", async () => {
    const { opts } = harness([ok(reviews)]);
    const result = await runChain(DEFAULT_CHAIN, ctx, {
      ...opts,
      onResponse: () => {
        throw new Error("db down");
      },
    });
    expect(result.ok).toBe(true);
  });

  it("refuses an invalid chain before calling anything", async () => {
    const { opts, calls } = harness([]);
    const broken: Chain = { ...DEFAULT_CHAIN, steps: [{ ...roastStep, userPrompt: "{{mood}}" }] };
    expect(await runChain(broken, ctx, opts)).toEqual({
      ok: false,
      reason: "failed",
      error: "Invalid chain: Step 1 uses an unknown placeholder {{mood}}.",
    });
    expect(calls).toHaveLength(0);
  });

  it("refuses an empty panel", async () => {
    const { opts } = harness([]);
    expect(await runChain(DEFAULT_CHAIN, { ...ctx, critics: [] }, opts)).toMatchObject({ ok: false, reason: "failed" });
  });

  it("clips long errors to what the logs hold", async () => {
    const { opts, logs } = harness([err("failed", "x".repeat(900))]);
    const result = await runChain(DEFAULT_CHAIN, ctx, opts);
    expect(!result.ok && Array.from(result.error).length).toBe(500);
    expect(logs[0].error?.length).toBe(500);
  });
});

describe("runChain costs", () => {
  const prices = new Map<string, Price>([
    ["gemini-3.5-flash", { inputPerMillion: 1.5, outputPerMillion: 9 }],
    [FALLBACK_MODEL, { inputPerMillion: 0.3, outputPerMillion: 2.5 }],
  ]);
  const usage = { input: 1_000, output: 200 };

  it("logs each call's tokens and prices it by the model it asked for", async () => {
    const { opts, logs } = harness([
      { ...err("busy"), usage: null },
      { ...ok(reviews, "gemini-flash-lite-002"), usage },
    ]);
    await runChain(DEFAULT_CHAIN, ctx, { ...opts, prices });

    expect(logs.map((l) => [l.inputTokens, l.outputTokens, l.costUsd])).toEqual([
      [null, null, null],
      // The fallback's price, though the answer came from a dated version
      [1_000, 200, 0.0008],
    ]);
  });

  it("logs tokens without a cost when the model has no price", async () => {
    const { opts, logs } = harness([{ ...ok(reviews), usage }]);
    await runChain(DEFAULT_CHAIN, ctx, opts);
    expect(logs[0]).toMatchObject({ inputTokens: 1_000, outputTokens: 200, costUsd: null });
  });

  it("counts the tokens of an answer it couldn't use", async () => {
    const { opts, logs } = harness([{ ...ok("not json"), usage }]);
    await runChain(DEFAULT_CHAIN, ctx, { ...opts, prices });
    expect(logs[0]).toMatchObject({ status: "failed", costUsd: 0.0033 });
  });
});
