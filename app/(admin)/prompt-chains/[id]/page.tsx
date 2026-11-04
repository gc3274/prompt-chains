import type { Metadata } from "next";
import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import type { ReactNode } from "react";
import Badge from "@/components/Badge";
import ConfirmAction from "@/components/ConfirmAction";
import ConfirmDelete from "@/components/ConfirmDelete";
import PlaceholderLegend from "@/components/PlaceholderLegend";
import SubmitButton from "@/components/SubmitButton";
import { button, card, errorBox, focusRing, noticeBox, textLink } from "@/components/ui";
import { CALLABLE_PROVIDER, FALLBACK_MODEL, renderTemplate } from "@/lib/chains";
import { loadPromptInputs, type PromptInputs } from "@/lib/data/generation";
import { getChainDetail, type ChainDetail, type StepDetail } from "@/lib/data/prompts";
import { requireSuperadmin } from "@/lib/dal";
import { nouns } from "@/lib/format";
import { parseId } from "@/lib/forms";
import { hrefWith } from "@/lib/params";
import {
  CHAIN_ERRORS,
  CHAIN_PAGE_ERRORS,
  chainStatus,
  checkStepChange,
  INPUT_LABELS,
  isLive,
  LIVE_TIP,
  OUTPUT_LABELS,
  parseChainPageQuery,
  previewVars,
  refusedChange,
  STEPS_MAX,
  statusLine,
  stepLocks,
  type ChainPageQuery,
  type StepLock,
} from "@/lib/prompt-chains";
import { TOPICS, topicInfo, type Topic } from "@/lib/roasts";
import { deleteChain, deleteStep, moveStep, setDefaultChain } from "../actions";

export const metadata: Metadata = {
  title: "Prompt chain",
};

// Read on every request: this page must never be prerendered with service-role data
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
});

const pre =
  "mt-2 rounded-lg border border-line bg-canvas p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap";

const backLink = (
  <Link href="/prompt-chains" className={`text-sm ${textLink}`}>
    All prompt chains
  </Link>
);

