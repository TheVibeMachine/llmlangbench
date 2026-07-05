import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Harness, HarnessRunOptions, HarnessRunResult } from "./types.js";

// Stall (inactivity) detection: opts.timeoutMs is the max gap allowed between SDK messages,
// not a hard ceiling on the whole trial. Reset on every message, so a trial that's slow but
// still producing output (a local model can take minutes per turn) is never killed early —
// only a session with zero new messages for the full window is treated as wedged. This
// targets the observed failure mode directly: harness wedges silent for hours with no error,
// not trials that are merely slow. A fixed from-start ceiling (as codex uses) would have
// killed several legitimately-slow trials in this benchmark's own history (one took 36+ min).
const STALL_CHECK_INTERVAL_MS = 10_000;

async function run(opts: HarnessRunOptions): Promise<HarnessRunResult> {
  const startedAt = Date.now();
  let resultMessage: SDKResultMessage | undefined;
  let stalled = false;
  let lastActivityAt = Date.now();
  const abortController = new AbortController();

  const stallTimer = setInterval(() => {
    if (Date.now() - lastActivityAt >= opts.timeoutMs) {
      stalled = true;
      opts.transcriptStream.write(
        JSON.stringify({
          type: "harness.stall_timeout",
          message: `no new SDK messages for ${opts.timeoutMs}ms; aborting wedged trial`,
        }) + "\n",
      );
      abortController.abort();
    }
  }, STALL_CHECK_INTERVAL_MS);

  try {
    for await (const message of query({
      prompt: opts.prompt,
      options: {
        model: opts.model,
        cwd: opts.trialDir,
        allowedTools: opts.allowedTools,
        maxTurns: opts.maxTurns,
        maxBudgetUsd: opts.maxBudgetUsd,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        abortController,
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append:
            "Use TDD: write tests first, then implement. Do not modify the runner (run.* file). Be efficient.",
        },
      },
    })) {
      lastActivityAt = Date.now();
      opts.transcriptStream.write(JSON.stringify(message) + "\n");
      if (message.type === "result") {
        if (!resultMessage || (resultMessage.num_turns === 0 && message.num_turns > 0)) {
          resultMessage = message;
        }
      }
    }
  } catch (err: unknown) {
    // SDK threw after emitting messages — if we captured a good result, continue with it
    if (!resultMessage) {
      clearInterval(stallTimer);
      return {
        status: stalled ? "timeout" : "error",
        costUsd: 0,
        costEstimated: false,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        turns: 0,
        actions: 0,
        durationMs: Date.now() - startedAt,
      };
    }
  } finally {
    clearInterval(stallTimer);
  }

  if (!resultMessage) {
    return {
      status: stalled ? "timeout" : "error",
      costUsd: 0,
      costEstimated: false,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      turns: 0,
      actions: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  // map SDK subtype to our status
  let status: HarnessRunResult["status"];
  switch (resultMessage.subtype) {
    case "success":
      status = "success";
      break;
    case "error_max_turns":
      status = "max_turns";
      break;
    case "error_max_budget_usd":
      status = "max_budget";
      break;
    default:
      status = "error";
      break;
  }

  // sum cumulative tokens across all models used in the session
  let inputTokens = 0;
  let outputTokens = 0;
  for (const mu of Object.values(resultMessage.modelUsage)) {
    inputTokens += mu.inputTokens;
    outputTokens += mu.outputTokens;
  }

  return {
    status,
    costUsd: resultMessage.total_cost_usd,
    costEstimated: true,
    inputTokens,
    cachedInputTokens: 0,
    outputTokens,
    reasoningOutputTokens: 0,
    turns: resultMessage.num_turns,
    actions: 0,
    durationMs: resultMessage.duration_ms,
  };
}

export const claudeHarness: Harness = { id: "claude-code", run };
