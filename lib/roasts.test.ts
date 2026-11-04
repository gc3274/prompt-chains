// Copied from gc3274/hw1@3eb3337 lib/roasts.test.ts; keep in sync
import { describe, expect, it } from "vitest";
import { panelScore, parseRoastResponse, parseTopic, type Critic } from "./roasts";

const critics: Critic[] = [
  { id: 1, slug: "chef-scorch", name: "Chef Scorch", emoji: "🔥", description: "" },
  { id: 5, slug: "jaded-new-yorker", name: "Jaded New Yorker", emoji: "🗽", description: "" },
];

const review = (critic_slug: string, extra: Record<string, unknown> = {}) => ({
  critic_slug,
  roast: "This pasta is so soggy it filed for unemployment.",
  tip: "Salt the water and pull it a minute early.",
  score: 3,
  ...extra,
});

const parse = (body: unknown) => parseRoastResponse(JSON.stringify(body), critics);

describe("parseRoastResponse", () => {
  it("keeps one roast per critic in panel order", () => {
    const result = parse({
      allowed: true,
      reviews: [review("jaded-new-yorker"), review("chef-scorch"), review("chef-scorch", { roast: "Again?" })],
    });
    expect(result.ok && result.roasts.map((r) => r.criticId)).toEqual([1, 5]);
    expect(result.ok && result.roasts[0]).toMatchObject({ tip: "Salt the water and pull it a minute early.", rating: 3 });
  });

  it("rejects when the model says the photo isn't allowed", () => {
    expect(parse({ allowed: false, reviews: [] })).toEqual({ ok: false, reason: "rejected" });
  });

  it("ignores unknown critics and reports empty", () => {
    expect(parse({ allowed: true, reviews: [review("gordon")] })).toEqual({ ok: false, reason: "empty" });
  });

  it("clamps and rounds scores, and drops unreadable ones", () => {
    const result = parse({
      allowed: true,
      reviews: [review("chef-scorch", { score: 14 }), review("jaded-new-yorker", { score: "meh" })],
    });
    expect(result.ok && result.roasts.map((r) => r.rating)).toEqual([10, null]);
  });

  it("keeps the roast when the tip is missing", () => {
    const result = parse({ allowed: true, reviews: [review("chef-scorch", { tip: "" })] });
    expect(result.ok && result.roasts[0].tip).toBeNull();
  });

  it("returns invalid for non-JSON", () => {
    expect(parseRoastResponse("nope", critics)).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("parseTopic", () => {
  it("accepts known topics only", () => {
    expect(parseTopic("food")).toBe("food");
    expect(parseTopic(["art"])).toBe("art");
    expect(parseTopic("selfies")).toBeNull();
  });
});

describe("panelScore", () => {
  it("averages scored critics to one decimal", () => {
    expect(panelScore([3, 4, null, 4])).toBe(3.7);
    expect(panelScore([null])).toBeNull();
  });
});