export default async function PromptChainPage({ params, searchParams }: PageProps<"/prompt-chains/[id]">) {
  await requireSuperadmin();

  const id = parseId((await params).id);
  if (id === null) notFound();
  const query = parseChainPageQuery(await searchParams);
  // The preview fills in this topic's panel, terms and examples
  const topic: Topic = query.topic ?? TOPICS[0].slug;

  let chain: ChainDetail | null = null;
  let inputs: PromptInputs | null = null;
  let failed = false;
  try {
    [chain, inputs] = await Promise.all([
      getChainDetail(id),
      // Once per page, for every step's preview; the page still works without it
      loadPromptInputs(topic).catch((error: unknown) => {
        unstable_rethrow(error);
        console.error("Loading the preview values failed", error);
        return null;
      }),
    ]);
  } catch (error) {
    unstable_rethrow(error);
    console.error("Loading the prompt chain failed", error);
    failed = true;
  }

  if (failed) {
    return (
      <>
        {backLink}
        <p className={`${errorBox} mt-6`}>
          This prompt chain couldn’t load. The database didn’t answer, or this server is missing its
          service key. Reload the page to try again.
        </p>
      </>
    );
  }
  if (!chain) notFound();

  const standing = { isDefault: chain.isDefault, weight: chain.weight, problems: chain.problems.length };
  const status = chainStatus(standing);
  const live = isLive(chain);
  const locks = stepLocks(chain, chain.runnable);
  const full = chain.steps.length >= STEPS_MAX;

  return (
    <>
      {backLink}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-bold tracking-tight break-words">{chain.name}</h1>
        {chain.isDefault && <Badge tone="accent">Default</Badge>}
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <p className="mt-2 max-w-prose text-muted">{chain.description}</p>
      <p className="mt-3 max-w-prose font-medium">{statusLine(standing)}</p>

      <div className="mt-5 flex flex-wrap items-start gap-3">
        {chain.problems.length === 0 && (
          <Link href={hrefWith("/generate", {}, { chain: chain.id })} className={button()}>
            Run on a photo
          </Link>
        )}
        {!(chain.isDefault && chain.weight === 100) && <MakeDefault chain={chain} />}
        <Link href={`/prompt-chains/${chain.id}/edit`} className={button("secondary")}>
          Edit details
        </Link>
        <Link href={hrefWith("/prompt-chains/new", {}, { from: chain.id })} className={button("secondary")}>
          Duplicate
        </Link>
      </div>

      <Messages chain={chain} query={query} />

      <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-4 text-sm">
        <Fact term="Slug">
          <span className="font-mono break-all">{chain.slug}</span>
        </Fact>
        <Fact term="Share of new roasts">
          <Link href="/chain-mix" className={textLink}>
            {chain.weight}%
          </Link>
        </Fact>
        <Fact term="Steps">{chain.steps.length}</Fact>
        <Fact term="Updated">
          <time dateTime={chain.updatedAt}>{DATE.format(new Date(chain.updatedAt))}</time>
        </Fact>
        <Fact term="Log">
          <Link href={hrefWith("/runs", {}, { chain: chain.id })} className={textLink}>
            Runs that used this chain
          </Link>
        </Fact>
        <Fact term="Media">
          <Link href={hrefWith("/media", {}, { chain: chain.id })} className={textLink}>
            See what it made
          </Link>
        </Fact>
      </dl>

      {chain.problems.length > 0 && (
        <div role="note" className={`${errorBox} mt-6`}>
          <p>
            This chain can’t run as it stands, so a run that picks it falls back to{" "}
            {chain.isDefault || !chain.defaultChain ? (
              "the one-pass prompt built into the app"
            ) : (
              <>
                the default chain,{" "}
                <Link href={`/prompt-chains/${chain.defaultChain.id}`} className="font-medium underline">
                  {chain.defaultChain.name}
                </Link>
              </>
            )}
            .{live ? "" : " Fix these before you make it the default or give it a share."}
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {chain.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby="steps-heading" className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <h2 id="steps-heading" className="text-xl font-semibold tracking-tight">
              Steps, in the order they run
            </h2>
            {!full && (
              <Link href={`/prompt-chains/${chain.id}/steps/new`} className={button("secondary", "sm")}>
                Add a step
              </Link>
            )}
          </div>
          <p className="mt-1 text-sm text-muted">
            {chain.steps.length === 0
              ? "No steps yet. Add the first one; whichever step is last writes the reviews."
              : `${nouns(chain.steps.length, "call")} to the model per run, plus a fallback call when a step needs one.`}
            {full && ` ${CHAIN_ERRORS.chain_full}`}
          </p>
          <TopicSwitch chainId={chain.id} topic={topic} chosen={query.topic !== null} />
          {inputs && inputs.problems.length > 0 && (
            <p className="mt-2 text-sm text-danger">
              Some sample values couldn’t load, so the preview leaves them empty: {inputs.problems.join("; ")}.
            </p>
          )}
          {!inputs && (
            <p className="mt-2 text-sm text-danger">
              The sample values couldn’t load, so the previews are off. Reload the page to try again.
            </p>
          )}
          <ol className="mt-4 space-y-6">
            {chain.steps.map((s, i) => (
              <StepCard
                key={s.id}
                chain={chain}
                step={s}
                first={i === 0}
                last={i === chain.steps.length - 1}
                lock={locks.get(s.id)}
                preview={inputs && previewOf(s, inputs, topic, query.topic !== null)}
              />
            ))}
          </ol>
        </section>

        <aside aria-label="How the prompts are filled in" className="min-w-0 space-y-6">
          <section aria-labelledby="fallback-heading" className={`${noticeBox}`}>
            <h2 id="fallback-heading" className="font-semibold">
              Fallback
            </h2>
            <p className="mt-1">
              When a step’s model is busy, can’t be found, rejects the request as invalid, or isn’t callable, that step
              is retried once on <span className="font-mono break-all">{FALLBACK_MODEL}</span>.
            </p>
          </section>
          <PlaceholderLegend />
        </aside>
      </div>

      <section aria-labelledby="delete-heading" className={`${card} mt-10 max-w-2xl p-5 sm:p-6`}>
        <h2 id="delete-heading" className="text-xl font-semibold tracking-tight">
          Delete
        </h2>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Removes this chain and its steps. Only a chain no roast reaches can be deleted: not the
          default, and not one with a share on Chain mix.
        </p>
        <div className="mt-4">
          <ConfirmDelete
            action={deleteChain}
            fields={{ id: String(chain.id) }}
            noun="chain"
            warning={`Its ${nouns(chain.steps.length, "step")} ${chain.steps.length === 1 ? "goes" : "go"} with it. Requests and responses that used it keep the exact prompts they sent but lose the link to this chain. This can’t be undone.`}
            blockedReason={
              chain.isDefault
                ? "This is the default chain, so it can’t be deleted: roasts fall back to it. Make another chain the default first."
                : chain.weight > 0
                  ? `New roasts still use this chain (${chain.weight}%). Set its share to 0 on Chain mix first.`
                  : null
            }
          />
        </div>
      </section>
    </>
  );
}

function MakeDefault({ chain }: { chain: ChainDetail }) {
  const current = chain.defaultChain && chain.defaultChain.id !== chain.id ? chain.defaultChain : null;
  return (
    <ConfirmAction
      action={setDefaultChain}
      fields={{ id: String(chain.id) }}
      label={chain.isDefault ? "Send every roast here" : "Make default"}
      pendingText="Saving…"
      title={chain.isDefault ? `Send every new roast to ${chain.name}?` : `Make ${chain.name} the default?`}
      blockedReason={
        chain.problems.length > 0
          ? chain.isDefault
            ? "It can’t run as it stands, so it can’t take every roast. Fix the problems below first."
            : "It can’t run as it stands, so it can’t be the default. Fix the problems below first."
          : null
      }
    >
      <p>
        Chain mix will give this chain 100% of new roasts and set every other chain to 0%, starting
        with the next roast.
      </p>
      {!chain.isDefault && (
        <p>
          It also becomes the backup that runs when a picked chain can’t run
          {current ? `, taking over from ${current.name}` : ""}.
        </p>
      )}
      <p>You can share roasts between chains again on Chain mix at any time.</p>
    </ConfirmAction>
  );
}

const NOTICES: Record<NonNullable<ChainPageQuery["notice"]>, string> = {
  created:
    "Chain created. It’s a draft: no roasts use it until you make it the default or give it a share on Chain mix.",
  default: "This is now the default chain. Every new roast uses it, and it’s the backup when a picked chain can’t run.",
  added: "Step added.",
  moved: "Step moved.",
  deleted: "Step deleted. Its logged responses keep the prompts it sent.",
};

// What the last action did, from the redirect's query
function Messages({ chain, query }: { chain: ChainDetail; query: ChainPageQuery }) {
  if (query.error === "live") {
    // Checked again against the chain as it is now, to list what it would break
    const change = refusedChange(query.change, query.target);
    const check = change && checkStepChange(chain, chain.runnable, change);
    const problems = check && !check.ok && "problems" in check ? check.problems : [];
    return (
      <div role="alert" className={`${errorBox} mt-6`}>
        <p>{CHAIN_PAGE_ERRORS.live}</p>
        {problems.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <p className="mt-2">
          {LIVE_TIP}{" "}
          <Link href={hrefWith("/prompt-chains/new", {}, { from: chain.id })} className="font-medium underline">
            Duplicate this chain
          </Link>
        </p>
      </div>
    );
  }
  if (query.error) {
    return (
      <p role="alert" className={`${errorBox} mt-6`}>
        {CHAIN_PAGE_ERRORS[query.error]}
      </p>
    );
  }
  if (!query.notice) return null;
  const stepNotice = query.notice === "added" || query.notice === "moved" || query.notice === "deleted";
  return (
    <p role="status" className={`${noticeBox} mt-6`}>
      {NOTICES[query.notice]}
      {stepNotice &&
        (isLive(chain)
          ? " The next roast uses the chain as it is now."
          : " This chain is a draft, so no roasts use it yet.")}
    </p>
  );
}

function TopicSwitch({ chainId, topic, chosen }: { chainId: number; topic: Topic; chosen: boolean }) {
  return (
    <nav aria-label="Preview topic" className="mt-4 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted">Preview as a photo of:</span>
      {TOPICS.map((t) => {
        const current = t.slug === topic;
        return (
          <Link
            key={t.slug}
            href={hrefWith(`/prompt-chains/${chainId}`, {}, { topic: t.slug })}
            aria-current={current && chosen ? "true" : undefined}
            className={`rounded-full border px-3 py-1 ${focusRing} ${
              current ? "border-accent/30 bg-accent/10 text-accent" : "border-line bg-surface hover:bg-canvas"
            }`}
          >
            {t.emoji} {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted">{term}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

// "a", "a or b", "a, b or c"
function orList(items: string[]): string {
  return items.length <= 2 ? items.join(" or ") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

function temperatureText(step: StepDetail): string {
  if (step.temperature === null) return "Not sent";
  if (step.model && !step.model.temperatureSupported) return "Not sent: the model doesn’t take one";
  return String(step.temperature);
}

type Preview = { open: boolean; topic: Topic; system: string; user: string };

// The step's prompts as a run for this topic would fill them in. Open when the
// admin picked a topic, so switching topics keeps the previews in view.
function previewOf(step: StepDetail, inputs: PromptInputs, topic: Topic, open: boolean): Preview {
  const vars = previewVars(inputs, topic, step.order);
  return {
    open,
    topic,
    system: renderTemplate(step.systemPrompt, vars),
    user: renderTemplate(step.userPrompt, vars),
  };
}

function StepCard({
  chain,
  step,
  first,
  last,
  lock,
  preview,
}: {
  chain: ChainDetail;
  step: StepDetail;
  first: boolean;
  last: boolean;
  // What moving or deleting it would break while the chain is live
  lock: StepLock | undefined;
  preview: Preview | null;
}) {
  const { model } = step;
  const callable = model?.provider?.slug === CALLABLE_PROVIDER;
  const headingId = `step-${step.id}-heading`;
  const noteId = `step-${step.id}-locked`;
  const only = chain.steps.length <= 1;
  const live = isLive(chain);
  const upLocked = !first && (lock?.up.length ?? 0) > 0;
  const downLocked = !last && (lock?.down.length ?? 0) > 0;
  const removeLocked = !only && (lock?.remove.length ?? 0) > 0;
  // What each locked button would break, for the note under them
  const locked = [
    upLocked && { what: "moving it up", problem: lock?.up[0] },
    downLocked && { what: "moving it down", problem: lock?.down[0] },
    removeLocked && { what: "deleting it", problem: lock?.remove[0] },
  ].filter((l) => l !== false);
  const hasNote = only || locked.length > 0;

  return (
    <li id={`step-${step.id}`} className={`${card} p-5 sm:p-6`}>
      <section aria-labelledby={headingId}>
        <h3 id={headingId} className="text-lg font-semibold tracking-tight">
          Step {step.order}
        </h3>
        <p className="mt-1 text-muted">{step.description}</p>

        <div className="mt-4 flex flex-wrap items-start gap-2">
          <Link href={`/prompt-chains/${chain.id}/steps/${step.id}`} className={button("secondary", "sm")}>
            Edit
          </Link>
          {!first && <MoveForm chainId={chain.id} stepId={step.id} direction="up" locked={upLocked} noteId={noteId} />}
          {!last && <MoveForm chainId={chain.id} stepId={step.id} direction="down" locked={downLocked} noteId={noteId} />}
          {only || removeLocked ? (
            <button type="button" disabled aria-describedby={noteId} className={button("danger", "sm")}>
              Delete step
            </button>
          ) : (
            <ConfirmAction
              action={deleteStep}
              fields={{ chain: String(chain.id), id: String(step.id) }}
              label="Delete step"
              pendingText="Deleting…"
              title={`Delete step ${step.order}?`}
              variant="danger"
              size="sm"
            >
              <p>
                The steps after it move up one place
                {live ? ", and the next roast runs the chain without it" : ""}. Logged responses keep
                the prompts this step sent. This can’t be undone.
              </p>
            </ConfirmAction>
          )}
        </div>
        {hasNote && (
          <div id={noteId} className="mt-2 max-w-prose space-y-1 text-sm text-muted">
            {only && <p>{CHAIN_ERRORS.only_step}</p>}
            {locked.length > 0 && (
              <p>
                Locked while this chain is live: {orList(locked.map((l) => l.what))} would stop it from
                running ({locked[0].problem}). {LIVE_TIP}
              </p>
            )}
          </div>
        )}

        <dl className="mt-4 grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
          <Fact term="Input">{step.inputType ? INPUT_LABELS[step.inputType] : "Unknown"}</Fact>
          <Fact term="Output">{step.outputType ? OUTPUT_LABELS[step.outputType] : "Unknown"}</Fact>
          <Fact term="Model">
            {model ? (
              <span className="flex flex-col items-start gap-1">
                <span>{model.name}</span>
                <span className="font-mono text-xs break-all text-muted">{model.providerModelId}</span>
                {!callable && <Badge tone="danger">Not callable — uses the fallback</Badge>}
              </span>
            ) : (
              "Missing"
            )}
          </Fact>
          <Fact term="Temperature">{temperatureText(step)}</Fact>
          <Fact term="Thinking level">{model?.thinkingLevel ?? "Not sent"}</Fact>
        </dl>

        <h4 className="mt-6 text-sm font-medium">System prompt</h4>
        <pre className={pre}>{step.systemPrompt}</pre>
        <h4 className="mt-4 text-sm font-medium">User prompt</h4>
        <pre className={pre}>{step.userPrompt}</pre>

        {preview && <StepPreview step={step} preview={preview} />}
      </section>
    </li>
  );
}

function MoveForm({
  chainId,
  stepId,
  direction,
  locked,
  noteId,
}: {
  chainId: number;
  stepId: number;
  direction: "up" | "down";
  locked: boolean;
  noteId: string;
}) {
  return (
    <form action={moveStep}>
      <input type="hidden" name="chain" value={chainId} />
      <input type="hidden" name="id" value={stepId} />
      <input type="hidden" name="direction" value={direction} />
      <SubmitButton
        variant="secondary"
        size="sm"
        pendingText="Moving…"
        disabled={locked}
        aria-describedby={locked ? noteId : undefined}
      >
        Move {direction}
      </SubmitButton>
    </form>
  );
}

function StepPreview({ step, preview }: { step: StepDetail; preview: Preview }) {
  const info = topicInfo(preview.topic);
  return (
    <details open={preview.open} className="mt-6 rounded-lg border border-line">
      <summary className={`cursor-pointer rounded-lg px-4 py-3 text-sm font-medium ${focusRing}`}>
        Preview with sample values
      </summary>
      <div className="border-t border-line px-4 pb-4">
        <p className="mt-3 text-sm text-muted">
          What this step sends for a {info ? info.label.toLowerCase() : preview.topic} photo: that
          topic’s panel, terms and examples, and a made-up uploader’s note.
          {step.order > 1 && " The previous step’s answer is marked where it goes."}
          {step.inputType === "image" && " The photo goes with it."}
        </p>
        <h5 className="mt-4 text-sm font-medium">System prompt, filled in</h5>
        <pre className={pre}>{preview.system}</pre>
        <h5 className="mt-4 text-sm font-medium">User prompt, filled in</h5>
        <pre className={pre}>{preview.user}</pre>
      </div>
    </details>
  );
}
