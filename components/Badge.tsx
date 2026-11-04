import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "accent" | "danger";

const tones: Record<BadgeTone, string> = {
  neutral: "border-line bg-canvas text-muted",
  accent: "border-accent/20 bg-accent/10 text-accent",
  danger: "border-danger/20 bg-danger/5 text-danger",
};

// A short status word next to a row: "Legacy caption", "Private", "Superadmin"
export default function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
