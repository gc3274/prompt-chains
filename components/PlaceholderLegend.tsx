import { card } from "@/components/ui";
import { EXAMPLES_MAX, PLACEHOLDERS, TERMS_MAX, type Placeholder } from "@/lib/chains";
import { RATING_MAX, ROAST_TARGET, TIP_TARGET, TOPICS } from "@/lib/roasts";

const example = TOPICS[0];

// What each placeholder becomes when a step runs (lib/chains.ts buildVars)
export const PLACEHOLDER_MEANINGS: Record<Placeholder, string> = {
  topic: `The photo’s topic label and hint, like “${example.label} (${example.hint})”.`,
  critics: "One line per critic on the panel: slug, name and voice.",
  terms: `Up to ${TERMS_MAX} terms for the topic, or nothing when there are none.`,
  examples: `Up to ${EXAMPLES_MAX} example reviews for the topic, or nothing when there are none.`,
  note: "The uploader’s note on a line of its own, or nothing when they left none.",
  previous: "The previous step’s answer. Empty on step 1.",
  roast_max: `${ROAST_TARGET}, the longest roast the prompt asks for.`,
  tip_max: `${TIP_TARGET}, the longest tip.`,
  rating_max: `${RATING_MAX}, the top score.`,
};

// The placeholders a step's prompts can use, on the chain page and the step form
export default function PlaceholderLegend() {
  return (
    <section aria-labelledby="legend-heading" className={`${card} p-5`}>
      <h2 id="legend-heading" className="font-semibold">
        Placeholders
      </h2>
      <p className="mt-1 text-sm text-muted">
        Filled in for each run before the prompt is sent. Write them exactly as shown: lowercase,
        no spaces inside the braces.
      </p>
      <dl className="mt-4 space-y-3 text-sm">
        {PLACEHOLDERS.map((key) => (
          <div key={key}>
            <dt className="font-mono text-xs font-medium">{`{{${key}}}`}</dt>
            <dd className="mt-0.5 text-muted">{PLACEHOLDER_MEANINGS[key]}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
