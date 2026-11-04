import type { Metadata } from "next";
import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import type { ReactNode } from "react";
import Badge from "@/components/Badge";
import EmptyState from "@/components/EmptyState";
import Thumb from "@/components/Thumb";
import { button, card, errorBox, focusRing, noticeBox, textLink } from "@/components/ui";
import { isUuid } from "@/lib/captions";
import { getRequest, type RequestDetail, type ResponseSummary } from "@/lib/data/requests";
import { requireSuperadmin } from "@/lib/dal";
import { loadPanel } from "@/lib/data/generation";
import { formatTokens, formatUsd, nouns } from "@/lib/format";
import { hrefWith } from "@/lib/params";
import type { Tally } from "@/lib/limits";
import {
  chainUse,
  displayStatus,
  FALLBACK_REASONS,
  formatDuration,
  photoState,
  REQUEST_STATUS_INFO,
  RESPONSE_STATUS_INFO,
  SOURCE_LABELS,
  tokensLabel,
  type DisplayStatus,
} from "@/lib/requests";
import { parseTopic, RATING_MAX, topicInfo, type Critic } from "@/lib/roasts";
import { readResult, type RunResult } from "@/lib/runs";
import RunAgain from "./RunAgain";

export const metadata: Metadata = {
  title: "Run",
};

// Read on every request: this page must never be prerendered with service-role data
export const dynamic = "force-dynamic";

// Also the limit for Run again, which posts runChain from this page
export const maxDuration = 60;

const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

function When({ iso }: { iso: string }) {
  return <time dateTime={iso}>{DATE_TIME.format(new Date(iso))}</time>;
}

const pre =
  "mt-1 rounded-lg border border-line bg-canvas p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap";

const backLink = (
  <Link href="/runs" className={`text-sm ${textLink}`}>
    All runs
  </Link>
);

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function RunPage({ params, searchParams }: PageProps<"/runs/[id]">) {
  await requireSuperadmin();

  const { id } = await params;
  if (!isUuid(id)) notFound();
  // Set by runChain's redirect
  const ran = first((await searchParams).ran) === "1";

  let request: RequestDetail | null = null;
  let critics: Critic[] | null = null;
  let failed = false;
  try {
    request = await getRequest(id.toLowerCase());
    const topic = parseTopic(request?.topic ?? null);
    // Only to read the reviews back; the trace still shows without it
    critics =
      request?.status === "succeeded" && topic
        ? await loadPanel(topic).catch((error: unknown) => {
            unstable_rethrow(error);
            console.error("Loading the panel failed", error);
            return null;
          })
        : [];
  } catch (error) {
    unstable_rethrow(error);
    console.error("Loading the run failed", error);
    failed = true;
  }

  if (failed) {
    return (
      <>
        {backLink}
        <p className={`${errorBox} mt-6`}>
          This run couldn’t load. The database didn’t answer, or this server is missing its service
          key. Reload the page to try again.
        </p>
      </>
    );
  }
  if (!request) notFound();

  const status = displayStatus(request.status, request.createdAt, request.readAt);
  const info = REQUEST_STATUS_INFO[status];
  const topic = topicInfo(request.topic);
  const result: RunResult | null = critics ? readResult(request, critics) : null;
  // A run with its chain and photo still there can go again
  const rerun =
    request.chainId !== null && request.imageId !== null && topic !== null
      ? { chainId: request.chainId, imageId: request.imageId }
      : null;

  return (
    <>
      {backLink}
      <div className="mt-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <h1 className="font-display text-3xl font-bold tracking-tight">
          {request.chainName ? `${request.chainName} run` : "Run"}
        </h1>
        {rerun && (
          <div className="flex flex-wrap items-start gap-3">
            <RunAgain chainId={rerun.chainId} imageId={rerun.imageId} />
            <Link href={hrefWith("/generate", {}, { chain: rerun.chainId })} className={button("secondary")}>
              Another photo
            </Link>
          </div>
        )}
      </div>
      <p className="mt-2 max-w-prose text-muted">
        {info.meaning}{" "}
        {request.source === "admin"
          ? "Run from Generate here or from the admin, so it used up no one’s daily posts."
          : status === "limited"
            ? "A refused try doesn’t count toward the uploader’s daily limit."
            : "Posted from the main app, so it counts toward the uploader’s daily limit."}
      </p>
      {ran && (
        <p role="status" className={`${request.status === "succeeded" ? noticeBox : errorBox} mt-6`}>
          {request.status === "succeeded"
            ? "The chain ran. Nothing was posted: these reviews live only on this page."
            : "The run didn’t finish with reviews. The notes and the steps below show how far it got."}
        </p>
      )}

      <Result result={result} roastCount={request.roastCount} source={request.source} />

      <section aria-labelledby="summary-heading" className={`${card} mt-8 p-5 sm:p-6`}>
        <h2 id="summary-heading" className="text-xl font-semibold tracking-tight">
          Summary
        </h2>
        <dl className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          <Field term="Status">
            <Badge tone={info.tone}>{info.label}</Badge>
          </Field>
          <Field term="Source">
            {SOURCE_LABELS[request.source]}
            <span className="mt-1 block text-xs text-muted">
              {request.source === "app" ? "Posted from the main app." : "Run from Generate here or from the admin."}
            </span>
          </Field>
          <Field term={request.source === "app" ? "Uploader" : "Who ran it"}>
            {request.who.name ?? <span className="text-muted">someone with no name yet</span>}
          </Field>
          <Field term="Topic">{topic ? topic.label : <span className="text-muted">Not recorded</span>}</Field>
          <Field term="Chain">
            <Chain request={request} status={status} />
          </Field>
          <Field term="Started">
            <When iso={request.createdAt} />
          </Field>
          <Field term="Finished">
            {request.finishedAt ? <When iso={request.finishedAt} /> : <span className="text-muted">Not recorded</span>}
          </Field>
          <Field term="Took">{formatDuration(request.durationMs)}</Field>
          <Field term="Cost">
            <RunCost usage={request.usage} />
          </Field>
          <Field term="Roasts saved">
            {request.status === "legacy" ? <span className="text-muted">Not recorded</span> : request.roastCount}
          </Field>
          <Field term="Photo">
            <Photo request={request} />
          </Field>
          <Field term="Request ID">
            <span className="font-mono text-xs break-all">{request.id}</span>
          </Field>
        </dl>
        {request.error && (
          <div className="mt-5">
            <h3 className="text-sm text-muted">Error and notes</h3>
            <pre className={pre}>{request.error}</pre>
          </div>
        )}
      </section>

      <Timeline request={request} status={status} />
    </>
  );
}

