import type { Metadata } from "next";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import Badge from "@/components/Badge";
import EmptyState from "@/components/EmptyState";
import FilterBar from "@/components/FilterBar";
import Pagination from "@/components/Pagination";
import Thumb from "@/components/Thumb";
import { button, errorBox, input, label, textLink } from "@/components/ui";
import { listChainOptions, type ChainOption } from "@/lib/data/prompts";
import { listRequests, type RequestRow } from "@/lib/data/requests";
import { requireSuperadmin } from "@/lib/dal";
import { formatUsd, nouns } from "@/lib/format";
import { hrefWith } from "@/lib/params";
import {
  chainUse,
  displayStatus,
  formatDuration,
  parseRequestQuery,
  photoState,
  REQUEST_SOURCES,
  REQUEST_STATUS_INFO,
  REQUEST_STATUSES,
  SOURCE_LABELS,
  type RequestQuery,
} from "@/lib/requests";
import { topicInfo } from "@/lib/roasts";

export const metadata: Metadata = {
  title: "Runs",
};

// Read on every request: this page must never be prerendered with service-role data
export const dynamic = "force-dynamic";

const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const isFiltered = (q: RequestQuery) => q.status !== null || q.source !== null || q.chain !== null;

export default async function RunsPage({ searchParams }: PageProps<"/runs">) {
  await requireSuperadmin();

  const query = parseRequestQuery(await searchParams);
  let result: { rows: RequestRow[]; total: number; readAt: number } | null = null;
  let chains: ChainOption[] = [];
  try {
    [result, chains] = await Promise.all([listRequests(query), listChainOptions()]);
  } catch (error) {
    unstable_rethrow(error);
    console.error("Loading the runs failed", error);
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h1 className="font-display text-3xl font-bold tracking-tight">Runs</h1>
        <Link href="/generate" className={button()}>
          Run a chain
        </Link>
      </div>
      <p className="mt-2 max-w-prose text-muted">
        Every time a chain ran, newest first: posts from the main app, and admin runs, which include
        runs from Generate here. Open one for each step’s prompts and answer. “Legacy” rows are runs
        from before request logging, so their outcome is unknown.
      </p>

      {/* Keyed by the URL, so "Clear filters" also resets the fields */}
      <div key={hrefWith("/runs", query)} className="mt-6">
        <Filters query={query} chains={chains} />
      </div>

      {result ? (
        <Results query={query} rows={result.rows} total={result.total} now={result.readAt} />
      ) : (
        <p className={`${errorBox} mt-6`}>
          The runs couldn’t load. The database didn’t answer, or this server is missing its service
          key. Reload the page to try again.
        </p>
      )}
    </>
  );
}

