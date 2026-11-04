"use client";

import { useEffect, useId, useRef, type RefObject } from "react";
import { useFormStatus } from "react-dom";
import SubmitButton from "@/components/SubmitButton";
import { button } from "@/components/ui";

type ConfirmDeleteProps = {
  // A gated server action that deletes and redirects
  action: (fd: FormData) => Promise<void>;
  // Sent as hidden inputs, e.g. { id: "12" }
  fields: Record<string, string>;
  // "term", "model", "photo": used in the button and the question
  noun: string;
  // What else goes with it, and that it can't be undone
  warning: string;
  // Set when the row can't be deleted yet: the button is disabled and this says why
  blockedReason?: string | null;
};

// A native modal <dialog>: it traps focus, closes on Escape, and returns focus
// to the button that opened it. Confirming submits the action, which redirects.
// A failed delete redirects back to the same page with ?error=…, which keeps
// this component mounted, so the dialog closes itself once the submit settles
// and the error banner isn't left behind the backdrop.
export default function ConfirmDelete({ action, fields, noun, warning, blockedReason = null }: ConfirmDeleteProps) {
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
        <button
          type="button"
          disabled
          aria-describedby={`${uid}-blocked`}
          className={button("danger")}
        >
          Delete {noun}
        </button>
        <p id={`${uid}-blocked`} className="max-w-prose text-sm text-muted">
          {blockedReason}
        </p>
      </div>
    );
  }

  return (
    <>
      <button type="button" onClick={open} className={button("danger")}>
        Delete {noun}
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={`${uid}-title`}
        aria-describedby={`${uid}-warning`}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-line bg-surface p-6 text-ink backdrop:bg-ink/40"
      >
        <h2 id={`${uid}-title`} className="text-lg font-semibold tracking-tight">
          Delete this {noun}?
        </h2>
        <p id={`${uid}-warning`} className="mt-2 text-sm text-muted">
          {warning}
        </p>
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
          <SubmitButton variant="danger" pendingText="Deleting…">
            Delete {noun}
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
