import type { Metadata } from "next";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import Badge from "@/components/Badge";
import EmptyState from "@/components/EmptyState";
import Pagination from "@/components/Pagination";
import { button, card, errorBox, noticeBox, textLink } from "@/components/ui";
import { listChains, type ChainSummary, type DefaultChain } from "@/lib/data/prompts";
import { requireSuperadmin } from "@/lib/dal";
import { nouns } from "@/lib/format";
import { parsePage } from "@/lib/params";
import { chainStatus } from "@/lib/prompt-chains";

export const metadata: Metadata = {
  title: "Prompt chains",
};

// Read on every request: this page must never be prerendered with service-role data
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
});

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

type Loaded = { rows: ChainSummary[]; total: number; defaultChain: DefaultChain | null };

export default async function PromptChainsPage({ searchParams }: PageProps<"/prompt-chains">) {
  await requireSuperadmin();

  const sp = await searchParams;
  const page = parsePage(sp.page);
  let result: Loaded | null = null;
  try {
    result = await listChains(page);
  } catch (error) {
    unstable_rethrow(error);
    console.error("Loading the prompt chains failed", error);
  }

  // Set by deleteChain's redirect
  const gone = first(sp.error) === "gone";
  const deleted = !gone && first(sp.deleted) === "1";

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h1 className="font-display text-3xl font-bold tracking-tight">Prompt chains</h1>
        <div className="flex flex-wrap gap-3">
          <Link href="/generate" className={button("secondary")}>
            Run a chain
          </Link>
          <Link href="/prompt-chains/new" className={button()}>
            New chain
          </Link>
        </div>
      </div>
      <p className="mt-2 max-w-prose text-muted">
        The prompts behind every roast in Deconstructive Criticism. Open a chain to edit it: add,
        change, reorder and delete its steps, and preview each prompt with real values. Then run it
        on a photo under Generate to see what it makes.
      </p>

      {gone && (
        <p role="status" className={`${errorBox} mt-6`}>
          That chain was already deleted.
        </p>
      )}
      {deleted && (
        <p role="status" className={`${noticeBox} mt-6`}>
          Chain deleted. Requests and responses that used it keep the prompts they sent.
        </p>
      )}

      <HowItWorks defaultChain={result?.defaultChain ?? null} />

      {result ? (
        <Results page={page} rows={result.rows} total={result.total} />
      ) : (
        <p className={`${errorBox} mt-6`}>
          The prompt chains couldn’t load. The database didn’t answer, or this server is missing its
          service key. Reload the page to try again.
        </p>
      )}
    </>
  );
}

function HowItWorks({ defaultChain }: { defaultChain: DefaultChain | null }) {
  return (
    <section aria-labelledby="how-heading" className={`${card} mt-6 max-w-3xl p-5 sm:p-6`}>
      <h2 id="how-heading" className="text-lg font-semibold tracking-tight">
        How roasts are made
      </h2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
        <li>
          <Link href="/chain-mix" className={textLink}>
            Chain mix
          </Link>{" "}
          picks a chain for each new roast, by the share each chain has there.
        </li>
        <li>Its steps run in order, each step’s answer feeding the next. The last step returns the reviews.</li>
        <li>
          The default chain
          {defaultChain && (
            <>
              ,{" "}
              <Link href={`/prompt-chains/${defaultChain.id}`} className={textLink}>
                {defaultChain.name}
              </Link>
              ,
            </>
          )}{" "}
          is the backup: when the picked chain can’t run, the roast uses it instead. If it can’t run
          either, the one-pass prompt built into the app runs.
        </li>
        <li>
          Edits apply to the very next roast, and{" "}
          <Link href="/runs" className={textLink}>
            Runs
          </Link>{" "}
          keep the exact prompts each run used.
        </li>
        <li>
          <Link href="/generate" className={textLink}>
            Generate
          </Link>{" "}
          runs any chain that can run, live or draft, on a photo, without posting anything.
        </li>
      </ol>
      <p className="mt-4 max-w-prose text-sm text-muted">
        A live chain (the default, or any with a share) only takes changes that keep it running. To
        try something bigger, duplicate it, change the copy (a draft no roast uses), test it under
        Generate, then make the copy the default.
      </p>
    </section>
  );
}

function Results({ page, rows, total }: { page: number; rows: ChainSummary[]; total: number }) {
  if (rows.length === 0) {
    return (
      <div className="mt-6">
        {total > 0 ? (
          // A hand-typed ?page= past the last page
          <EmptyState
            title={`Page ${page} is past the end of the list.`}
            action={{ href: "/prompt-chains", label: "Go to page 1" }}
          />
        ) : (
          <EmptyState title="No prompt chains yet.">
            The prompt chains migration seeds them. Until it runs, every roast uses the one-pass
            prompt built into the app.
          </EmptyState>
        )}
      </div>
    );
  }

  const th = "py-2 pr-4 font-medium whitespace-nowrap text-muted";

  return (
    <section aria-labelledby="chains-count" className="mt-8">
      <p id="chains-count" className="text-sm text-muted">
        {nouns(total, "chain")}, oldest first
      </p>
      <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-surface px-4">
        <table className="w-full min-w-3xl border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th scope="col" className={th}>Chain</th>
              <th scope="col" className={th}>What it does</th>
              <th scope="col" className={th}>Status</th>
              <th scope="col" className={`${th} text-right`}>Steps</th>
              <th scope="col" className={`${th} text-right`}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const status = chainStatus(c);
              return (
                <tr key={c.id} className="border-b border-line align-top last:border-0">
                  <th scope="row" className="py-3 pr-4 text-left font-normal">
                    <span className="flex flex-wrap items-center gap-2">
                      <Link href={`/prompt-chains/${c.id}`} className={textLink}>
                        {c.name}
                      </Link>
                      {c.isDefault && <Badge tone="accent">Default</Badge>}
                    </span>
                    <p className="mt-0.5 font-mono text-xs break-all text-muted">{c.slug}</p>
                  </th>
                  <td className="max-w-prose py-3 pr-4 break-words">{c.description}</td>
                  <td className="py-3 pr-4">
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums">{c.steps}</td>
                  <td className="py-3 pr-4 text-right whitespace-nowrap">
                    <time dateTime={c.updatedAt}>{DATE.format(new Date(c.updatedAt))}</time>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-6">
        <Pagination pathname="/prompt-chains" query={{ page }} page={page} total={total} />
      </div>
    </section>
  );
}
