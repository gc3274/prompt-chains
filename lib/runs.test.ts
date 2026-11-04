import { describe, expect, it } from "vitest";
import type { Critic } from "@/lib/roasts";
import {
  budgetRefusal,
  chainChoiceLabel,
  finalAnswer,
  initialChain,
  isJpeg,
  panelTopics,
  parseGenerateQuery,
  parseRunForm,
  photoRange,
  readResult,
  RUN_ERRORS,
  type ChainChoice,
} from "./runs";

const IMAGE = "0B7F2C9E-1D2A-4C3B-9E8F-1A2B3C4D5E6F";

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

describe("parseRunForm", () => {
  it("reads the chain and the photo, lowercasing the id", () => {
    expect(parseRunForm(form({ chainId: "3", imageId: IMAGE }))).toEqual({
      ok: true,
      input: { chainId: 3, imageId: IMAGE.toLowerCase() },
    });
  });

  it("asks for a chain before a photo", () => {
    expect(parseRunForm(form({ imageId: IMAGE }))).toEqual({ ok: false, error: RUN_ERRORS.noChain });
    expect(parseRunForm(form({ chainId: "0", imageId: IMAGE }))).toEqual({ ok: false, error: RUN_ERRORS.noChain });
    expect(parseRunForm(form({ chainId: "1.5", imageId: IMAGE }))).toEqual({ ok: false, error: RUN_ERRORS.noChain });
  });

  it("refuses a missing or malformed photo id", () => {
    expect(parseRunForm(form({ chainId: "3" }))).toEqual({ ok: false, error: RUN_ERRORS.noPhoto });
    expect(parseRunForm(form({ chainId: "3", imageId: "../etc" }))).toEqual({ ok: false, error: RUN_ERRORS.noPhoto });
  });
});

describe("budgetRefusal", () => {
  it("lets a run through with no budget, or under it", () => {
    expect(budgetRefusal({ dailyBudgetUsd: null, spentUsd: 999 })).toBeNull();
    expect(budgetRefusal({ dailyBudgetUsd: 5, spentUsd: 4.99 })).toBeNull();
  });

  it("refuses once spend reaches the budget, and always at $0", () => {
    expect(budgetRefusal({ dailyBudgetUsd: 5, spentUsd: 5 })).toBe(RUN_ERRORS.budgetReached);
    expect(budgetRefusal({ dailyBudgetUsd: 0, spentUsd: 0 })).toBe(RUN_ERRORS.budgetPaused);
  });
});

