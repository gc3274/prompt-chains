// Copied from gc3274/hw1@0c21549 lib/gemini.ts; keep in sync
import "server-only";
import {
  ApiError,
  FinishReason,
  GoogleGenAI,
  ThinkingLevel as GenaiThinkingLevel,
  Type,
  type GenerateContentConfig,
  type GenerateContentResponseUsageMetadata,
  type Schema,
} from "@google/genai";
import {
  runChain,
  type CallOutcome,
  type CallRequest,
  type Chain,
  type ChainContext,
  type Price,
  type ResponseLog,
  type ThinkingLevel,
  type Usage,
} from "@/lib/chains";
import type { RoastDraft } from "@/lib/roasts";

// The Gemini side of a roast run: one call per CallRequest. Which model, prompt,
// temperature and fallback to use comes from the prompt chain (lib/chains.ts).

const SAFETY_STOPS = new Set<string>([
  FinishReason.SAFETY,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
  FinishReason.IMAGE_SAFETY,
  FinishReason.IMAGE_PROHIBITED_CONTENT,
]);

const THINKING_LEVELS: Record<ThinkingLevel, GenaiThinkingLevel> = {
  minimal: GenaiThinkingLevel.MINIMAL,
  low: GenaiThinkingLevel.LOW,
  medium: GenaiThinkingLevel.MEDIUM,
  high: GenaiThinkingLevel.HIGH,
};

// 429 is the free-tier quota, 503 an overloaded model, and an abort our own
// timeout. All of them usually pass in a minute. 404 is a model id the API
// doesn't know and 400 a request it refuses, often a setting that model
// doesn't take; the fallback model can still answer those.
export function classifyError(err: unknown): "busy" | "not_found" | "bad_request" | "failed" {
  if (err instanceof ApiError && (err.status === 429 || err.status === 503)) return "busy";
  if (err instanceof Error && err.name === "AbortError") return "busy";
  const message = err instanceof Error ? err.message : String(err);
  if (/RESOURCE_EXHAUSTED|quota|rate limit|high demand|timed out/i.test(message)) return "busy";
  if (err instanceof ApiError && err.status === 404) return "not_found";
  if (err instanceof ApiError && err.status === 400) return "bad_request";
  return "failed";
}

// Billed tokens: the prompt (the photo included) in, the answer plus thinking
// out, and how much of the prompt came from Gemini's cache. Null when the API
// sent no counts.
export function usageFrom(meta: GenerateContentResponseUsageMetadata | undefined): Usage | null {
  if (!meta) return null;
  const { promptTokenCount, candidatesTokenCount, thoughtsTokenCount, cachedContentTokenCount } = meta;
  if (promptTokenCount === undefined && candidatesTokenCount === undefined && thoughtsTokenCount === undefined) {
    return null;
  }
  return {
    input: promptTokenCount ?? 0,
    output: (candidatesTokenCount ?? 0) + (thoughtsTokenCount ?? 0),
    cached: cachedContentTokenCount ?? 0,
  };
}

function roastSchema(criticSlugs: string[]): Schema {
  return {
    type: Type.OBJECT,
    properties: {
      allowed: { type: Type.BOOLEAN },
      reviews: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            critic_slug: { type: Type.STRING, format: "enum", enum: criticSlugs },
            roast: { type: Type.STRING },
            tip: { type: Type.STRING },
            score: { type: Type.INTEGER },
          },
          required: ["critic_slug", "roast", "tip", "score"],
          propertyOrdering: ["critic_slug", "roast", "tip", "score"],
        },
      },
    },
    required: ["allowed", "reviews"],
    propertyOrdering: ["allowed", "reviews"],
  };
}

type ImageInput = { data: string; mimeType: "image/jpeg" };

function geminiCaller(genai: GoogleGenAI, image: ImageInput) {
  return async (req: CallRequest): Promise<CallOutcome> => {
    const config: GenerateContentConfig = {
      systemInstruction: req.system,
      httpOptions: { timeout: req.timeoutMs },
    };
    if (req.criticSlugs) {
      config.responseMimeType = "application/json";
      config.responseSchema = roastSchema(req.criticSlugs);
    }
    if (req.temperature !== null) config.temperature = req.temperature;
    if (req.thinkingLevel) config.thinkingConfig = { thinkingLevel: THINKING_LEVELS[req.thinkingLevel] };

    try {
      const response = await genai.models.generateContent({
        model: req.model,
        contents: req.withImage
          ? [{ inlineData: { mimeType: image.mimeType, data: image.data } }, { text: req.user }]
          : [{ text: req.user }],
        config,
      });

      // Blocked and empty answers still cost tokens
      const usage = usageFrom(response.usageMetadata);
      // The API's own safety filters can block the photo or the answer outright
      const blockReason = response.promptFeedback?.blockReason;
      const finishReason = response.candidates?.[0]?.finishReason;
      if (blockReason || (finishReason && SAFETY_STOPS.has(finishReason))) {
        console.warn("Roast generation blocked:", blockReason ?? finishReason);
        return {
          ok: false,
          kind: "rejected",
          error: `Blocked by the API's safety filters (${blockReason ?? finishReason}).`,
          usage,
        };
      }
      const text = response.text;
      if (!text) {
        console.error("Roast generation returned no text. Finish reason:", finishReason ?? "unknown");
        return {
          ok: false,
          kind: "failed",
          error: `No text in the answer (finish reason ${finishReason ?? "unknown"}).`,
          usage,
        };
      }
      // "-latest" aliases resolve to a dated model; store the one that answered
      return { ok: true, text, model: response.modelVersion || req.model, usage };
    } catch (err) {
      const kind = classifyError(err);
      const message = err instanceof Error ? err.message : String(err);
      if (kind === "busy") console.warn(`Roast generation busy (${req.model}):`, message);
      else console.error(`Roast generation failed (${req.model}):`, message);
      return { ok: false, kind, error: message };
    }
  };
}

export type GenerateRoastsInput = {
  chain: Chain;
  context: ChainContext;
  image: ImageInput;
  // Epoch ms; no model call starts past it
  deadline: number;
  onResponse: (log: ResponseLog) => Promise<void> | void;
  // Prices by model id, for each call's cost
  prices: ReadonlyMap<string, Price>;
};

export type GenerateRoastsResult =
  | { ok: true; roasts: RoastDraft[]; prompt: string; model: string }
  | { ok: false; reason: "not_configured" | "rejected" | "busy" | "failed"; error: string };

export async function generateRoasts({
  chain,
  context,
  image,
  deadline,
  onResponse,
  prices,
}: GenerateRoastsInput): Promise<GenerateRoastsResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Roast generation skipped: GEMINI_API_KEY is not set.");
    return { ok: false, reason: "not_configured", error: "GEMINI_API_KEY is not set." };
  }

  return runChain(chain, context, {
    call: geminiCaller(new GoogleGenAI({ apiKey }), image),
    now: Date.now,
    deadline,
    onResponse,
    prices,
  });
}