function Filters({ query, chains }: { query: RequestQuery; chains: ChainOption[] }) {
  return (
    <FilterBar action="/runs" showClear={isFiltered(query)}>
      <label className="flex flex-col gap-1">
        <span className={label}>Status</span>
        <select name="status" defaultValue={query.status ?? ""} className={input}>
          <option value="">Any status</option>
          {REQUEST_STATUSES.map((s) => (
            <option key={s} value={s}>
              {/* Unfinished is a pending row shown differently, so it filters as pending */}
              {s === "pending" ? "Pending or unfinished" : REQUEST_STATUS_INFO[s].label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className={label}>Source</span>
        <select name="source" defaultValue={query.source ?? ""} className={input}>
          <option value="">App or admin</option>
          {REQUEST_SOURCES.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className={label}>Chain</span>
        <select name="chain" defaultValue={query.chain === null ? "" : String(query.chain)} className={input}>
          <option value="">Any chain</option>
          {chains.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
    </FilterBar>
  );
}

function Results({ query, rows, total, now }: { query: RequestQuery; rows: RequestRow[]; total: number; now: number }) {
  if (rows.length === 0) {
    return (
      <div className="mt-6">
        <NoRows query={query} total={total} />
      </div>
    );
  }

  const th = "py-2 pr-4 font-medium whitespace-nowrap text-muted";

  return (
    <section aria-labelledby="runs-count" className="mt-6">
      <p id="runs-count" className="text-sm text-muted">
        {`${nouns(total, "run")}${isFiltered(query) ? (total === 1 ? " matches" : " match") : ""}, newest first`}
      </p>
      <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-surface px-4">
        <table className="w-full min-w-5xl border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th scope="col" className={th}>When</th>
              <th scope="col" className={th}>Who</th>
              <th scope="col" className={th}>Source</th>
              <th scope="col" className={th}>Topic</th>
              <th scope="col" className={th}>Chain</th>
              <th scope="col" className={th}>Status</th>
              <th scope="col" className={`${th} text-right`}>Roasts saved</th>
              <th scope="col" className={`${th} text-right`}>Took</th>
              <th scope="col" className={`${th} text-right`}>Cost</th>
              <th scope="col" className={th}>Photo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Row key={r.id} row={r} now={now} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-6">
        <Pagination pathname="/runs" query={query} page={query.page} total={total} />
      </div>
    </section>
  );
}

function Row({ row, now }: { row: RequestRow; now: number }) {
  const status = REQUEST_STATUS_INFO[displayStatus(row.status, row.createdAt, now)];
  const topic = topicInfo(row.topic);
  const use = chainUse(row);
  const photo = photoState(row);
  const none = <span className="text-muted">—</span>;

  return (
    <tr className="border-b border-line align-top last:border-0">
      <th scope="row" className="py-3 pr-4 text-left font-normal whitespace-nowrap">
        <Link href={`/runs/${row.id}`} className={textLink}>
          <time dateTime={row.createdAt}>{DATE_TIME.format(new Date(row.createdAt))}</time>
        </Link>
      </th>
      <td className="max-w-48 py-3 pr-4 break-words">
        {row.who.name ?? <span className="text-muted">someone with no name yet</span>}
      </td>
      <td className="py-3 pr-4">
        <Badge>{SOURCE_LABELS[row.source]}</Badge>
      </td>
      <td className="py-3 pr-4 whitespace-nowrap">{topic ? topic.label : none}</td>
      <td className="max-w-48 py-3 pr-4 break-words">
        {use === "chain" ? (
          row.chainName ?? `Chain ${row.chainId}`
        ) : use === "built-in" ? (
          "Built-in"
        ) : use === "deleted" ? (
          <span className="text-muted">Deleted chain</span>
        ) : (
          none
        )}
      </td>
      <td className="py-3 pr-4">
        <Badge tone={status.tone}>{status.label}</Badge>
      </td>
      {/* The old attempts log never recorded how many roasts a run saved */}
      <td className="py-3 pr-4 text-right tabular-nums">{row.status === "legacy" ? none : row.roastCount}</td>
      <td className="py-3 pr-4 text-right whitespace-nowrap tabular-nums">{formatDuration(row.durationMs)}</td>
      {/* Only what its priced calls cost, as a floor when some weren't priced; "—" when none were */}
      <td className="py-3 pr-4 text-right whitespace-nowrap tabular-nums">
        {row.usage.calls > row.usage.withoutCost ? (
          <>
            {row.usage.withoutCost > 0 && <span className="text-muted">≥ </span>}
            {formatUsd(row.usage.costUsd)}
          </>
        ) : (
          none
        )}
      </td>
      <td className="py-3 pr-4">
        {photo === "post" ? (
          <Thumb src={row.imageUrl} alt={topic ? `${topic.label} post` : "The run’s post"} size={40} />
        ) : photo === "deleted" ? (
          <span className="whitespace-nowrap text-muted">Photo deleted</span>
        ) : (
          none
        )}
      </td>
    </tr>
  );
}

function NoRows({ query, total }: { query: RequestQuery; total: number }) {
  // A hand-typed ?page= past the last page
  if (total > 0) {
    return (
      <EmptyState
        title={`Page ${query.page} is past the end of the list.`}
        action={{ href: hrefWith("/runs", query, { page: 1 }), label: "Go to page 1" }}
      />
    );
  }
  if (isFiltered(query)) {
    return (
      <EmptyState title="No runs match these filters." action={{ href: "/runs", label: "Clear filters" }} />
    );
  }
  return (
    <EmptyState title="No runs logged yet." action={{ href: "/generate", label: "Run a chain" }}>
      A row appears here as soon as a chain runs: from Generate here, or when someone posts a photo
      in the app.
    </EmptyState>
  );
}
