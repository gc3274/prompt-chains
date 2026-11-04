"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import FormField, { describedBy } from "@/components/FormField";
import PlaceholderLegend from "@/components/PlaceholderLegend";
import SubmitButton from "@/components/SubmitButton";
import { card, input, label, textLink } from "@/components/ui";
import type { InputType, OutputType } from "@/lib/chains";
import { codePoints } from "@/lib/format";
import { FORM_INITIAL } from "@/lib/forms";
import { isCallable, UNCALLABLE_NOTE } from "@/lib/llm";
import {
  INPUT_LABELS,
  INPUT_TYPES,
  LIVE_TIP,
  OUTPUT_LABELS,
  OUTPUT_TYPES,
  placeholderReport,
  STEP_DESCRIPTION_MAX,
  stepWarnings,
  SYSTEM_PROMPT_MAX,
  USER_PROMPT_MAX,
  type StepField,
  type StepFormState,
} from "@/lib/prompt-chains";
import { restoreChoices } from "@/lib/restore-choices";
import { createStep, updateStep } from "../../actions";

type ModelChoice = {
  id: number;
  name: string;
  providerModelId: string;
  temperatureSupported: boolean;
  provider: { name: string; slug: string } | null;
};

type StepFormProps = {
  chainId: number;
  // Steps in the chain now; a new one can go anywhere from 1 to stepCount + 1
  stepCount: number;
  models: ModelChoice[];
  // Set when editing a saved step; a new one starts from defaults
  step?: {
    id: number;
    order: number;
    description: string;
    inputType: InputType;
    outputType: OutputType;
    modelId: number | null;
    temperature: number | null;
    systemPrompt: string;
    userPrompt: string;
  };
};

type Values = Record<StepField, string>;

const count = (value: string, max: number) => `${codePoints(value)}/${max.toLocaleString("en-US")}`;

