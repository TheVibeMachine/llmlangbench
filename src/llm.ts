import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export type ReviewProvider = "anthropic" | "openai";

export interface LlmOptions {
  provider: ReviewProvider;
  model: string;
  maxTokens: number;
}

export const DEFAULT_ANTHROPIC_REVIEW_MODEL = "claude-sonnet-4-5-20250929";
export const DEFAULT_OPENAI_REVIEW_MODEL = "gpt-5.4";

export function defaultReviewModel(provider: ReviewProvider): string {
  return provider === "openai"
    ? DEFAULT_OPENAI_REVIEW_MODEL
    : DEFAULT_ANTHROPIC_REVIEW_MODEL;
}

export function parseReviewProvider(value: string | undefined): ReviewProvider | undefined {
  if (value == null) return undefined;
  if (value === "anthropic" || value === "openai") return value;
  throw new Error(`unsupported review provider "${value}" (expected "anthropic" or "openai")`);
}

export async function generateText(prompt: string, opts: LlmOptions): Promise<string> {
  if (opts.provider === "openai") {
    const client = new OpenAI();
    const response = await client.responses.create({
      model: opts.model,
      input: prompt,
      max_output_tokens: opts.maxTokens,
    });
    return response.output_text ?? "";
  }

  const client = new Anthropic();
  const response = await client.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens,
    temperature: 0,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock?.text ?? "";
}
