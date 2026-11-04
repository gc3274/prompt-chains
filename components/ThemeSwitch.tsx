"use client";

import { useState } from "react";
import { THEMES, themeAttribute, themeCookie, type Theme } from "@/lib/theme";

const LABELS: Record<Theme, string> = { light: "Light", dark: "Dark", system: "System" };

// The same attribute the root layout renders, plus the cookie it reads next time
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const attribute = themeAttribute(theme);
  if (attribute) root.dataset.theme = attribute;
  else delete root.dataset.theme;
  document.cookie = themeCookie(theme);
}

// Light, dark or the system's setting, as three radio buttons in one pill. A pick
// applies at once and is saved in a cookie, so the next page load renders the same
// theme on the server. Not inside any form, so a form reset never touches it.
export default function ThemeSwitch({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState(initial);

  function choose(next: Theme) {
    setTheme(next);
    applyTheme(next);
  }

  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">Theme</legend>
      <div className="inline-flex rounded-full border border-line bg-canvas p-0.5">
        {THEMES.map((t) => (
          <label
            key={t}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:text-ink has-checked:bg-surface has-checked:text-ink has-checked:shadow-sm has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent motion-reduce:transition-none"
          >
            <input
              type="radio"
              name="theme"
              value={t}
              checked={theme === t}
              onChange={() => choose(t)}
              className="sr-only"
            />
            <ThemeIcon theme={t} />
            {LABELS[t]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ThemeIcon({ theme }: { theme: Theme }) {
  const common = {
    "aria-hidden": true,
    viewBox: "0 0 16 16",
    className: "size-3.5",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (theme === "light") {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
      </svg>
    );
  }
  if (theme === "dark") {
    return (
      <svg {...common}>
        <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="2" y="3" width="12" height="8" rx="1.5" />
      <path d="M6 14h4M8 11v3" />
    </svg>
  );
}
