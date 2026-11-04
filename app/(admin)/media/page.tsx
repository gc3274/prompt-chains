import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import Badge from "@/components/Badge";
import EmptyState from "@/components/EmptyState";
import FilterBar from "@/components/FilterBar";
import Pagination from "@/components/Pagination";
import { button, card, errorBox, input, label, textLink } from "@/components/ui";
import { loadPanel } from "@/lib/data/generation";
import { listChainOptions, type ChainOption } from "@/lib/data/prompts";
import { listMedia, type MediaRow } from "@/lib/data/requests";
import { requireSuperadmin } from "@/lib/dal";
import { nouns } from "@/lib/format";
import { hrefWith, MEDIA_PER_PAGE, parseMediaQuery, type MediaQuery } from "@/lib/params";
import { chainUse, photoState, SOURCE_LABELS } from "@/lib/requests";
import { parseTopic, RATING_MAX, topicInfo, type Critic, type Topic } from "@/lib/roasts";
import { panelTopics, readResult, type RunResult } from "@/lib/runs";

export const metadata: Metadata = {
  title: "Media",
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

// Each topic's critics, or null when they couldn't load
type Panels = Map<Topic, Critic[] | null>;

type Loaded = { rows: MediaRow[]; total: number; panels: Panels };

// Each topic's panel once for the whole page. One that fails leaves only its
// own cards without reviews; the photos still show.
async function loadPanels(topics: Topic[]): Promise<Panels> {
  const panels = await Promise.all(
    topics.map((topic) =>
      loadPanel(topic).catch((error: unknown) => {
        unstable_rethrow(error);
        console.error("Loading the panel failed", error);
        return null;
      }),
    ),
  );
  return new Map(topics.map((topic, i) => [topic, panels[i]]));
}

export default async function MediaPage({ searchParams }: PageProps<"/media">) {
  await requireSuperadmin();

  const query = parseMediaQuery(await searchParams);
  let loaded: Loaded | null = null;
  let chains: ChainOption[] = [];
  try {
    const [media, options] = await Promise.all([listMedia(query), listChainOptions()]);
    loaded = { ...media, panels: await loadPanels(panelTopics(media.rows)) };
    chains = options;
  } catch (error) {
    unstable_rethrow(error);
    console.error("Loading the media failed", error);
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h1 className="font-display text-3xl font-bold tracking-tight">Media</h1>
        <Link href="/generate" className={button()}>
          Run a chain
        </Link>
      </div>
      <p className="mt-2 max-w-prose text-muted">
        What each chain made, newest first: the photo it judged and the reviews its critics wrote.
        App runs are posts from the main app; Admin runs came from Generate here or from the admin.
        Only runs that succeeded show here. Failed runs are under{" "}
        <Link href="/runs" className={textLink}>
          Runs
        </Link>
        .
      </p>

      {/* Keyed by the URL, so "Clear filters" also resets the field */}
      <div key={hrefWith("/media", query)} className="mt-6">
        <Filters query={query} chains={chains} />
      </div>

      {loaded ? (
        <Gallery query={query} {...loaded} />
      ) : (
        <p className={`${errorBox} mt-6`}>
          What the chains made couldn’t load. The database didn’t answer, or this server is missing
          its service key. Reload the page to try again.
        </p>
      )}
    </>
  );
}

function Filters({ query, chains }: { query: MediaQuery; chains: ChainOption[] }) {
  return (
    <FilterBar action="/media" showClear={query.chain !== null}>
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

function Gallery({ query, rows, total, panels }: { query: MediaQuery } & Loaded) {
  if (rows.length === 0) {
    return (
      <div className="mt-6">
        <Nothing query={query} total={total} />
      </div>
    );
  }

  return (
    <section aria-labelledby="media-count" className="mt-6">
      <p id="media-count" className="text-sm text-muted">
        {`${nouns(total, "successful run")}, newest first`}
      </p>
      <ul className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => {
          const topic = parseTopic(row.topic);
          // With no topic there's no panel, so the answer reads as unreadable, as on the run's page
          const critics = topic ? (panels.get(topic) ?? null) : [];
          return <MediaCard key={row.id} row={row} result={critics ? readResult(row, critics) : null} />;
        })}
      </ul>
      <div className="mt-6">
        <Pagination pathname="/media" query={query} page={query.page} total={total} pageSize={MEDIA_PER_PAGE} />
      </div>
    </section>
  );
}

function MediaCard({ row, result }: { row: MediaRow; result: RunResult | null }) {
  const topic = topicInfo(row.topic);
  const use = chainUse(row);

  return (
    <li className={`${card} flex flex-col overflow-hidden`}>
      <Photo row={row} alt={topic ? `${topic.label} post` : "The run’s post"} />
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 font-semibold break-words">
            {use === "chain" ? (
              <Link href={`/prompt-chains/${row.chainId}`} className={textLink}>
                {row.chainName ?? `Chain ${row.chainId}`}
              </Link>
            ) : use === "built-in" ? (
              "Built-in chain"
            ) : (
              <span className="text-muted">Deleted chain</span>
            )}
          </h2>
          <Badge>{SOURCE_LABELS[row.source]}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted">
          {topic ? (
            <>
              <span aria-hidden="true">{topic.emoji}</span> {topic.label}
            </>
          ) : (
            "No topic"
          )}{" "}
          · <time dateTime={row.createdAt}>{DATE_TIME.format(new Date(row.createdAt))}</time>
        </p>
        <Reviews result={result} />
        <p className="mt-auto pt-4">
          <Link href={`/runs/${row.id}`} className={`text-sm ${textLink}`}>
            Open run
          </Link>
        </p>
      </div>
    </li>
  );
}

function Photo({ row, alt }: { row: MediaRow; alt: string }) {
  // A run that succeeded saved its post, so a missing one was deleted since
  if (photoState(row) === "post" && row.imageUrl) {
    return (
      <div className="relative aspect-square border-b border-line bg-canvas">
        <Image
          src={row.imageUrl}
          alt={alt}
          fill
          sizes="(min-width: 1024px) 360px, (min-width: 640px) 50vw, 100vw"
          className="object-cover"
        />
      </div>
    );
  }
  return (
    <div className="flex aspect-square items-center justify-center border-b border-line bg-canvas text-sm text-muted">
      Photo deleted
    </div>
  );
}

function Reviews({ result }: { result: RunResult | null }) {
  if (result === null) {
    return (
      <p className={`${errorBox} mt-4`}>
        The critics couldn’t load, so the reviews can’t be read back here. The run’s page has the
        raw answer.
      </p>
    );
  }
  if (result.kind !== "reviews") {
    return (
      <p className={`${errorBox} mt-4`}>
        The answer no longer reads as reviews for this topic’s panel (a critic may have changed
        since). The run’s page has the raw answer.
      </p>
    );
  }

  return (
    <ul className="mt-4 divide-y divide-line border-t border-line">
      {result.reviews.map((r) => (
        <li key={r.criticId} className="py-3 last:pb-0">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium">
              <span aria-hidden="true">{r.critic.emoji}</span> {r.critic.name}
            </p>
            {r.rating !== null && (
              <span className="shrink-0 rounded-full bg-canvas px-2.5 py-0.5 text-sm font-semibold tabular-nums">
                {r.rating}/{RATING_MAX}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm break-words">{r.content}</p>
          {r.tip && (
            <p className="mt-2 text-sm break-words text-muted">
              <span className="font-medium text-ink">Tip:</span> {r.tip}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function Nothing({ query, total }: { query: MediaQuery; total: number }) {
  // A hand-typed ?page= past the last page
  if (total > 0) {
    return (
      <EmptyState
        title={`Page ${query.page} is past the end of the list.`}
        action={{ href: hrefWith("/media", query, { page: 1 }), label: "Go to page 1" }}
      />
    );
  }

  const runs = (
    <Link href={hrefWith("/runs", {}, { chain: query.chain })} className={textLink}>
      Runs
    </Link>
  );
  if (query.chain !== null) {
    return (
      <EmptyState title="This chain hasn’t made anything yet." action={{ href: "/media", label: "Clear filters" }}>
        A run shows here once it succeeds. This chain’s failed runs are under {runs}.
      </EmptyState>
    );
  }
  return (
    <EmptyState title="Nothing made yet." action={{ href: "/generate", label: "Run a chain" }}>
      A run shows here with its photo and reviews once it succeeds: from Generate here, or when
      someone posts a photo in the app. Failed runs are under {runs}.
    </EmptyState>
  );
}
