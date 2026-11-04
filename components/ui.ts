// Shared class strings so buttons, inputs and cards match on every admin page.
// Radii: 12px cards, 8px inputs, full pills. No motion beyond the pending spinner.

export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "sm";

const buttonBase = `inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full font-medium transition-colors motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`;

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-accent/90",
  secondary: "border border-line bg-surface text-ink hover:border-muted/40 hover:bg-canvas",
  ghost: "text-muted hover:bg-canvas hover:text-ink",
  danger: "bg-danger text-white hover:bg-danger/90",
};

const buttonSizes: Record<ButtonSize, string> = {
  md: "px-4 py-2 text-sm",
  sm: "px-3 py-1.5 text-sm",
};

export function button(variant: ButtonVariant = "primary", size: ButtonSize = "md") {
  return `${buttonBase} ${buttonVariants[variant]} ${buttonSizes[size]}`;
}

export const card = "rounded-xl border border-line bg-surface";

export const input = `w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted ${focusRing}`;

export const label = "text-sm font-medium text-ink";

export const textLink = `rounded-sm font-medium text-accent underline-offset-4 hover:underline ${focusRing}`;

export const errorBox = "rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger";

export const noticeBox = "rounded-lg border border-accent/20 bg-accent/5 px-4 py-3 text-sm text-ink";
