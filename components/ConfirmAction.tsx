"use client";

import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { useFormStatus } from "react-dom";
import SubmitButton from "@/components/SubmitButton";
import { button, type ButtonSize, type ButtonVariant } from "@/components/ui";

type ConfirmActionProps = {
  // A gated server action that does it and redirects
  action: (fd: FormData) => Promise<void>;
  // Sent as hidden inputs, e.g. { id: "12" }
  fields: Record<string, string>;
  // On the button that opens the dialog, and on the one that confirms
  label: string;
  pendingText: string;
  title: string;
  // What happens, in a sentence or two
  children: ReactNode;
  variant?: ButtonVariant;
  // Of the button that opens the dialog
  size?: ButtonSize;
  // Set when it can't be done yet: the button is disabled and this says why
  blockedReason?: string | null;
};

// ConfirmDelete's native <dialog> for an action that isn't a delete, like
// making a chain the default: it says what will change before anything does
export default function ConfirmAction({
  action,
  fields,
  label,
  pendingText,
  title,
  children,
  variant = "primary",
  size = "md",
  blockedReason = null,
}: ConfirmActionProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const uid = useId();

  function open() {
    dialogRef.current?.showModal();
    // Start on the safe choice
    cancelRef.current?.focus();
  }

  if (blockedReason) {
    return (
      <div className="space-y-2">
        <button type="button" disabled aria-describedby={`${uid}-blocked`} className={button(variant, size)}>
          {label}
        </button>
        <p id={`${uid}-blocked`} className="max-w-prose text-sm text-muted">
          {blockedReason}
        </p>
      </div>
    );
  }

  return (
    <>
      <button type="button" onClick={open} className={button(variant, size)}>
        {label}
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={`${uid}-title`}
        aria-describedby={`${uid}-body`}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-line bg-surface p-6 text-ink backdrop:bg-scrim/50"
      >
        <h2 id={`${uid}-title`} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        <div id={`${uid}-body`} className="mt-2 space-y-2 text-sm text-muted">
          {children}
        </div>
        <form action={action} className="mt-6 flex flex-wrap justify-end gap-3">
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <button
            ref={cancelRef}
            type="button"
            onClick={() => dialogRef.current?.close()}
            className={button("secondary")}
          >
            Cancel
          </button>
          <SubmitButton variant={variant} pendingText={pendingText}>
            {label}
          </SubmitButton>
          <CloseWhenSettled dialogRef={dialogRef} />
        </form>
      </dialog>
    </>
  );
}

// Must sit inside the form: useFormStatus reads the parent form's submit
function CloseWhenSettled({ dialogRef }: { dialogRef: RefObject<HTMLDialogElement | null> }) {
  const { pending } = useFormStatus();
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending) dialogRef.current?.close();
    wasPending.current = pending;
  }, [pending, dialogRef]);
  return null;
}
