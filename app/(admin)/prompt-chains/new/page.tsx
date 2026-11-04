import type { Metadata } from "next";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { card, errorBox, textLink } from "@/components/ui";
import { listChainSources, type ChainSource } from "@/lib/data/prompts";
import { requireSuperadmin } from "@/lib/dal";
import { parseId } from "@/lib/forms";
import { BLANK_SOURCE } from "@/lib/prompt-chains";
import ChainCreateForm from "./ChainCreateForm";

export const metadata: Metadata = {
  title: "New prompt chain",
};

// Read on every request: this page must never be prerendered with service-role data
export const dynamic = "force-dynamic";

export default async function NewChainPage({ searchParams }: PageProps<"/prompt-chains/new">) {
  await requireSuperadmin();

  // ?from= comes from a chain page's "Duplicate" link
  const from = parseId((await searchParams).from);
  let sources: ChainSource[] | null = null;
  try {
    sources = await listChainSources();
  } catch (error) {
    unstable_rethrow(error);
    console.error("Loading the prompt chains to copy failed", error);
  }
  const start = sources?.find((s) => s.id === from) ?? sources?.find((s) => s.isDefault) ?? sources?.[0];

  return (
    <>
      <Link href="/prompt-chains" className={`text-sm ${textLink}`}>
        All prompt chains
      </Link>
      <h1 className="mt-4 font-display text-3xl font-bold tracking-tight">New prompt chain</h1>
      <p className="mt-2 max-w-prose text-muted">
        A new chain starts blank or as a copy of another one. It’s a draft: no roasts use it until
        you make it the default or give it a share on{" "}
        <Link href="/chain-mix" className={textLink}>
          Chain mix
        </Link>
        , so you can change its steps freely first.
      </p>

      {!sources ? (
        <p className={`${errorBox} mt-6`}>
          The prompt chains couldn’t load. The database didn’t answer, or this server is missing its
          service key. Reload the page to try again.
        </p>
      ) : (
        <section aria-label="New chain" className={`${card} mt-8 max-w-2xl p-5 sm:p-6`}>
          <ChainCreateForm sources={sources} initialSource={start ? String(start.id) : BLANK_SOURCE} />
        </section>
      )}
    </>
  );
}