// The add and edit form for one step, with the placeholders it uses beside it.
// A new step that saves redirects to the chain; an edit stays here.
export default function StepForm({ chainId, stepCount, models, step }: StepFormProps) {
  const [state, formAction] = useActionState<StepFormState, FormData>(step ? updateStep : createStep, FORM_INITIAL);
  // Controlled so React doesn't reset the fields after each submit
  const [values, setValues] = useState<Values>(() => {
    const firstCallable = models.find((m) => m.provider && isCallable(m.provider.slug)) ?? models[0];
    return {
      // A new step goes just before the last one by default: that keeps the reviews step last
      position: String(Math.max(stepCount, 1)),
      description: step?.description ?? "",
      input_type: step?.inputType ?? "image",
      output_type: step?.outputType ?? "text",
      llm_model_id: String(step?.modelId ?? firstCallable?.id ?? ""),
      temperature: step ? (step.temperature === null ? "" : String(step.temperature)) : "1",
      system_prompt: step?.systemPrompt ?? "",
      user_prompt: step?.userPrompt ?? "",
    };
  });
  // The result the admin has typed over since; its message ("Saved") is stale now
  const [editedAfter, setEditedAfter] = useState<StepFormState | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state.errors) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [state]);

  // React resets the form after each submit; put the choices back from state
  useEffect(() => {
    restoreChoices(formRef.current, values);
  }, [state, values]);

  function update(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const { name, value } = event.target;
    setValues((prev) => ({ ...prev, [name]: value }));
    setEditedAfter(state);
  }

  const stale = editedAfter === state;
  const errors = stale ? {} : (state.errors ?? {});
  const message = stale ? "" : state.message;
  const problems = stale ? [] : (state.problems ?? []);

  const position = Math.min(Math.max(Number(values.position) || 1, 1), stepCount + 1);
  const order = step ? step.order : position;
  const last = step ? step.order === stepCount : position === stepCount + 1;
  const outputType = values.output_type === "roast_json" ? "roast_json" : "text";
  const report = placeholderReport(values.system_prompt, values.user_prompt);
  const warnings = stepWarnings({
    order,
    last,
    outputType,
    systemPrompt: values.system_prompt,
    userPrompt: values.user_prompt,
  });

  const chosen = models.find((m) => String(m.id) === values.llm_model_id);
  const uncallable = chosen !== undefined && !(chosen.provider && isCallable(chosen.provider.slug));
  const noTemperature = chosen !== undefined && !chosen.temperatureSupported;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-label={step ? `Step ${step.order}` : "New step"} className={`${card} min-w-0 p-5 sm:p-6`}>
        <form ref={formRef} action={formAction} className="space-y-5">
          <input type="hidden" name="chain" value={chainId} />
          {step && <input type="hidden" name="id" value={step.id} />}

          {!step && (
            <FormField
              id="position"
              label="Position"
              hint={
                position <= stepCount
                  ? `Step ${position}${position < stepCount ? ` to ${stepCount}` : ""} ${position < stepCount ? "move" : "moves"} down one place.`
                  : "It runs after every step there is now."
              }
              error={errors.position}
            >
              <select
                id="position"
                name="position"
                value={values.position}
                onChange={update}
                aria-invalid={errors.position ? true : undefined}
                aria-describedby={describedBy("position", { hint: true, error: errors.position })}
                className={`${input} sm:max-w-xs`}
              >
                {Array.from({ length: stepCount + 1 }, (_, i) => i + 1).map((p) => (
                  <option key={p} value={p}>
                    Step {p}
                    {p === stepCount + 1 ? " (last)" : ""}
                  </option>
                ))}
              </select>
            </FormField>
          )}

          <FormField
            id="description"
            label="What this step does"
            hint="Shown on the chain page, e.g. Look at the photo and write notes for the critics."
            count={count(values.description, STEP_DESCRIPTION_MAX)}
            error={errors.description}
          >
            <input
              id="description"
              name="description"
              required
              autoComplete="off"
              value={values.description}
              onChange={update}
              aria-invalid={errors.description ? true : undefined}
              aria-describedby={describedBy("description", { hint: true, count: true, error: errors.description })}
              className={input}
            />
          </FormField>

          <div className="grid gap-5 sm:grid-cols-2">
            <Choices
              name="input_type"
              legend="Input"
              hint="Text only sends the prompts without the photo, e.g. a step that rewrites notes."
              error={errors.input_type}
            >
              {INPUT_TYPES.map((t) => (
                <Choice key={t} name="input_type" value={t} checked={values.input_type === t} onChange={update}>
                  {INPUT_LABELS[t]}
                </Choice>
              ))}
            </Choices>
            <Choices
              name="output_type"
              legend="Output"
              hint="Only the last step writes the reviews. Every step before it writes notes, which the next step gets as {{previous}}."
              error={errors.output_type}
            >
              {OUTPUT_TYPES.map((t) => (
                <Choice key={t} name="output_type" value={t} checked={values.output_type === t} onChange={update}>
                  {OUTPUT_LABELS[t]}
                </Choice>
              ))}
            </Choices>
          </div>

          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <FormField
              id="llm_model_id"
              label="Model"
              hint={
                chosen ? (
                  <>
                    Calls <span className="font-mono break-all">{chosen.providerModelId}</span>.{" "}
                    {uncallable && <span className="text-danger">{UNCALLABLE_NOTE}</span>}
                  </>
                ) : undefined
              }
              error={errors.llm_model_id}
            >
              <select
                id="llm_model_id"
                name="llm_model_id"
                required
                value={values.llm_model_id}
                onChange={update}
                aria-invalid={errors.llm_model_id ? true : undefined}
                aria-describedby={describedBy("llm_model_id", { hint: chosen !== undefined, error: errors.llm_model_id })}
                className={input}
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} · {m.provider?.name ?? "No provider"}
                    {m.provider && isCallable(m.provider.slug) ? "" : " — not callable, uses the fallback"}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField
              id="temperature"
              label="Temperature"
              hint={
                noTemperature
                  ? "This model doesn’t take one, so it isn’t sent."
                  : "0 to 2. Empty: not sent."
              }
              error={errors.temperature}
            >
              <input
                id="temperature"
                name="temperature"
                type="number"
                inputMode="decimal"
                min={0}
                max={2}
                step={0.01}
                value={values.temperature}
                onChange={update}
                aria-invalid={errors.temperature ? true : undefined}
                aria-describedby={describedBy("temperature", { hint: true, error: errors.temperature })}
                className={`${input} tabular-nums`}
              />
            </FormField>
          </div>

          <FormField
            id="system_prompt"
            label="System prompt"
            hint="The instructions. Placeholders in double braces are filled in on every run."
            count={count(values.system_prompt, SYSTEM_PROMPT_MAX)}
            error={errors.system_prompt}
          >
            <textarea
              id="system_prompt"
              name="system_prompt"
              rows={16}
              required
              spellCheck={false}
              value={values.system_prompt}
              onChange={update}
              aria-invalid={errors.system_prompt ? true : undefined}
              aria-describedby={describedBy("system_prompt", { hint: true, count: true, error: errors.system_prompt })}
              className={`${input} resize-y font-mono text-xs leading-relaxed`}
            />
          </FormField>

          <FormField
            id="user_prompt"
            label="User prompt"
            hint="The message sent with the photo (or alone, for Text only), e.g. Roast this.{{note}}"
            count={count(values.user_prompt, USER_PROMPT_MAX)}
            error={errors.user_prompt}
          >
            <textarea
              id="user_prompt"
              name="user_prompt"
              rows={4}
              required
              spellCheck={false}
              value={values.user_prompt}
              onChange={update}
              aria-invalid={errors.user_prompt ? true : undefined}
              aria-describedby={describedBy("user_prompt", { hint: true, count: true, error: errors.user_prompt })}
              className={`${input} resize-y font-mono text-xs leading-relaxed`}
            />
          </FormField>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {step ? (
              <SubmitButton pendingText="Saving…">Save step</SubmitButton>
            ) : (
              <SubmitButton pendingText="Adding…">Add step</SubmitButton>
            )}
            <div role="status" className={`text-sm ${state.ok ? "text-ink" : "text-danger"}`}>
              <p>{message}</p>
              {problems.length > 0 && (
                <>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                  <p className="mt-1 text-ink">
                    {LIVE_TIP}{" "}
                    <Link href={`/prompt-chains/new?from=${chainId}`} className={textLink}>
                      Duplicate this chain
                    </Link>
                  </p>
                </>
              )}
            </div>
          </div>
        </form>
      </section>

      <aside aria-label="Placeholders" className="min-w-0 space-y-6">
        <section aria-labelledby="used-heading" className={`${card} p-5`}>
          <h2 id="used-heading" className="font-semibold">
            Placeholders used
          </h2>
          <UsedPlaceholders report={report} warnings={warnings} />
        </section>
        <PlaceholderLegend />
      </aside>
    </div>
  );
}

