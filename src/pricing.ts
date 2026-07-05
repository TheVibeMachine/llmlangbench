interface ModelPricing {
  inputPerMTok: number;
  cachedInputPerMTok?: number;
  outputPerMTok: number;
}

// Codex usage events report token counts but no USD cost, so we price them
// ourselves. input_tokens includes cached_input_tokens, so cached input is
// subtracted from the full-price input bucket before applying cached pricing
// when that rate is known for the model.
const PRICING: Record<string, ModelPricing> = {
  "gpt-5.4": { inputPerMTok: 1.25, outputPerMTok: 10 },
  "gpt-5.4-mini": { inputPerMTok: 0.75, cachedInputPerMTok: 0.075, outputPerMTok: 4.5 },
  "gpt-5.5": { inputPerMTok: 1.25, outputPerMTok: 10 },
  "gpt-5.3-codex": { inputPerMTok: 1.25, outputPerMTok: 10 },
};

const warned = new Set<string>();

export interface PriceEstimate {
  costUsd: number;
  estimated: boolean;
}

export function priceTokens(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens = 0,
): PriceEstimate {
  const pricing = PRICING[model];
  if (!pricing) {
    if (!warned.has(model)) {
      console.warn(`pricing: no pricing entry for model "${model}", costUsd is not estimated`);
      warned.add(model);
    }
    return { costUsd: 0, estimated: false };
  }
  const billableCachedInputTokens = pricing.cachedInputPerMTok == null
    ? 0
    : Math.min(cachedInputTokens, inputTokens);
  const uncachedInputTokens = inputTokens - billableCachedInputTokens;
  const costUsd = (uncachedInputTokens / 1_000_000) * pricing.inputPerMTok
    + (billableCachedInputTokens / 1_000_000) * (pricing.cachedInputPerMTok ?? pricing.inputPerMTok)
    + (outputTokens / 1_000_000) * pricing.outputPerMTok;
  return { costUsd, estimated: true };
}
