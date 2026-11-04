import Link from "next/link";
import Badge from "@/components/Badge";
import { errorBox, noticeBox, textLink } from "@/components/ui";
import type { ChainDetail } from "@/lib/data/prompts";
import { chainStatus, isLive, statusLine } from "@/lib/prompt-chains";

// Above the step form: whether a save reaches roasts, and what's refused
export default function EditNote({ chain }: { chain: ChainDetail }) {
  const standing = { isDefault: chain.isDefault, weight: chain.weight, problems: chain.problems.length };
  const status = chainStatus(standing);
  const live = isLive(chain);
  const runs = chain.problems.length === 0;

  return (
    <div role="note" className={`${live && !runs ? errorBox : noticeBox} mt-6 max-w-3xl`}>
      <p className="flex flex-wrap items-center gap-2">
        {chain.isDefault && <Badge tone="accent">Default</Badge>}
        <Badge tone={status.tone}>{status.label}</Badge>
        <span>{statusLine(standing)}</span>
      </p>
      <p className="mt-2">
        {live && runs && (
          <>
            Saving applies to the very next roast. A change that would stop this chain from running
            isn’t saved; to try one,{" "}
            <Link href={`/prompt-chains/new?from=${chain.id}`} className={textLink}>
              duplicate the chain
            </Link>{" "}
            and change the copy.
          </>
        )}
        {live && !runs && "Saving applies to the next roast. The chain page lists what still stops it from running."}
        {!live && "No roasts use this chain, so it saves in any state. Its page lists anything that would stop it from running."}
      </p>
    </div>
  );
}
