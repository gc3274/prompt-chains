import { describe, expect, it } from "vitest";
import { ADMIN_NAV, ADMIN_NAV_GROUPS, isActive } from "./nav";

describe("ADMIN_NAV_GROUPS", () => {
  it("lists every section in its group, in order", () => {
    expect(ADMIN_NAV_GROUPS.map((g) => [g.label, g.items.map((i) => [i.label, i.href])])).toEqual([
      [
        "Chains",
        [
          ["Chains & steps", "/prompt-chains"],
          ["Chain mix", "/chain-mix"],
        ],
      ],
      [
        "Generate",
        [
          ["Run a chain", "/generate"],
          ["Runs", "/runs"],
          ["Media", "/media"],
        ],
      ],
    ]);
  });

  it("flattens to ADMIN_NAV with no repeated href", () => {
    expect(ADMIN_NAV).toHaveLength(5);
    expect(new Set(ADMIN_NAV.map((i) => i.href)).size).toBe(ADMIN_NAV.length);
  });
});

describe("isActive", () => {
  it("matches / only on itself", () => {
    expect(isActive("/", "/")).toBe(true);
    for (const p of ["/prompt-chains", "/runs", "/generate"]) expect(isActive(p, "/")).toBe(false);
  });

  it("matches a section and the pages under it", () => {
    expect(isActive("/runs", "/runs")).toBe(true);
    expect(isActive("/runs/0b7f2c9e-1d2a-4c3b-9e8f-1a2b3c4d5e6f", "/runs")).toBe(true);
    expect(isActive("/prompt-chains/2", "/prompt-chains")).toBe(true);
    expect(isActive("/prompt-chains/2/steps/new", "/prompt-chains")).toBe(true);
  });

  it("does not match a different path that shares a prefix", () => {
    expect(isActive("/runsx", "/runs")).toBe(false);
    expect(isActive("/prompt-chains-old", "/prompt-chains")).toBe(false);
    expect(isActive("/", "/runs")).toBe(false);
  });

  it("marks exactly one section on every page", () => {
    const routes = [
      "/prompt-chains",
      "/prompt-chains/new",
      "/prompt-chains/1",
      "/prompt-chains/1/edit",
      "/prompt-chains/1/steps/new",
      "/prompt-chains/1/steps/2",
      "/chain-mix",
      "/generate",
      "/runs",
      "/runs/x",
      "/media",
    ];
    for (const p of routes) {
      expect(ADMIN_NAV.filter((i) => isActive(p, i.href)), p).toHaveLength(1);
    }
  });
});