function UsedPlaceholders({
  report,
  warnings,
}: {
  report: ReturnType<typeof placeholderReport>;
  warnings: string[];
}) {
  const none = report.known.length === 0 && report.unknown.length === 0 && report.ignored.length === 0;
  const code = "rounded bg-canvas px-1 font-mono text-xs";
  return (
    <div className="mt-2 space-y-3 text-sm">
      {none && <p className="text-muted">None yet. The prompts are sent exactly as written.</p>}
      {report.known.length > 0 && (
        <div>
          <p className="text-muted">Filled in on every run:</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {report.known.map((key) => (
              <li key={key} className={code}>{`{{${key}}}`}</li>
            ))}
          </ul>
        </div>
      )}
      {report.unknown.length > 0 && (
        <div className="text-danger">
          <p>Not placeholders, so the chain can’t run with them:</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {report.unknown.map((key) => (
              <li key={key} className={code}>{`{{${key}}}`}</li>
            ))}
          </ul>
        </div>
      )}
      {report.ignored.length > 0 && (
        <div className="text-danger">
          <p>Won’t be replaced: the model gets these exactly as typed.</p>
          <ul className="mt-1 space-y-1">
            {report.ignored.map(({ text, suggestion }) => (
              <li key={text}>
                <span className={code}>{text}</span>
                {suggestion && (
                  <>
                    {" "}
                    did you mean <span className={code}>{`{{${suggestion}}}`}</span>?
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-danger">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// A radio group, so it can carry aria-invalid and take focus when refused
function Choices({
  name,
  legend,
  hint,
  error,
  children,
}: {
  name: string;
  legend: string;
  hint: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <fieldset
      role="radiogroup"
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(name, { hint: true, error })}
      tabIndex={error ? -1 : undefined}
      className="rounded-sm"
    >
      <legend className={label}>{legend}</legend>
      <div className="mt-2 flex flex-col gap-2">{children}</div>
      <p id={`${name}-hint`} className="mt-2 text-sm text-muted">
        {hint}
      </p>
      {error && (
        <p id={`${name}-error`} className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}

function Choice({
  name,
  value,
  checked,
  onChange,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex w-fit items-center gap-2 text-sm">
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="size-4 accent-accent" />
      {children}
    </label>
  );
}
