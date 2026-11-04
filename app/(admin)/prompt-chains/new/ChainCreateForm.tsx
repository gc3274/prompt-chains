"use client";

import { useActionState, useEffect, useRef, useState, type ChangeEvent } from "react";
import FormField, { describedBy } from "@/components/FormField";
import SubmitButton from "@/components/SubmitButton";
import { input } from "@/components/ui";
import { codePoints } from "@/lib/format";
import { FORM_INITIAL } from "@/lib/forms";
import { CHAIN_DESCRIPTION_MAX, CHAIN_NAME_MAX, suggestSlug, type ChainFormState } from "@/lib/prompt-chains";
import { restoreChoices } from "@/lib/restore-choices";
import { createChain } from "../actions";

type ChainCreateFormProps = {
  sources: { id: number; name: string; isDefault: boolean }[];
  // The chain to copy: ?from= (Duplicate), else the default
  sourceId: number;
};

type Values = { source: string; name: string; slug: string; description: string };

export default function ChainCreateForm({ sources, sourceId }: ChainCreateFormProps) {
  const [state, formAction] = useActionState<ChainFormState, FormData>(createChain, FORM_INITIAL);
  // Controlled so React doesn't reset the fields after a refused submit
  const [values, setValues] = useState<Values>({ source: String(sourceId), name: "", slug: "", description: "" });
  // The slug follows the name until the admin types one of their own
  const [slugEdited, setSlugEdited] = useState(false);
  // The result the admin has typed over since; its errors are stale now
  const [editedAfter, setEditedAfter] = useState<ChainFormState | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state.errors) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [state]);

  // React resets the form after each submit; put the choice back from state
  useEffect(() => {
    restoreChoices(formRef.current, values);
  }, [state, values]);

  function update(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const { name, value } = event.target;
    if (name === "slug") setSlugEdited(true);
    setValues((prev) => ({
      ...prev,
      [name]: value,
      ...(name === "name" && !slugEdited ? { slug: suggestSlug(value) } : {}),
    }));
    setEditedAfter(state);
  }

  const errors = editedAfter === state ? {} : (state.errors ?? {});
  const message = editedAfter === state ? "" : state.message;

  return (
    <form ref={formRef} action={formAction} className="space-y-5">
      <FormField
        id="source"
        label="Start from"
        hint="The new chain gets a copy of this chain’s steps, prompts and models. The original doesn’t change."
        error={errors.source}
      >
        <select
          id="source"
          name="source"
          required
          value={values.source}
          onChange={update}
          aria-invalid={errors.source ? true : undefined}
          aria-describedby={describedBy("source", { hint: true, error: errors.source })}
          className={`${input} sm:max-w-sm`}
        >
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.isDefault ? " (default)" : ""}
            </option>
          ))}
        </select>
      </FormField>

      <FormField
        id="name"
        label="Name"
        hint="How it’s shown in this admin area, e.g. One pass, shorter prompt."
        count={`${codePoints(values.name)}/${CHAIN_NAME_MAX}`}
        error={errors.name}
      >
        <input
          id="name"
          name="name"
          required
          autoComplete="off"
          value={values.name}
          onChange={update}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={describedBy("name", { hint: true, count: true, error: errors.name })}
          className={input}
        />
      </FormField>

      <FormField
        id="slug"
        label="Slug"
        hint="2 to 40 lowercase letters, digits or hyphens. Filled in from the name until you change it, and fixed once the chain exists."
        error={errors.slug}
      >
        <input
          id="slug"
          name="slug"
          required
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={values.slug}
          onChange={update}
          aria-invalid={errors.slug ? true : undefined}
          aria-describedby={describedBy("slug", { hint: true, error: errors.slug })}
          className={`${input} font-mono sm:max-w-sm`}
        />
      </FormField>

      <FormField
        id="description"
        label="What it does"
        hint="One or two sentences on how this chain differs, shown in the lists."
        count={`${codePoints(values.description)}/${CHAIN_DESCRIPTION_MAX}`}
        error={errors.description}
      >
        <textarea
          id="description"
          name="description"
          rows={2}
          required
          value={values.description}
          onChange={update}
          aria-invalid={errors.description ? true : undefined}
          aria-describedby={describedBy("description", { hint: true, count: true, error: errors.description })}
          className={`${input} resize-y`}
        />
      </FormField>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <SubmitButton pendingText="Creating…">Create the draft</SubmitButton>
        <p role="status" className={`text-sm ${state.ok ? "text-ink" : "text-danger"}`}>
          {message}
        </p>
      </div>
    </form>
  );
}
