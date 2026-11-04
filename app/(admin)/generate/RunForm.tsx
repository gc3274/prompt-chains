"use client";

import Image from "next/image";
import { useActionState, useEffect, useRef, useState, type ChangeEvent } from "react";
import FormField from "@/components/FormField";
import SubmitButton from "@/components/SubmitButton";
import { errorBox, input } from "@/components/ui";
import { topicInfo } from "@/lib/roasts";
import { restoreChoices } from "@/lib/restore-choices";
import { chainChoiceLabel, RUN_INITIAL, type ChainChoice, type RunState } from "@/lib/runs";
import { runChain } from "./actions";

type Photo = { id: string; imageUrl: string; topic: string; createdAt: string };

type RunFormProps = {
  chains: ChainChoice[];
  // null when no chain can run
  chainId: number | null;
  photos: Photo[];
};

const DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
});

type Values = { chainId: string; imageId: string };

export default function RunForm({ chains, chainId, photos }: RunFormProps) {
  const [state, formAction] = useActionState<RunState, FormData>(runChain, RUN_INITIAL);
  const [values, setValues] = useState<Values>({ chainId: chainId === null ? "" : String(chainId), imageId: "" });
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  // React resets the form after each submit; put the choices back from state
  useEffect(() => {
    restoreChoices(formRef.current, values);
  }, [state, values]);

  useEffect(() => {
    if (state.error) errorRef.current?.focus();
  }, [state]);

  function update(event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = event.target;
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  const chosen = chains.find((c) => String(c.id) === values.chainId);
  const ready = chosen !== undefined && chosen.problems === 0 && values.imageId !== "";

  return (
    <form ref={formRef} action={formAction} className="mt-3 space-y-6">
      <fieldset>
        <legend className="sr-only">Photo</legend>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {photos.map((p) => {
            const topic = topicInfo(p.topic);
            const name = `${topic ? topic.label : "Photo"}, posted ${DATE.format(new Date(p.createdAt))}`;
            return (
              <li key={p.id}>
                <label className="block cursor-pointer">
                  <input
                    type="radio"
                    name="imageId"
                    value={p.id}
                    onChange={update}
                    className="peer sr-only"
                    required
                  />
                  <span className="block overflow-hidden rounded-xl border-2 border-line bg-surface peer-checked:border-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
                    <Image
                      src={p.imageUrl}
                      alt={name}
                      width={240}
                      height={240}
                      className="aspect-square w-full bg-canvas object-cover"
                    />
                    <span className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
                      <span className="truncate">
                        {topic ? `${topic.emoji} ${topic.label}` : "Photo"}
                      </span>
                      <span className="shrink-0 text-muted">{DATE.format(new Date(p.createdAt))}</span>
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div className="flex flex-wrap items-end gap-4">
        <div className="w-full max-w-sm">
          <FormField
            id="chainId"
            label="Chain"
            hint="A chain that can’t run is listed so you can find it, but it can’t be picked."
          >
            <select
              id="chainId"
              name="chainId"
              defaultValue={values.chainId}
              onChange={update}
              aria-describedby="chainId-hint"
              required
              className={input}
            >
              {chainId === null && <option value="">No chain can run</option>}
              {chains.map((c) => (
                <option key={c.id} value={c.id} disabled={c.problems > 0}>
                  {chainChoiceLabel(c)}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <SubmitButton disabled={!ready} pendingText="Running the chain… up to a minute">
          Run the chain
        </SubmitButton>
      </div>
      {!ready && (
        <p className="-mt-3 text-sm text-muted">
          {values.imageId === "" ? "Pick a photo above to run the chain on." : "Pick a chain that can run."}
        </p>
      )}

      {state.error && (
        <div ref={errorRef} tabIndex={-1} role="alert" className={errorBox}>
          <p>{state.error}</p>
          {state.problems && state.problems.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {state.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