function Field({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted">{term}</dt>
      <dd className="mt-1 break-words">{children}</dd>
    </div>
  );
}

function Chain({ request, status }: { request: RequestDetail; status: DisplayStatus }) {
  const use = chainUse(request);
  if (use === "chain") {
    return (
      <Link href={`/prompt-chains/${request.chainId}`} className={textLink}>
        {request.chainName ?? `Chain ${request.chainId}`}
      </Link>
    );
  }
  if (use === "built-in") {
    return (
      <>
        Built-in chain
        <span className="mt-1 block text-xs text-muted">
          The database had no usable chain, so the one-pass prompt built into the app ran. The notes
          say why.
        </span>
      </>
    );
  }
  if (use === "deleted") {
    return (
      <>
        A deleted chain
        <span className="mt-1 block text-xs text-muted">
          The chain this run used has been deleted since. Its model calls below still show what ran.
        </span>
      </>
    );
  }
  const why =
    status === "legacy"
      ? "Not recorded for runs from before request logging."
      : status === "pending"
        ? "None yet: it’s still running."
        : status === "unfinished"
          ? "Not recorded: the run never finished."
          : status === "limited"
            ? "None: a posting limit stopped it."
            : "None: the run stopped before a chain was picked.";
  return <span className="text-muted">{why}</span>;
}

// The run's priced calls added up, with its tokens and what the sum leaves out
function RunCost({ usage }: { usage: Tally }) {
  if (usage.calls === 0) return <span className="text-muted">None: no model was called</span>;
  const priced = usage.calls - usage.withoutCost;
  const tokens = usage.inputTokens + usage.outputTokens > 0;
  return (
    <>
      {priced === 0 ? (
        <span className="text-muted">Not recorded</span>
      ) : (
        <span className="tabular-nums">
          {usage.withoutCost > 0 && "at least "}
          {formatUsd(usage.costUsd)}
        </span>
      )}
      <span className="mt-1 block text-xs text-muted tabular-nums">
        {tokens
          ? `${formatTokens(usage.inputTokens)} input and ${formatTokens(usage.outputTokens)} output tokens`
          : "No tokens recorded"}
        {usage.withoutCost > 0 && `; ${nouns(usage.withoutCost, "call")} without a cost`}.
      </span>
    </>
  );
}

function Photo({ request }: { request: RequestDetail }) {
  const photo = photoState(request);
  if (photo === "post" && request.imageId) {
    return <Thumb src={request.imageUrl} alt="The photo this run judged" size={96} />;
  }
  if (photo === "deleted") return <span className="text-muted">Photo deleted</span>;
  return <span className="text-muted">No post was saved from this run.</span>;
}

