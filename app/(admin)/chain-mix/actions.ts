"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { listMix, type MixChain } from "@/lib/data/prompts";
import { requireSuperadmin } from "@/lib/dal";
import { constraintField, DB_DOWN, type FormState } from "@/lib/forms";
import { MIX_STALE, validateMix, WEIGHT_RULE } from "@/lib/mix";
import { adminDb } from "@/lib/supabase/admin";

// Every chain's weight in one go. The form sends a weight for each chain, the
// weights must add up to 100, a chain that can't run stays at 0, and they're
// saved by a single upsert, so no run ever picks from a half-saved mix.
export async function updateMix(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireSuperadmin();

  // Every chain with the runner's checks, so no share goes to one that would only fall back
  let chains: MixChain[];
  try {
    chains = (await listMix()).chains;
  } catch (error) {
    unstable_rethrow(error);
    console.error("Reading the prompt chains before saving the mix failed", error);
    return { ok: false, message: DB_DOWN };
  }

  const result = validateMix(
    fd,
    chains.map((c) => c.id),
    chains.filter((c) => c.problems.length > 0).map((c) => c.id),
  );
  if (!result.ok) return { ok: false, message: result.message, errors: result.errors };

  const db = await adminDb();
  const { error } = await db.from("prompt_chain_mix").upsert(result.rows, { onConflict: "prompt_chain_id" });
  if (error) {
    // The form checks mirror prompt_chain_mix_weight_range, so this is a backstop if they drift
    if (constraintField(error, { prompt_chain_mix_weight_range: "weight" })) {
      return { ok: false, message: WEIGHT_RULE };
    }
    // 23503: a chain was deleted between the read above and the save
    if (error.code === "23503") return { ok: false, message: MIX_STALE };
    console.error("Saving the chain mix failed", error);
    return { ok: false, message: DB_DOWN };
  }

  revalidatePath("/", "layout");
  return { ok: true, message: "Saved. The next roast run uses these weights." };
}
