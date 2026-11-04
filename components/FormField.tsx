import type { ReactNode } from "react";
import { label } from "./ui";

type FormFieldProps = {
  id: string;
  label: string;
  hint?: ReactNode;
  // e.g. "12/60", shown next to the label
  count?: string;
  error?: string;
  children: ReactNode;
};

// A labelled field with its hint, character count and error. The control inside
// should point aria-describedby at `${id}-hint`, `${id}-count` and `${id}-error`
// (describedBy below builds that list).
export default function FormField({ id, label: text, hint, count, error, children }: FormFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={id} className={label}>
          {text}
        </label>
        {count && (
          <span id={`${id}-count`} className="text-xs text-muted tabular-nums">
            <span className="sr-only">Characters used: </span>
            {count}
          </span>
        )}
      </div>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

// The aria-describedby value for a FormField's control
export function describedBy(
  id: string,
  { hint = false, count = false, error }: { hint?: boolean; count?: boolean; error?: string },
): string | undefined {
  const ids = [hint && `${id}-hint`, count && `${id}-count`, error && `${id}-error`].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}
