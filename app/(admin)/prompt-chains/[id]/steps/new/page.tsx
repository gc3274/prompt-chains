import type { Metadata } from "next";
import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import EmptyState from "@/components/EmptyState";
import { errorBox, textLink } from "@/components/ui";
import { getChainDetail, listModelChoices, type ChainDetail, type ModelChoice } from "@/lib/data/prompts";
import { requireSuperadmin } from "@/lib/dal";
import { parseId } from "@/lib/forms";
import { CHAIN_ERRORS, STEPS_MAX } from "@/lib/prompt-chains";
import EditNote from "../EditNote";
import StepForm from "../StepForm";

export const metadata: Metadata = {
  title: "Add a step",
};

// Read on every request: this page must never be prerendered with service-role data
export const dynamic = "force-dynamic";

export default async function NewStepPage({ params }: PageProps<"/prompt-chains/[id]/steps/new">) {
  await requireSuperadmin();

  const id = parseId((await params).id);
  if (id === null) notFound();

  let loaded: { chain: ChainDetail | null; models: ModelChoice[] } | null = null;
  try {
    const [chain, models] = await Promise.all([getChainDetail(id), listModelChoices()]);
    loaded = { chain, models };
  } catch (error) {
    unstable_rethrow(error);
    console.error("Loading the prompt chain failed", error);
  }

  if (!loaded) {
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
  const { chain, models } = loaded;
  if (!chain) notFound();

  return (
    <>
      <Link href={`/prompt-chains/${chain.id}`} className={`text-sm ${textLink}`}>
        Back to {chain.name}
      </Link>
      <h1 className="mt-4 font-display text-3xl font-bold tracking-tight break-words">Add a step to {chain.name}</h1>
      <p className="mt-2 max-w-prose text-muted">
        Each step is one call to the model. Its answer is {"{{previous}}"} in the step after it, and
        the last step writes the reviews.
      </p>
      <EditNote chain={chain} />

      <div className="mt-8">
        {chain.steps.length >= STEPS_MAX ? (
          <p className={errorBox}>{CHAIN_ERRORS.chain_full}</p>
        ) : models.length === 0 ? (
          <EmptyState title="Add a model first.">
            Every step calls a model. Models are added in the admin, under LLM → Models.
          </EmptyState>
        ) : (
          <StepForm chainId={chain.id} stepCount={chain.steps.length} models={models} />
        )}
      </div>
    </>
  );
}
