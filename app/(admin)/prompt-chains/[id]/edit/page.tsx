import type { Metadata } from "next";
import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { card, errorBox, textLink } from "@/components/ui";
import { getChainDetail, type ChainDetail } from "@/lib/data/prompts";
import { requireSuperadmin } from "@/lib/dal";
import { parseId } from "@/lib/forms";
import ChainDetailsForm from "./ChainDetailsForm";

export const metadata: Metadata = {
  title: "Edit prompt chain",
};

// Read on every request: this page must never be prerendered with service-role data
export const dynamic = "force-dynamic";

export default async function EditChainPage({ params }: PageProps<"/prompt-chains/[id]/edit">) {
  await requireSuperadmin();

  const id = parseId((await params).id);
  if (id === null) notFound();

  let chain: ChainDetail | null = null;
  let failed = false;
  try {
    chain = await getChainDetail(id);
  } catch (error) {
    unstable_rethrow(error);
    console.error("Loading the prompt chain failed", error);
    failed = true;
  }

  if (failed) {
    return (
      <>
        <Link href={`/prompt-chains/${id}`} className={`text-sm ${textLink}`}>
          Back to the chain
        </Link>
        <p className={`${errorBox} mt-6`}>
          This prompt chain couldn’t load. The database didn’t answer, or this server is missing its
          service key. Reload the page to try again.
        </p>
      </>
    );
  }
  if (!chain) notFound();

  return (
    <>
      <Link href={`/prompt-chains/${chain.id}`} className={`text-sm ${textLink}`}>
        Back to {chain.name}
      </Link>
      <h1 className="mt-4 font-display text-3xl font-bold tracking-tight">Edit details</h1>
      <p className="mt-2 max-w-prose text-muted">
        The name and description only show in this admin area, so changing them never changes a
        roast. To change what the model is sent, edit the chain’s steps.
      </p>
      <section aria-label="Chain details" className={`${card} mt-8 max-w-2xl p-5 sm:p-6`}>
        <ChainDetailsForm id={chain.id} name={chain.name} slug={chain.slug} description={chain.description} />
      </section>
    </>
  );
}
