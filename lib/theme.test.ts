import { describe, expect, it } from "vitest";
import { parseTheme, themeAttribute, themeCookie } from "./theme";

describe("parseTheme", () => {
  it("reads the three picks", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("system")).toBe("system");
  });

  it("falls back to the system setting for no cookie or anything else", () => {
    expect(parseTheme(undefined)).toBe("system");
    expect(parseTheme("")).toBe("system");
    expect(parseTheme("Dark")).toBe("system");
    expect(parseTheme("blue")).toBe("system");
  });
});

describe("themeAttribute", () => {
  it("sets light or dark, and nothing for the system setting", () => {
    expect(themeAttribute("light")).toBe("light");
    expect(themeAttribute("dark")).toBe("dark");
    expect(themeAttribute("system")).toBeUndefined();
  });
});

describe("themeCookie", () => {
  it("keeps the pick for a year across the whole site", () => {
    expect(themeCookie("dark")).toBe("chains-theme=dark; Path=/; Max-Age=31536000; SameSite=Lax");
  });
});
