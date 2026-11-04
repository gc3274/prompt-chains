// Light, dark, or whatever the system is set to. The pick is kept in a cookie so
// the server renders <html data-theme> itself and the page never flashes the
// other theme on load. "system" sets no attribute, so a media query decides.
export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

// Its own name: on localhost every port shares cookies with the main app and the admin
export const THEME_COOKIE = "chains-theme";

const ONE_YEAR_S = 60 * 60 * 24 * 365;

// Anything else, or no cookie, is the system setting
export function parseTheme(value: string | undefined): Theme {
  return THEMES.find((t) => t === value) ?? "system";
}

export function themeAttribute(theme: Theme): "light" | "dark" | undefined {
  return theme === "system" ? undefined : theme;
}

export function themeCookie(theme: Theme): string {
  return `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${ONE_YEAR_S}; SameSite=Lax`;
}
