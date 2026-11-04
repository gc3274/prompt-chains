import { describe, expect, it } from "vitest";
import {
  callCostLabel,
  chainUse,
  displayStatus,
  formatDuration,
  parseRequestQuery,
  photoState,
  preview,
  REQUEST_STATUSES,
  REQUEST_STATUS_INFO,
  tokensLabel,
  UNFINISHED_AFTER_MS,
  type RequestStatus,
} from "@/lib/requests";

describe("parseRequestQuery", () => {
  it("reads every filter from its fixed set", () => {
    expect(parseRequestQuery({ status: "failed", source: "admin", chain: "2", page: "3" })).toEqual({
      status: "failed",
      source: "admin",
      chain: 2,
      page: 3,
    });
  });

  it.each([
    [{}, { status: null, source: null, chain: null, page: 1 }],
    [{ status: "unfinished" }, { status: null, source: null, chain: null, page: 1 }],
    [{ status: "FAILED", source: "cron" }, { status: null, source: null, chain: null, page: 1 }],
    [{ chain: "0" }, { status: null, source: null, chain: null, page: 1 }],
    [{ chain: "1,2" }, { status: null, source: null, chain: null, page: 1 }],
    [{ chain: "-1" }, { status: null, source: null, chain: null, page: 1 }],
    [{ status: ["legacy", "failed"], chain: ["4", "5"] }, { status: "legacy", source: null, chain: 4, page: 1 }],
  ])("%j reads as %j", (sp, expected) => {
    expect(parseRequestQuery(sp)).toEqual(expected);
  });

  it("accepts every status the database allows", () => {
    for (const status of REQUEST_STATUSES) expect(parseRequestQuery({ status }).status).toBe(status);
  });
});

describe("displayStatus", () => {
  const created = "2026-10-27T15:00:00.000Z";
  const start = Date.parse(created);

  it.each([
    ["pending", 0, "pending"],
    ["pending", UNFINISHED_AFTER_MS, "pending"],
    ["pending", UNFINISHED_AFTER_MS + 1, "unfinished"],
    ["pending", 60 * 60 * 1000, "unfinished"],
    ["succeeded", 60 * 60 * 1000, "succeeded"],
    ["failed", 0, "failed"],
    ["legacy", 60 * 60 * 1000, "legacy"],
  ] as const)("%s after %i ms shows as %s", (status, elapsed, expected) => {
    expect(displayStatus(status, created, start + elapsed)).toBe(expected);
  });

  it("keeps an unreadable timestamp pending rather than guessing", () => {
    expect(displayStatus("pending", "not a date", start)).toBe("pending");
  });

  it("has a label and tone for every status it can show", () => {
    expect(REQUEST_STATUS_INFO.unfinished.label).toBe("Unfinished");
    expect(REQUEST_STATUS_INFO.succeeded.tone).toBe("accent");
    for (const s of ["failed", "busy", "rejected"] as const) expect(REQUEST_STATUS_INFO[s].tone).toBe("danger");
    for (const s of ["pending", "limited", "legacy", "unfinished"] as const) {
      expect(REQUEST_STATUS_INFO[s].tone).toBe("neutral");
    }
  });
});

describe("formatDuration", () => {
  it.each([
    [null, "—"],
    [-1, "—"],
    [Number.NaN, "—"],
    [0, "0 ms"],
    [850, "850 ms"],
    [999, "999 ms"],
    [1000, "1.0 s"],
    [3249, "3.2 s"],
    [48_000, "48.0 s"],
  ])("%j is %j", (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe("preview", () => {
  it.each([
    [null, ""],
    ["", ""],
    ["  two\n\nlines  ", "two lines"],
    ["a".repeat(80), "a".repeat(80)],
    ["a".repeat(81), `${"a".repeat(80)}…`],
    ["🔥".repeat(81), `${"🔥".repeat(80)}…`],
    [`${"a".repeat(79)} b`, `${"a".repeat(79)}…`],
  ])("%j previews as %j", (text, expected) => {
    expect(preview(text)).toBe(expected);
  });
});

describe("chainUse", () => {
  it.each([
    ["succeeded", 1, null, "chain"],
    ["failed", 2, "Step 1: Empty answer.", "chain"],
    ["succeeded", null, null, "deleted"],
    ["rejected", null, null, "deleted"],
    ["busy", null, "Step 1: The time budget for this run was used up.", "deleted"],
    ["failed", null, "Step 1: Unusable answer (invalid). config_fallback; no chain has a weight above 0", "built-in"],
    ["succeeded", null, "config_fallback; chain 3 not found", "built-in"],
    ["failed", null, "The photo couldn't be downloaded.", "none"],
    ["failed", null, null, "none"],
    ["limited", null, "Over the daily limit.", "none"],
    ["pending", null, null, "none"],
    ["legacy", null, null, "none"],
  ] as const)("%s with chain %j and notes %j is %s", (status, chainId, error, expected) => {
    expect(chainUse({ status: status as RequestStatus, chainId, error })).toBe(expected);
  });
});

describe("photoState", () => {
  const id = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";

  it.each([
    ["succeeded", "app", id, "post"],
    ["failed", "admin", id, "post"],
    ["succeeded", "app", null, "deleted"],
    ["failed", "admin", null, "deleted"],
    ["failed", "app", null, "none"],
    ["limited", "app", null, "none"],
    ["pending", "app", null, "none"],
    ["legacy", "app", null, "none"],
  ] as const)("%s %s run with image %j is %s", (status, source, imageId, expected) => {
    expect(photoState({ status, source, imageId })).toBe(expected);
  });
});

describe("tokensLabel", () => {
  it("shows both counts compactly", () => {
    expect(tokensLabel(1234, 340)).toBe("1.2K in / 340 out");
    expect(tokensLabel(0, 0)).toBe("0 in / 0 out");
  });

  it("is null when nothing was recorded, and a dash for one missing side", () => {
    expect(tokensLabel(null, null)).toBeNull();
    expect(tokensLabel(900, null)).toBe("900 in / — out");
  });
});

describe("callCostLabel", () => {
  it("shows a recorded cost, sub-cent ones included", () => {
    expect(callCostLabel({ inputTokens: 1000, outputTokens: 200, costUsd: 0.0008 })).toBe("$0.0008");
    expect(callCostLabel({ inputTokens: 0, outputTokens: 0, costUsd: 0 })).toBe("$0.00");
  });

  it("says why there is no cost", () => {
    expect(callCostLabel({ inputTokens: 1000, outputTokens: 200, costUsd: null })).toBe("No price");
    expect(callCostLabel({ inputTokens: null, outputTokens: null, costUsd: null })).toBe("Not recorded");
  });
});
