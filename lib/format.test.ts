import { describe, expect, it } from "vitest";
import { codePoints, formatTokens, formatUsd, nouns } from "@/lib/format";

describe("codePoints", () => {
  it("counts code points, not UTF-16 units", () => {
    expect(codePoints("🔥🔥")).toBe(2);
    expect(codePoints("abc")).toBe(3);
    expect(codePoints("")).toBe(0);
  });
});

describe("nouns", () => {
  it("picks the singular only for exactly one", () => {
    expect(nouns(0, "user")).toBe("0 users");
    expect(nouns(1, "user")).toBe("1 user");
    expect(nouns(2, "user")).toBe("2 users");
  });

  it("takes an irregular plural and groups thousands", () => {
    expect(nouns(1, "legacy caption", "legacy captions")).toBe("1 legacy caption");
    expect(nouns(2400, "roast or caption", "roasts and captions")).toBe("2,400 roasts and captions");
  });
});

describe("formatUsd", () => {
  it("shows cents from a dollar up", () => {
    expect(formatUsd(12.4)).toBe("$12.40");
    expect(formatUsd(1)).toBe("$1.00");
    expect(formatUsd(1234.5)).toBe("$1,234.50");
  });

  it("keeps two significant digits under a dollar, so sub-cent costs never read as $0.00", () => {
    expect(formatUsd(0.37)).toBe("$0.37");
    expect(formatUsd(0.05)).toBe("$0.05");
    expect(formatUsd(0.0133)).toBe("$0.013");
    expect(formatUsd(0.0033)).toBe("$0.0033");
    expect(formatUsd(0.000001)).toBe("$0.000001");
  });

  it("rounds up into the next band", () => {
    expect(formatUsd(0.999)).toBe("$1.00");
    expect(formatUsd(0.00995)).toBe("$0.01");
  });

  it("shows zero as cents and a dash for no number", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(Number.NaN)).toBe("—");
  });
});

describe("formatTokens", () => {
  it.each([
    [0, "0"],
    [850, "850"],
    [1234, "1.2K"],
    [12_400, "12.4K"],
    [1_250_000, "1.3M"],
  ])("%i is %s", (n, label) => {
    expect(formatTokens(n)).toBe(label);
  });
});
