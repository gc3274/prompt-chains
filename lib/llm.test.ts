import { describe, expect, it } from "vitest";
import { CALLABLE_PROVIDER, FALLBACK_MODEL } from "@/lib/chains";
import { isCallable, UNCALLABLE_NOTE } from "@/lib/llm";

describe("isCallable", () => {
  it("is true only for the provider the app has a client for", () => {
    expect(CALLABLE_PROVIDER).toBe("google");
    expect(isCallable("google")).toBe(true);
    expect(isCallable("openai")).toBe(false);
    expect(isCallable("Google")).toBe(false);
  });
});

describe("UNCALLABLE_NOTE", () => {
  it("names the provider and the fallback", () => {
    expect(UNCALLABLE_NOTE).toContain(CALLABLE_PROVIDER);
    expect(UNCALLABLE_NOTE).toContain(FALLBACK_MODEL);
  });
});
