import { describe, expect, it } from "vitest";
import { emptyPastEnd, hrefWith, PAGE_SIZE, parsePage, rangeFor } from "@/lib/params";

describe("parsePage", () => {
  it("defaults to 1 when missing or unreadable", () => {
    for (const v of [undefined, null, "", "abc", "NaN", "2.5", "1e3", "0x10", " 3", {}]) {
      expect(parsePage(v), String(v)).toBe(1);
    }
  });

  it("clamps zero and negatives to 1", () => {
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-2")).toBe(1);
    expect(parsePage(-2)).toBe(1);
  });

  it("reads whole numbers and caps them at 1000", () => {
    expect(parsePage("3")).toBe(3);
    expect(parsePage(7)).toBe(7);
    expect(parsePage("1000")).toBe(1000);
    expect(parsePage("5000")).toBe(1000);
  });

  it("uses the first value of a repeated param", () => {
    expect(parsePage(["4", "5"])).toBe(4);
    expect(parsePage([])).toBe(1);
  });
});

describe("rangeFor", () => {
  it("maps a page to an inclusive row range", () => {
    expect(PAGE_SIZE).toBe(25);
    expect(rangeFor(1)).toEqual([0, 24]);
    expect(rangeFor(3)).toEqual([50, 74]);
  });

  it("never returns a negative range", () => {
    expect(rangeFor(0)).toEqual([0, 24]);
    expect(rangeFor(Number.NaN)).toEqual([0, 24]);
  });
});

describe("hrefWith", () => {
  const runs = { status: null, source: null, chain: null, page: 1 };

  it("returns the bare route when everything is at its default", () => {
    expect(hrefWith("/runs", runs)).toBe("/runs");
    expect(hrefWith("/generate", { chain: null, topic: null, page: 1 })).toBe("/generate");
  });

  it("drops page=1 and empty values", () => {
    expect(hrefWith("/runs", runs, { page: 1, status: "" })).toBe("/runs");
  });

  it("keeps non-default values in a stable key order", () => {
    const a = hrefWith("/runs", { ...runs, status: "failed" }, { chain: 2, source: "app" });
    const b = hrefWith("/runs", { ...runs, source: "app" }, { status: "failed", chain: 2 });
    expect(a).toBe("/runs?chain=2&source=app&status=failed");
    expect(b).toBe(a);
  });

  it("removes a filter patched to null", () => {
    expect(hrefWith("/generate", { chain: 2, topic: "fit" }, { topic: null })).toBe("/generate?chain=2");
  });

  it("keeps the page for pagination links and resets it when a filter changes", () => {
    const onPage3 = { chain: 2, topic: "food", page: 3 };
    expect(hrefWith("/generate", onPage3)).toBe("/generate?chain=2&page=3&topic=food");
    expect(hrefWith("/generate", onPage3, { page: 4 })).toBe("/generate?chain=2&page=4&topic=food");
    expect(hrefWith("/generate", onPage3, { page: 1 })).toBe("/generate?chain=2&topic=food");
    expect(hrefWith("/generate", onPage3, { topic: "art" })).toBe("/generate?chain=2&topic=art");
  });

  it("encodes values", () => {
    expect(hrefWith("/prompt-chains/new", {}, { from: "a b&c" })).toBe("/prompt-chains/new?from=a+b%26c");
  });
});

describe("emptyPastEnd", () => {
  const pastEnd = {
    data: null,
    error: {
      code: "PGRST103",
      details: "An offset of 1000 was requested, but there are only 11 rows.",
      message: "Requested range not satisfiable",
    },
    count: null,
  };

  it("turns a page past the last row into an empty page with the real total", () => {
    expect(emptyPastEnd(pastEnd)).toMatchObject({ data: [], error: null, count: 11 });
  });

  it.each([
    ["An offset of 50 was requested, but there are only 1 rows.", 1],
    ["An offset of 50 was requested, but there are only 0 rows.", 0],
    [null, null],
  ])("reads the total from %j", (details, count) => {
    expect(emptyPastEnd({ ...pastEnd, error: { ...pastEnd.error, details } }).count).toBe(count);
  });

  it("leaves other errors and good pages alone", () => {
    const other = { data: null, error: { code: "57014", details: null }, count: null };
    expect(emptyPastEnd(other)).toBe(other);
    const ok = { data: [1, 2], error: null, count: 2 };
    expect(emptyPastEnd(ok)).toBe(ok);
  });
});
