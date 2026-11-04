"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type ChangeEvent } from "react";
import Badge from "@/components/Badge";
import FormField, { describedBy } from "@/components/FormField";
import SubmitButton from "@/components/SubmitButton";
import { input, textLink } from "@/components/ui";
import { nouns } from "@/lib/format";
import { FORM_INITIAL, type FormState } from "@/lib/forms";
import { MIX_TOTAL, mixTotal, WEIGHT_MAX, weightField, weightValue } from "@/lib/mix";
import { updateMix } from "./actions";

type MixFormProps = {
  // problems: why it can't run, so it must stay at 0
  chains: { id: number; name: string; description: string; isDefault: boolean; weight: number; problems: string[] }[];
};

export default function MixForm({ chains }: MixFormProps) {
  const [state, formAction] = useActionState<FormState, FormData>(updateMix, FORM_INITIAL);
  // Controlled so React doesn't reset the fields after each submit
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(chains.map((c) => [weightField(c.id), String(c.weight)])),
  );
  // The result the admin has typed over since; its message ("Saved") is stale now
  const [editedAfter, setEditedAfter] = useState<FormState | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state.errors) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [state]);

  function update(event: ChangeEvent<HTMLInputElement>) {
    const { name, value } = event.target;
    setValues((prev) => ({ ...prev, [name]: value }));
    setEditedAfter(state);
  }

  const errors: Partial<Record<string, string>> = editedAfter === state ? {} : (state.errors ?? {});
  const message = editedAfter === state ? "" : state.message;
  const total = mixTotal(chains.map((c) => weightValue(values[weightField(c.id)] ?? "")));
  const gap = MIX_TOTAL - total;

  return (
    <form ref={formRef} action={formAction} className="space-y-5">
      {chains.map((c) => {
        const id = weightField(c.id);
        const error = errors[id];
        return (
          <FormField
            key={c.id}
            id={id}
            label={c.name}
            hint={
              <span className="flex flex-col items-start gap-1">
                {c.isDefault && <Badge tone="accent">Default</Badge>}
                <span>{c.description}</span>
                {c.problems.length > 0 && (
                  <span className="text-danger">
                    Can’t run ({nouns(c.problems.length, "problem")}), so it can only have 0%.{" "}
                    <Link href={`/prompt-chains/${c.id}`} className={textLink}>
                      See what to fix
                    </Link>
                  </span>
                )}
              </span>
            }
            error={error}
          >
            <div className="flex items-center gap-2">
              <input
                id={id}
                name={id}
                type="number"
                inputMode="numeric"
                required
                min={0}
                max={WEIGHT_MAX}
                step={1}
                value={values[id] ?? ""}
                onChange={update}
                aria-invalid={error ? true : undefined}
                aria-describedby={describedBy(id, { hint: true, error })}
                className={`${input} w-24 tabular-nums`}
              />
              <span aria-hidden="true" className="text-sm text-muted">
                %
              </span>
            </div>
          </FormField>
        );
      })}

      <p aria-live="polite" className="text-sm tabular-nums">
        <span className="font-medium">
          Total: {total} of {MIX_TOTAL}
        </span>
        {gap !== 0 && (
          <span className="text-danger">
            , {Math.abs(gap)} {gap > 0 ? "short" : "over"}
          </span>
        )}
      </p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <SubmitButton pendingText="Saving…">Save the mix</SubmitButton>
        <p role="status" className={`text-sm ${state.ok ? "text-ink" : "text-danger"}`}>
          {message}
        </p>
      </div>
    </form>
  );
}
