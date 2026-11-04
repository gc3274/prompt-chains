import type { Metadata } from "next";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import type { ReactNode } from "react";
import EmptyState from "@/components/EmptyState";
import { button, errorBox, focusRing, textLink } from "@/components/ui";
import { listPhotoChoices, type PhotoChoice } from "@/lib/data/photos";
import { listChainChoices } from "@/lib/data/prompts";
import { requireSuperadmin } from "@/lib/dal";
import { nouns } from "@/lib/format";
import { hrefWith, type ParamValue } from "@/lib/params";
import { TOPICS } from "@/lib/roasts";
import { initialChain, parseGenerateQuery, PHOTOS_PER_PAGE, type ChainChoice, type GenerateQuery } from "@/lib/runs";
import RunForm from "./RunForm";

export const metadata: Metadata = {
  title: "Generate",
};

// Read on every request: this page must never be prerendered with service-role data
export const dynamic = "force-dynamic";

// Also the limit for runChain posted from this page: up to RUN_BUDGET_MS of
// model calls (lib/chains.ts) plus the reads and the photo download
export const maxDuration = 60;

type Loaded = { chains: ChainChoice[]; photos: PhotoChoice[]; total: number };

export default async function GeneratePage({ searchParams }: PageProps<"/generate">) {
  await requireSuperadmin();

  const query = parseGenerateQuery(await searchParams);
  let loaded: Loaded | null = null;
  try {
    const [chains, photos] = await Promise.all([listChainChoices(), listPhotoChoices(query)]);
    loaded = { chains, photos: photos.rows, total: photos.total };
  } catch (error) {
    unstable_rethrow(error);
    console.error("Loading the chains or photos failed", error);
  }

  return (
    <>
      <h1 className="font-display text-3xl font-bold tracking-tight">Generate</h1>
      <p className="mt-2 max-w-prose text-muted">
        Run one chain on one photo and see what it makes: the photo topic’s critics each write a
        review, and the run’s page shows every step’s prompt and answer. Nothing is posted, so the
        photo’s owner never sees these reviews. The calls count toward the main app’s daily budget.
      </p>

      {loaded ? (
        <Picker query={query} {...loaded} />
      ) : (
        <p className={`${errorBox} mt-6`}>
          The chains or photos couldn’t load. The database didn’t answer, or this server is missing
          its service key. Reload the page to try again.
        </p>
      )}
    </>
  );
}

function Picker({ query, chains, photos, total }: { query: GenerateQuery } & Loaded) {
  if (chains.length === 0) {
    return (
      <div className="mt-6">
        <EmptyState title="No prompt chains yet." action={{ href: "/prompt-chains/new", label: "New chain" }}>
          Make a chain first, then run it here.
        </EmptyState>
      </div>
    );
  }

  const chainId = initialChain(chains, query.chain);
  const pages = Math.max(1, Math.ceil(total / PHOTOS_PER_PAGE));
  // The topic and page links keep the chain the page was opened for
  const keep: Record<string, ParamValue> = { chain: chainId, topic: query.topic, page: query.page };

  return (
    <>
      <nav aria-label="Photo topic" className="mt-6 flex flex-wrap gap-2">
        <TopicLink href={hrefWith("/generate", keep, { topic: null, page: null })} current={query.topic === null}>
          All topics
        </TopicLink>
        {TOPICS.map((t) => (
          <TopicLink
            key={t.slug}
            href={hrefWith("/generate", keep, { topic: t.slug, page: null })}
            current={query.topic === t.slug}
          >
            {t.emoji} {t.label}
          </TopicLink>
        ))}
      </nav>

      {chainId === null && (
        <p role="note" className={`${errorBox} mt-6`}>
          No chain can run right now. Open one from{" "}
          <Link href="/prompt-chains" className="font-medium underline">
            Prompt chains
          </Link>{" "}
          to see what stops it.
        </p>
      )}

      {photos.length === 0 ? (
        <div className="mt-6">
          {total > 0 ? (
            <EmptyState
              title={`Page ${query.page} is past the end of the photos.`}
              action={{ href: hrefWith("/generate", keep, { page: null }), label: "Go to page 1" }}
            />
          ) : (
            <EmptyState title={query.topic ? "No photos with this topic yet." : "No photos yet."}>
              Photos posted in the main app show up here. Legacy caption photos have no topic, so they
              can’t be roasted.
            </EmptyState>
          )}
        </div>
      ) : (
        <>
          <p className="mt-6 text-sm text-muted">
            {nouns(total, "photo")}, newest first{pages > 1 ? `, page ${query.page} of ${pages}` : ""}
          </p>
          {/* Keyed by the URL, so a new topic or page starts the choices fresh */}
          <RunForm
            key={hrefWith("/generate", keep)}
            chains={chains}
            chainId={chainId}
            photos={photos}
          />
          {pages > 1 && (
            <nav aria-label="Photo pages" className="mt-6 flex items-center gap-3">
              <PageLink to={query.page - 1} pages={pages} keep={keep}>
                Previous
              </PageLink>
              <PageLink to={query.page + 1} pages={pages} keep={keep}>
                Next
              </PageLink>
            </nav>
          )}
        </>
      )}

      <p className="mt-8 max-w-prose text-sm text-muted">
        Every run is kept under{" "}
        <Link href="/runs" className={textLink}>
          Runs
        </Link>
        , with the exact prompts it sent.
      </p>
    </>
  );
}

function TopicLink({ href, current, children }: { href: string; current: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={`rounded-full border px-3 py-1.5 text-sm font-medium ${focusRing} ${
        current ? "border-accent bg-accent/10 text-accent" : "border-line bg-surface text-ink hover:bg-canvas"
      }`}
    >
      {children}
    </Link>
  );
}

function PageLink({
  to,
  pages,
  keep,
  children,
}: {
  to: number;
  pages: number;
  keep: Record<string, ParamValue>;
  children: ReactNode;
}) {
  if (to < 1 || to > pages) {
    return (
      <span aria-disabled="true" className={`${button("secondary", "sm")} pointer-events-none opacity-50`}>
        {children}
      </span>
    );
  }
  return (
    <Link href={hrefWith("/generate", keep, { page: to })} className={button("secondary", "sm")}>
      {children}
    </Link>
  );
}
