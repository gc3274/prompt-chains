import type { Metadata } from "next";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import EmptyState from "@/components/EmptyState";
import { card, errorBox, textLink } from "@/components/ui";
import { listMix, type MixChain } from "@/lib/data/prompts";
import { requireSuperadmin } from "@/lib/dal";
import MixForm from "./MixForm";

export const metadata: Metadata = {
  title: "Chain mix",
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

export default async function ChainMixPage() {
  await requireSuperadmin();

  let mix: { chains: MixChain[]; updatedAt: string | null } | null = null;
  try {
    mix = await listMix();
  } catch (error) {
    unstable_rethrow(error);
    console.error("Loading the chain mix failed", error);
  }

  return (
    <>
      <h1 className="font-display text-3xl font-bold tracking-tight">Chain mix</h1>
      <p className="mt-2 max-w-prose text-muted">
        Each roast run picks one{" "}
        <Link href="/prompt-chains" className={textLink}>
          prompt chain
        </Link>{" "}
        at random by these weights. They must add up to 100, so they read as percentages. Changes
        apply to the next run. To send every roast to one chain, use Make default on its page.
      </p>

      {!mix ? (
        <p className={`${errorBox} mt-6`}>
          The chain mix couldn’t load. The database didn’t answer, or this server is missing its
          service key. Reload the page to try again.
        </p>
      ) : mix.chains.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No prompt chains yet.">
            The prompt chains migration seeds them. Until it runs, every roast uses the one-pass
            prompt built into the app.
          </EmptyState>
        </div>
      ) : (
        <Weights mix={mix} />
      )}
    </>
  );
}

function Weights({ mix }: { mix: { chains: MixChain[]; updatedAt: string | null } }) {
  // Runs fall back to it, whatever its weight
  const defaultChain = mix.chains.find((c) => c.isDefault) ?? null;
  return (
    <section aria-labelledby="mix-heading" className={`${card} mt-6 max-w-2xl p-5 sm:p-6`}>
      <h2 id="mix-heading" className="text-xl font-semibold tracking-tight">
        Weights
      </h2>
      <p className="mt-1 text-sm text-muted">
        {mix.updatedAt ? (
          <>
            Last changed{" "}
            <time dateTime={mix.updatedAt}>{DATE_TIME.format(new Date(mix.updatedAt))}</time>.
          </>
        ) : (
          "Never saved yet."
        )}{" "}
        A chain at 0% is never picked, though the default chain
        {defaultChain ? (
          <>
            ,{" "}
            <Link href={`/prompt-chains/${defaultChain.id}`} className={textLink}>
              {defaultChain.name}
            </Link>
            ,
          </>
        ) : null}{" "}
        still runs as the backup when the picked chain can’t run. A chain that can’t run must
        stay at 0%.
      </p>
      <div className="mt-5">
        <MixForm chains={mix.chains} />
      </div>
    </section>
  );
}
