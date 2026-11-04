import { describe, expect, it } from "vitest";
import { FIX_FIELDS } from "@/lib/forms";
import { CANT_RUN_WEIGHT, MIX_STALE, mixTotal, validateMix, WEIGHT_RULE, weightField, weightValue } from "@/lib/mix";

const form = (entries: [string, string][]) => {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
};

// Two chains, ids 1 and 2, as the seed makes them
const mix = (one: string, two: string, ...extra: [string, string][]) =>
  form([["weight-1", one], ["weight-2", two], ...extra]);

describe("weightField", () => {
  it("names the field after the chain id", () => {
    expect(weightField(7)).toBe("weight-7");
  });
});

describe("weightValue", () => {
  it.each([
    ["40", 40],
    [" 7 ", 7],
    ["070", 70],
    ["150", 150],
    ["", 0],
    ["abc", 0],
    ["1.5", 0],
    ["-3", 0],
    ["1e2", 0],
  ])("%j counts as %j", (raw, expected) => {
    expect(weightValue(raw)).toBe(expected);
  });
});

describe("mixTotal", () => {
  it.each([
    [[], 0],
    [[100, 0], 100],
    [[60, 40], 100],
    [[30, 30, 30], 90],
  ])("%j adds up to %j", (weights, expected) => {
    expect(mixTotal(weights)).toBe(expected);
  });
});

describe("validateMix", () => {
  it("returns one row per chain, in id order, when they add up to 100", () => {
    expect(validateMix(form([["weight-2", "25"], ["weight-1", "75"]]), [2, 1])).toEqual({
      ok: true,
      rows: [
        { prompt_chain_id: 1, weight: 75 },
        { prompt_chain_id: 2, weight: 25 },
      ],
    });
  });

  it.each([
    ["100", "0"],
    ["0", "100"],
    [" 50 ", "050"],
  ])("accepts %j and %j", (one, two) => {
    expect(validateMix(mix(one, two), [1, 2]).ok).toBe(true);
  });

  it("ignores fields that aren't weights, like the action's own", () => {
    expect(validateMix(mix("60", "40", ["$ACTION_ID_abc", ""]), [1, 2]).ok).toBe(true);
  });

  it.each([
    ["", "100"],
    ["abc", "100"],
    ["-1", "100"],
    ["1.5", "98.5"],
    ["101", "0"],
    ["1e2", "0"],
  ])("marks %j as not a whole number from 0 to 100", (one, two) => {
    const result = validateMix(mix(one, two), [1, 2]);
    expect(result).toEqual({
      ok: false,
      message: FIX_FIELDS,
      errors: expect.objectContaining({ "weight-1": WEIGHT_RULE }),
    });
  });

  it("marks a repeated field, which only a hand-made request sends", () => {
    const result = validateMix(mix("50", "50", ["weight-1", "0"]), [1, 2]);
    expect(result).toEqual({ ok: false, message: FIX_FIELDS, errors: { "weight-1": WEIGHT_RULE } });
  });

  it.each([
    ["60", "30", 90],
    ["60", "60", 120],
    ["0", "0", 0],
  ])("refuses %j + %j because they add up to %i", (one, two, total) => {
    const result = validateMix(mix(one, two), [1, 2]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual({});
      expect(result.message).toContain(`add up to ${total}.`);
    }
  });

  it("asks for a reload when a chain was added since the page loaded", () => {
    expect(validateMix(mix("60", "40"), [1, 2, 3])).toEqual({ ok: false, errors: {}, message: MIX_STALE });
  });

  it("asks for a reload when the form names a chain that's gone", () => {
    expect(validateMix(mix("60", "40", ["weight-3", "0"]), [1, 2])).toEqual({
      ok: false,
      errors: {},
      message: MIX_STALE,
    });
    expect(validateMix(mix("60", "40", ["weight-01", "0"]), [1, 2]).ok).toBe(false);
  });

  it("refuses an empty list of chains", () => {
    expect(validateMix(form([]), []).ok).toBe(false);
  });

  describe("with chains that can't run", () => {
    it("accepts them at 0", () => {
      expect(validateMix(mix("100", "0"), [1, 2], [2])).toEqual({
        ok: true,
        rows: [
          { prompt_chain_id: 1, weight: 100 },
          { prompt_chain_id: 2, weight: 0 },
        ],
      });
    });

    it.each([
      ["60", "40"],
      ["0", "100"],
      ["99", "1"],
    ])("marks a share above 0 (%j + %j)", (one, two) => {
      expect(validateMix(mix(one, two), [1, 2], [2])).toEqual({
        ok: false,
        message: FIX_FIELDS,
        errors: { "weight-2": CANT_RUN_WEIGHT },
      });
    });

    it("marks every one of them, and still checks the others' numbers", () => {
      expect(validateMix(mix("50", "abc", ["weight-3", "50"]), [1, 2, 3], [1, 3])).toEqual({
        ok: false,
        message: FIX_FIELDS,
        errors: { "weight-1": CANT_RUN_WEIGHT, "weight-2": WEIGHT_RULE, "weight-3": CANT_RUN_WEIGHT },
      });
    });

    it("ignores ids that aren't chains on the form", () => {
      expect(validateMix(mix("60", "40"), [1, 2], [9]).ok).toBe(true);
    });

    it("leaves the total check to the chains that can run", () => {
      const result = validateMix(mix("90", "0"), [1, 2], [2]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain("add up to 90.");
    });
  });
});
