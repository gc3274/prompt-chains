// What the step form says about providers. Pure, so it runs in tests. Models
// and providers are added and priced in the admin (LLM → Models and Providers);
// here a step only picks one.
import { CALLABLE_PROVIDER, FALLBACK_MODEL } from "@/lib/chains";

// The app has a client for one provider only; steps under any other go straight to the fallback
export const isCallable = (slug: string) => slug === CALLABLE_PROVIDER;

export const UNCALLABLE_NOTE = `The app only calls “${CALLABLE_PROVIDER}” models. Steps that use a model under another provider go straight to ${FALLBACK_MODEL}.`;
