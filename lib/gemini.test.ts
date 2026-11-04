// Copied from gc3274/hw1@0c21549 lib/gemini.test.ts; keep in sync
import { ApiError } from "@google/genai";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { classifyError, usageFrom } = await import("./gemini");

const apiError = (status: number, message = "error") => new ApiError({ status, message });

describe("classifyError", () => {
  it.each([
    [apiError(429), "busy"],
    [apiError(503), "busy"],
    [Object.assign(new Error("aborted"), { name: "AbortError" }), "busy"],
    [new Error("RESOURCE_EXHAUSTED: quota"), "busy"],
    [apiError(500, "The model is experiencing high demand"), "busy"],
    [apiError(404, "models/gemini-9 is not found"), "not_found"],
    [apiError(400, "Thinking level is not supported for this model"), "bad_request"],
    [apiError(500, "internal"), "failed"],
    [apiError(403, "permission denied"), "failed"],
    ["a thrown string", "failed"],
  ] as const)("%s is %s", (err, kind) => {
    expect(classifyError(err)).toBe(kind);
  });
});

describe("usageFrom", () => {
  it("bills thinking as output", () => {
    expect(usageFrom({ promptTokenCount: 1_300, candidatesTokenCount: 250, thoughtsTokenCount: 40 })).toEqual({
      input: 1_300,
      output: 290,
      cached: 0,
    });
  });

  it("treats a missing count as 0", () => {
    expect(usageFrom({ promptTokenCount: 900 })).toEqual({ input: 900, output: 0, cached: 0 });
  });

  it("keeps the cached part of the prompt", () => {
    expect(usageFrom({ promptTokenCount: 2_000, cachedContentTokenCount: 1_500, candidatesTokenCount: 10 })).toEqual({
      input: 2_000,
      output: 10,
      cached: 1_500,
    });
  });

  it("is unknown when the API sent no counts", () => {
    expect(usageFrom(undefined)).toBeNull();
    expect(usageFrom({})).toBeNull();
  });
});
