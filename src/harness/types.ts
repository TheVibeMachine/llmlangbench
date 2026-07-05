import type { TrialResult } from "../types.js";

export interface HarnessRunOptions {
  prompt: string;
  trialDir: string;
  model: string;
  codexModelProvider?: string; // used by codex only (-c model_provider=...)
  maxTurns: number; // used by claude only
  maxActions: number; // used by codex only
  maxBudgetUsd: number; // used by claude only
  timeoutMs: number; // used by codex only (wall-clock)
  allowedTools: string[]; // used by claude only
  transcriptStream: NodeJS.WritableStream;
}

export interface HarnessRunResult {
  status: TrialResult["status"];
  costUsd: number;
  costEstimated: boolean;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  turns: number;
  actions: number;
  durationMs: number;
}

export interface Harness {
  id: "claude-code" | "codex";
  run(opts: HarnessRunOptions): Promise<HarnessRunResult>;
}