function Timeline({ request, status }: { request: RequestDetail; status: DisplayStatus }) {
  const { responses } = request;
  const empty =
    status === "limited"
      ? "A posting limit stopped it, so no model was called."
      : status === "legacy"
        ? "Runs from before request logging have no model calls on record."
        : status === "pending"
          ? "The model hasn’t answered yet."
          : "It stopped before any model was called, or its calls couldn’t be logged.";

  return (
    <section aria-labelledby="calls-heading" className="mt-10">
      <h2 id="calls-heading" className="text-xl font-semibold tracking-tight">
        Steps
      </h2>
      {responses.length === 0 ? (
        <div className="mt-4">
          <EmptyState title="No model calls for this run.">{empty}</EmptyState>
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted">
            {nouns(responses.length, "model call")}, in the order they were made: each step’s answer,
            and the exact prompts it was sent.
          </p>
          <ol className={`${card} mt-4 divide-y divide-line`}>
            {responses.map((r) => (
              <Call key={r.id} response={r} />
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function Call({ response }: { response: ResponseSummary }) {
  const status = RESPONSE_STATUS_INFO[response.status];
  const tokens = tokensLabel(response.inputTokens, response.outputTokens);
  return (
    <li className="p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <span className="font-medium">Step {response.stepOrder}</span>
        <span className="font-mono text-xs break-all text-muted">{response.providerModelId}</span>
        {response.isFallback && (
          <Badge>
            Fallback{response.fallbackReason ? `: ${FALLBACK_REASONS[response.fallbackReason]}` : ""}
          </Badge>
        )}
        <Badge tone={status.tone}>{status.label}</Badge>
        <span className="tabular-nums text-muted">{formatDuration(response.durationMs)}</span>
        <span className="tabular-nums text-muted">
          {tokens
            ? `${tokens} tokens, ${response.costUsd === null ? "no price" : formatUsd(response.costUsd)}`
            : "Tokens not recorded"}
        </span>
      </div>
      {/* The step as it is now; it may have been edited since. The prompts below are what was sent. */}
      {response.step && <p className="mt-1 text-sm break-words">{response.step.description}</p>}
      {response.error && <p className="mt-1 text-sm break-words text-danger">{response.error}</p>}

      <h3 className="mt-3 text-sm text-muted">Answer</h3>
      {response.responseText === null ? (
        <p className="mt-1 text-sm text-muted">No answer came back.</p>
      ) : (
        <pre className={`${pre} max-h-96 overflow-y-auto`}>{response.responseText}</pre>
      )}

      <details className="mt-3">
        <summary className={`cursor-pointer text-sm font-medium text-accent ${focusRing} rounded-sm`}>
          Prompts sent
          {response.temperature !== null && <span className="font-normal text-muted"> · temperature {response.temperature}</span>}
        </summary>
        <h4 className="mt-3 text-xs text-muted">System prompt</h4>
        <pre className={`${pre} max-h-96 overflow-y-auto`}>{response.systemPrompt}</pre>
        <h4 className="mt-3 text-xs text-muted">User prompt</h4>
        <pre className={`${pre} max-h-96 overflow-y-auto`}>{response.userPrompt}</pre>
      </details>
    </li>
  );
}

function Result({ result, roastCount, source }: { result: RunResult | null; roastCount: number; source: string }) {
  if (result === null) {
    return (
      <p className={`${errorBox} mt-8`}>
        The critics couldn’t load, so the reviews can’t be read back here. The last step’s answer
        below still has them.
      </p>
    );
  }
  if (result.kind === "none") return null;

  // A run from the main app saved its roasts; one from here kept them only in the log
  const saved =
    source === "app" || roastCount > 0
      ? `${nouns(roastCount, "roast")} saved from this run.`
      : "Not saved anywhere else: read back from the last step’s answer.";

  return (
    <section aria-labelledby="result-heading" className="mt-8">
      <h2 id="result-heading" className="text-xl font-semibold tracking-tight">
        What it made
      </h2>
      <p className="mt-1 text-sm text-muted">{saved}</p>
      {result.kind === "unreadable" ? (
        <p className={`${errorBox} mt-4`}>
          The last step’s answer no longer reads as reviews for this topic’s panel (a critic may have
          changed since). The raw answer is under Steps.
        </p>
      ) : (
        <ul className="mt-4 grid gap-4 md:grid-cols-2">
          {result.reviews.map((r) => (
            <li key={r.criticId} className={`${card} p-5`}>
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium">
                  <span aria-hidden="true">{r.critic.emoji}</span> {r.critic.name}
                </p>
                {r.rating !== null && (
                  <span className="shrink-0 rounded-full bg-canvas px-2.5 py-0.5 text-sm font-semibold tabular-nums">
                    {r.rating}/{RATING_MAX}
                  </span>
                )}
              </div>
              <p className="mt-2 break-words">{r.content}</p>
              {r.tip && (
                <p className="mt-3 text-sm break-words text-muted">
                  <span className="font-medium text-ink">Tip:</span> {r.tip}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
