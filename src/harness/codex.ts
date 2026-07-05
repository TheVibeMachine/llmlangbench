import { spawn } from "node:child_process";
import * as readline from "node:readline";
import { priceTokens } from "../pricing.js";
import type { Harness, HarnessRunOptions, HarnessRunResult } from "./types.js";

interface CodexTurnCompletedEvent {
  type: "turn.completed";
  usage: {
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
    reasoning_output_tokens: number;
  };
}

interface CodexItemCompletedEvent {
  type: "item.completed";
  item?: {
    type?: string;
    changes?: unknown[];
  };
}

function isTurnCompleted(event: { type: string }): event is CodexTurnCompletedEvent {
  return event.type === "turn.completed";
}

function isItemCompleted(event: { type: string }): event is CodexItemCompletedEvent {
  return event.type === "item.completed";
}

async function run(opts: HarnessRunOptions): Promise<HarnessRunResult> {
  const startedAt = Date.now();

  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;
  let reasoningOutputTokens = 0;
  let turns = 0;
  let actions = 0;
  let sawTurnFailed = false;
  let hitActionBudget = false;
  let childExited = false;

  try {
    const providerArgs = opts.codexModelProvider
      ? ["-c", `model_provider=${opts.codexModelProvider}`]
      : [];
    const child = spawn(
      "codex",
      [
        "exec",
        "--json",
        "--dangerously-bypass-approvals-and-sandbox",
        "--skip-git-repo-check",
        "-C",
        opts.trialDir,
        "-m",
        opts.model,
        ...providerArgs,
      ],
      { detached: true, stdio: ["pipe", "pipe", "pipe"] },
    );

    const terminateChild = (signal: NodeJS.Signals): void => {
      if (child.pid) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // Fall back to killing only the child process if process-group
          // termination is unavailable.
        }
      }
      child.kill(signal);
    };

    child.stdin.write(opts.prompt);
    child.stdin.end();

    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      opts.transcriptStream.write(line + "\n");
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line) as { type: string };
        if (isTurnCompleted(event)) {
          inputTokens += event.usage.input_tokens;
          cachedInputTokens += event.usage.cached_input_tokens;
          outputTokens += event.usage.output_tokens;
          reasoningOutputTokens += event.usage.reasoning_output_tokens;
          turns += 1;
        } else if (isItemCompleted(event)) {
          if (event.item?.type === "command_execution") {
            actions += 1;
          } else if (event.item?.type === "file_change") {
            actions += Array.isArray(event.item.changes) ? event.item.changes.length : 1;
          }

          // This guard is best-effort: Codex can exit between stdout line
          // processing and termination. terminateChild swallows that race.
          if (opts.maxActions > 0 && actions > opts.maxActions && !hitActionBudget && !childExited) {
            hitActionBudget = true;
            opts.transcriptStream.write(
              JSON.stringify({
                type: "harness.max_actions",
                message: `action budget exceeded: ${actions}/${opts.maxActions}; terminating codex trial`,
                actions,
                maxActions: opts.maxActions,
              }) + "\n",
            );
            terminateChild("SIGTERM");
          }
        } else if (event.type === "turn.failed") {
          sawTurnFailed = true;
        }
      } catch {
        // not JSON, ignore for metrics purposes
      }
    });

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    let timedOut = false;

    const exitCode = await new Promise<number>((resolve, reject) => {
      let killTimer: NodeJS.Timeout | undefined;
      const timer = setTimeout(() => {
        timedOut = true;
        opts.transcriptStream.write(
          JSON.stringify({
            type: "harness.timeout",
            message: `wall-clock timeout reached after ${opts.timeoutMs}ms; terminating codex trial`,
            timeoutMs: opts.timeoutMs,
          }) + "\n",
        );
        terminateChild("SIGTERM");
        killTimer = setTimeout(() => terminateChild("SIGKILL"), 5_000);
      }, opts.timeoutMs);

      child.on("error", (err) => {
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        reject(err);
      });

      child.on("close", (code, signal) => {
        childExited = true;
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        if (signal) {
          resolve(-1);
        } else {
          resolve(code ?? -1);
        }
      });
    });

    const durationMs = Date.now() - startedAt;
    const cost = priceTokens(opts.model, inputTokens, outputTokens, cachedInputTokens);

    let status: HarnessRunResult["status"];
    if (hitActionBudget) {
      status = "max_actions";
    } else if (timedOut) {
      status = "timeout";
    } else if (exitCode !== 0 || sawTurnFailed) {
      status = "error";
      if (stderr.trim()) {
        opts.transcriptStream.write(JSON.stringify({ type: "harness.stderr", message: stderr.trim() }) + "\n");
      }
    } else {
      status = "success";
    }

    return {
      status,
      costUsd: cost.costUsd,
      costAvailable: cost.estimated,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningOutputTokens,
      turns,
      actions,
      durationMs,
    };
  } catch (err: unknown) {
    opts.transcriptStream.write(
      JSON.stringify({ type: "harness.error", message: err instanceof Error ? err.message : String(err) }) + "\n",
    );
    return {
      status: "error",
      costUsd: 0,
      costAvailable: false,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningOutputTokens,
      turns: 0,
      actions,
      durationMs: Date.now() - startedAt,
    };
  }
}

export const codexHarness: Harness = { id: "codex", run };
