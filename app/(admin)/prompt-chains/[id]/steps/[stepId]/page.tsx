import type { Metadata } from "next";
import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { errorBox, textLink } from "@/components/ui";
import { getChainDetail, listModelChoices, type ChainDetail, type ModelChoice } from "@/lib/data/prompts";
import { requireSuperadmin } from "@/lib/dal";
import { parseId } from "@/lib/forms";
import EditNote from "../EditNote";
import StepForm from "../StepForm";

export const metadata: Metadata = {
  title: "Edit step",
};

// Read on every request: this page must never be prerendered with service-role data
export const dynamic = "force-dynamic";

export default async function EditStepPage({ params }: PageProps<"/prompt-chains/[id]/steps/[stepId]">) {
  await requireSuperadmin();

  const raw = await params;
  const id = parseId(raw.id);
  const stepId = parseId(raw.stepId);
  if (id === null || stepId === null) notFound();

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
          This step couldn’t load. The database didn’t answer, or this server is missing its service
          key. Reload the page to try again.
        </p>
      </>
    );
  }
  const { chain, models } = loaded;
  // The step must belong to the chain in the URL
  const step = chain?.steps.find((s) => s.id === stepId);
  if (!chain || !step) notFound();

  return (
    <>
      <Link href={`/prompt-chains/${chain.id}`} className={`text-sm ${textLink}`}>
        Back to {chain.name}
      </Link>
      <h1 className="mt-4 font-display text-3xl font-bold tracking-tight break-words">
        Step {step.order} of {chain.name}
      </h1>
      <p className="mt-2 max-w-prose text-muted">
        {step.order === chain.steps.length
          ? "The last step: it writes the reviews."
          : `Its answer is {{previous}} in step ${step.order + 1}.`}{" "}
        To change where it runs, move it on the chain page.
      </p>
      <EditNote chain={chain} />

      <div className="mt-8">
        <StepForm
          chainId={chain.id}
          stepCount={chain.steps.length}
          models={models}
          step={{
            id: step.id,
            order: step.order,
            description: step.description,
            inputType: step.inputType ?? "image",
            outputType: step.outputType ?? "text",
            modelId: step.model?.id ?? null,
            temperature: step.temperature,
            systemPrompt: step.systemPrompt,
            userPrompt: step.userPrompt,
          }}
        />
      </div>
    </>
  );
}
