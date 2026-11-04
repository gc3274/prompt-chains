import { describe, expect, it } from "vitest";
import { budgetState, tally, toUsd, type CallUsage } from "@/lib/limits";

describe("budgetState", () => {
  it.each([
    [null, 12, "none"],
    [0, 0, "paused"],
    [5, 4.99, "under"],
    [5, 5, "reached"],
    [5, 7, "reached"],
  ] as const)("budget %j with %j spent is %s", (budget, spent, state) => {
    expect(budgetState(budget, spent)).toBe(state);
  });
});

describe("toUsd", () => {
  it.each([
    [0.0033, 0.0033],
    ["0.003300", 0.0033],
    [0, 0],
    [null, null],
    [undefined, null],
    ["", null],
    ["abc", null],
  ])("%j is %j", (v, expected) => {
    expect(toUsd(v)).toBe(expected);
  });
});

const call = (overrides: Partial<CallUsage> = {}): CallUsage => ({
  input_tokens: 1000,
  output_tokens: 200,
  cost_usd: "0.000800",
  ...overrides,
});

describe("tally", () => {
  it("adds up tokens and the costs that were recorded", () => {
    expect(
      tally([call(), call({ cost_usd: 0.0012 }), call({ cost_usd: null, input_tokens: null, output_tokens: null })]),
    ).toEqual({ calls: 3, inputTokens: 2000, outputTokens: 400, costUsd: 0.002, withoutCost: 1 });
  });

  it("doesn't drift over many small costs", () => {
    expect(tally(Array.from({ length: 10 }, () => call({ cost_usd: 0.000001 }))).costUsd).toBe(0.00001);
    expect(tally([call({ cost_usd: 0.1 }), call({ cost_usd: 0.2 })]).costUsd).toBe(0.3);
  });

  it("is all zeros with no calls", () => {
    expect(tally([])).toEqual({ calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, withoutCost: 0 });
  });
});
