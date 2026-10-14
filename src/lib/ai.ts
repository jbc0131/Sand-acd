import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

// Every Claude call in CDA goes through this module. The API key is read on the server only.

export const MODEL_MAIN = process.env.CDA_MODEL_MAIN || "claude-sonnet-5-5";
export const MODEL_FAST = process.env.CDA_MODEL_FAST || "claude-haiku-5-5";

export const NO_KEY_MESSAGE =
  "ANTHROPIC_API_KEY is not set on the server, so live model features are disabled. Add it to .env.local and restart.";

export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim());
}

let client: Anthropic | null = null;
export function getClient(): Anthropic {
  if (!hasApiKey()) throw new UserFacingError(NO_KEY_MESSAGE);
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

type StreamParams = Anthropic.Beta.Messages.MessageCreateParamsStreaming;
type StreamInput = Omit<StreamParams, "stream" | "betas" | "fallbacks">;

// Server-side refusal fallback ("default" routing) is supported on these model lines on the Claude API.
const FALLBACK_MODELS = /^claude-(sonnet-5-5|opus-5|fable-5)/;

/** Opens a streaming request, adding the server-side refusal fallback where the model supports it. */
export function openStream(params: StreamInput) {
  const c = getClient();
  const withFallback = FALLBACK_MODELS.test(params.model);
  return c.beta.messages.stream({
    ...params,
    ...(withFallback
      ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
      : {}),
  });
}

/** Converts SDK / network errors into short messages that are safe to show to users. */
export function toUserMessage(err: unknown): string {
  if (err instanceof UserFacingError) return err.message;
  if (err instanceof Anthropic.AuthenticationError) return "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.";
  if (err instanceof Anthropic.PermissionDeniedError) return "The API key does not have access to this model.";
  if (err instanceof Anthropic.NotFoundError) return "The configured model was not found. Check CDA_MODEL_MAIN / CDA_MODEL_FAST.";
  if (err instanceof Anthropic.RateLimitError) return "The model is rate limited right now. Try again in a minute.";
  if (err instanceof Anthropic.BadRequestError) {
    const m = err.message || "";
    if (/too large|too long|exceed/i.test(m)) return "The file is too large for the model. Try a smaller file or a single page.";
    return "The model rejected the request. The file may be unreadable or in an unsupported format.";
  }
  if (err instanceof Anthropic.APIConnectionError) return "Could not reach the Anthropic API. Check the network connection.";
  if (err instanceof Anthropic.APIError) return `The model service returned an error (${err.status ?? "unknown"}). Try again.`;
  return "Something went wrong while processing. Try again.";
}

function extractJsonText(text: string): string {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.search(/[[{]/);
  if (start > 0) t = t.slice(start);
  const lastObj = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (lastObj >= 0) t = t.slice(0, lastObj + 1);
  return t;
}

function textOf(msg: Anthropic.Beta.Messages.BetaMessage): string {
  return msg.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

export interface JsonCallOptions<T> {
  model?: string;
  system?: string;
  content: Anthropic.Beta.Messages.BetaContentBlockParam[];
  schema: z.ZodType<T>;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
}

/**
 * Calls Claude and parses a JSON object out of the reply, validated with zod.
 * On invalid JSON or a schema mismatch it retries once, telling the model what was wrong.
 */
export async function callJson<T>(opts: JsonCallOptions<T>): Promise<T> {
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: "user", content: opts.content }];
  let lastProblem = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const stream = openStream({
      model: opts.model ?? MODEL_MAIN,
      max_tokens: opts.maxTokens ?? 32000,
      ...(opts.system ? { system: opts.system } : {}),
      ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
      messages,
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") {
      throw new UserFacingError("The model declined to process this file.");
    }
    const text = textOf(msg);
    try {
      const parsed = JSON.parse(extractJsonText(text));
      const result = opts.schema.safeParse(parsed);
      if (result.success) return result.data;
      lastProblem = result.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
    } catch {
      lastProblem = msg.stop_reason === "max_tokens" ? "the reply was cut off before the JSON ended" : "the reply was not valid JSON";
    }
    messages.push({ role: "assistant", content: msg.content as Anthropic.Beta.Messages.BetaContentBlockParam[] });
    messages.push({
      role: "user",
      content: `Your reply could not be used: ${lastProblem}. Reply again with ONLY the JSON object, no prose and no code fences.`,
    });
  }
  throw new UserFacingError(`The model returned data in an unexpected format (${lastProblem}).`);
}

/** Short plain-text call on the fast model (summaries, cleanup). */
export async function callText(prompt: string, maxTokens = 2000): Promise<string> {
  const stream = openStream({
    model: MODEL_FAST,
    max_tokens: maxTokens,
    output_config: { effort: "low" },
    messages: [{ role: "user", content: prompt }],
  });
  const msg = await stream.finalMessage();
  return textOf(msg).trim();
}
