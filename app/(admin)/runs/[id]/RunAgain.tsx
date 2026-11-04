"use client";

import { useActionState } from "react";
import SubmitButton from "@/components/SubmitButton";
import { runChain } from "@/app/(admin)/generate/actions";
import { RUN_INITIAL, type RunState } from "@/lib/runs";

// The same chain on the same photo, from the run's page. A refusal shows here;
// a run that starts lands on its own page.
export default function RunAgain({ chainId, imageId }: { chainId: number; imageId: string }) {
  const [state, formAction] = useActionState<RunState, FormData>(runChain, RUN_INITIAL);
  return (
    <form action={formAction}>
      <input type="hidden" name="chainId" value={chainId} />
      <input type="hidden" name="imageId" value={imageId} />
      <SubmitButton variant="secondary" pendingText="Running… up to a minute">
        Run again
      </SubmitButton>
      {state.error && (
        <div role="alert" className="mt-2 max-w-md text-sm text-danger">
          <p>{state.error}</p>
          {state.problems && state.problems.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {state.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
