"use client";

import { useActionState, useEffect, useRef, useState, type ChangeEvent } from "react";
import FormField, { describedBy } from "@/components/FormField";
import SubmitButton from "@/components/SubmitButton";
import { input } from "@/components/ui";
import { codePoints } from "@/lib/format";
import { FORM_INITIAL } from "@/lib/forms";
import { CHAIN_DESCRIPTION_MAX, CHAIN_NAME_MAX, type ChainFormState } from "@/lib/prompt-chains";
import { updateChainDetails } from "../../actions";

type ChainDetailsFormProps = { id: number; name: string; slug: string; description: string };

type Values = { name: string; description: string };

export default function ChainDetailsForm({ id, name, slug, description }: ChainDetailsFormProps) {
  const [state, formAction] = useActionState<ChainFormState, FormData>(updateChainDetails, FORM_INITIAL);
  // Controlled so React doesn't reset the fields after each submit
  const [values, setValues] = useState<Values>({ name, description });
  // The result the admin has typed over since; its message ("Saved") is stale now
  const [editedAfter, setEditedAfter] = useState<ChainFormState | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state.errors) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [state]);

  function update(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const { name: field, value } = event.target;
    setValues((prev) => ({ ...prev, [field]: value }));
    setEditedAfter(state);
  }

  const errors = editedAfter === state ? {} : (state.errors ?? {});
  const message = editedAfter === state ? "" : state.message;

  return (
    <form ref={formRef} action={formAction} className="space-y-5">
      <input type="hidden" name="id" value={id} />

      <FormField id="name" label="Name" count={`${codePoints(values.name)}/${CHAIN_NAME_MAX}`} error={errors.name}>
        <input
          id="name"
          name="name"
          required
          autoComplete="off"
          value={values.name}
          onChange={update}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={describedBy("name", { count: true, error: errors.name })}
          className={input}
        />
      </FormField>

      {/* No name attribute: the slug is never sent, and updateChainDetails never saves one */}
      <FormField
        id="slug"
        label="Slug"
        hint="Can’t be changed once the chain exists."
      >
        <input
          id="slug"
          readOnly
          value={slug}
          aria-describedby={describedBy("slug", { hint: true })}
          className={`${input} bg-canvas font-mono text-muted sm:max-w-sm`}
        />
      </FormField>

      <FormField
        id="description"
        label="What it does"
        count={`${codePoints(values.description)}/${CHAIN_DESCRIPTION_MAX}`}
        error={errors.description}
      >
        <textarea
          id="description"
          name="description"
          rows={3}
          required
          value={values.description}
          onChange={update}
          aria-invalid={errors.description ? true : undefined}
          aria-describedby={describedBy("description", { count: true, error: errors.description })}
          className={`${input} resize-y`}
        />
      </FormField>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <SubmitButton pendingText="Saving…">Save changes</SubmitButton>
        <p role="status" className={`text-sm ${state.ok ? "text-ink" : "text-danger"}`}>
          {message}
        </p>
      </div>
    </form>
  );
}