describe("isJpeg", () => {
  it("checks the JPEG magic bytes", () => {
    expect(isJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(isJpeg(new Uint8Array([]))).toBe(false);
  });
});

describe("parseGenerateQuery", () => {
  it("reads the chain, a known topic and the page", () => {
    expect(parseGenerateQuery({ chain: "2", topic: "food", page: "3" })).toEqual({ chain: 2, topic: "food", page: 3 });
  });

  it("drops what it can't read", () => {
    expect(parseGenerateQuery({ chain: "x", topic: "legacy", page: "-1" })).toEqual({ chain: null, topic: null, page: 1 });
    expect(parseGenerateQuery({ topic: ["art", "food"] })).toEqual({ chain: null, topic: "art", page: 1 });
  });
});

describe("photoRange", () => {
  it("pages 24 photos at a time", () => {
    expect(photoRange(1)).toEqual([0, 23]);
    expect(photoRange(3)).toEqual([48, 71]);
    expect(photoRange(0)).toEqual([0, 23]);
  });
});

const choices: ChainChoice[] = [
  { id: 1, name: "One pass", isDefault: true, problems: 0 },
  { id: 2, name: "Look, then roast", isDefault: false, problems: 0 },
  { id: 3, name: "Half-built", isDefault: false, problems: 2 },
];

describe("chainChoiceLabel", () => {
  it("tags the default and chains that can't run", () => {
    expect(choices.map(chainChoiceLabel)).toEqual(["One pass (default)", "Look, then roast", "Half-built (can’t run)"]);
    expect(chainChoiceLabel({ id: 4, name: "Broken default", isDefault: true, problems: 1 })).toBe(
      "Broken default (default, can’t run)",
    );
  });
});

describe("initialChain", () => {
  it("starts on the asked-for chain when it can run", () => {
    expect(initialChain(choices, 2)).toBe(2);
  });

  it("falls back to the default, then the first that can run", () => {
    expect(initialChain(choices, 3)).toBe(1);
    expect(initialChain(choices, null)).toBe(1);
    expect(initialChain(choices.slice(1), 99)).toBe(2);
  });

  it("is null when nothing can run", () => {
    expect(initialChain([choices[2]], 3)).toBeNull();
    expect(initialChain([], null)).toBeNull();
  });
});

const call = (stepOrder: number, status: string, responseText: string | null) => ({ stepOrder, status, responseText });

describe("finalAnswer", () => {
  it("takes the last answer at the last step", () => {
    const calls = [call(1, "ok", "a description"), call(2, "busy", null), call(2, "ok", "the reviews")];
    expect(finalAnswer(calls)).toBe(calls[2]);
  });

  it("is null when the last step never answered", () => {
    expect(finalAnswer([call(1, "ok", "a description"), call(2, "failed", null)])).toBeNull();
    expect(finalAnswer([])).toBeNull();
  });
});

const critics: Critic[] = [
  { id: 1, slug: "chef", name: "The Chef", emoji: "👩‍🍳", description: "Cooks" },
  { id: 2, slug: "critic", name: "The Critic", emoji: "🧐", description: "Judges" },
];

const reviews = JSON.stringify({
  allowed: true,
  reviews: [
    { critic_slug: "critic", roast: "Bold of you to call this plated.", tip: "Wipe the rim.", score: 4 },
    { critic_slug: "chef", roast: "The sear is real. The salt is not.", tip: null, score: 6 },
  ],
});

describe("readResult", () => {
  it("reads a successful run's reviews in panel order", () => {
    const result = readResult({ status: "succeeded", responses: [call(1, "ok", reviews)] }, critics);
    expect(result).toEqual({
      kind: "reviews",
      reviews: [
        { criticId: 1, critic: critics[0], content: "The sear is real. The salt is not.", tip: null, rating: 6 },
        { criticId: 2, critic: critics[1], content: "Bold of you to call this plated.", tip: "Wipe the rim.", rating: 4 },
      ],
    });
  });

  it("only reads runs that succeeded", () => {
    expect(readResult({ status: "busy", responses: [call(1, "ok", reviews)] }, critics)).toEqual({ kind: "none" });
    expect(readResult({ status: "rejected", responses: [call(1, "ok", '{"allowed":false}')] }, critics)).toEqual({
      kind: "none",
    });
  });

  it("says so when the answer no longer reads as reviews", () => {
    expect(readResult({ status: "succeeded", responses: [call(1, "ok", "not json")] }, critics)).toEqual({
      kind: "unreadable",
    });
    expect(readResult({ status: "succeeded", responses: [call(1, "ok", reviews)] }, [])).toEqual({
      kind: "unreadable",
    });
    expect(readResult({ status: "succeeded", responses: [] }, critics)).toEqual({ kind: "unreadable" });
  });
});

describe("panelTopics", () => {
  it("lists each known topic once, in the order the runs first use it", () => {
    const runs = [{ topic: "fit" }, { topic: "food" }, { topic: "fit" }, { topic: "food" }, { topic: "art" }];
    expect(panelTopics(runs)).toEqual(["fit", "food", "art"]);
  });

  it("skips runs with no topic or one it doesn't know", () => {
    expect(panelTopics([{ topic: null }, { topic: "legacy" }, { topic: "room" }])).toEqual(["room"]);
    expect(panelTopics([])).toEqual([]);
  });
});
