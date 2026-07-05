import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { getHarness } from "./harness/index.js";
import type { HarnessRunResult } from "./harness/types.js";
import type { ReviewProvider } from "./llm.js";
import { reviewTrialDir } from "./reviewer.js";
import { scoreTrialDir } from "./scorer.js";
import type { LanguageConfig, RunConfig, TrialResult } from "./types.js";

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export async function runTrial(
  taskId: string,
  specPath: string,
  testsPath: string,
  scaffoldDir: string,
  trialDir: string,
  language: LanguageConfig,
  runConfig: RunConfig,
  trial: number,
  rubricPath: string,
  reviewModel: string,
  reviewProvider: ReviewProvider,
): Promise<TrialResult> {
  const startedAt = Date.now();
  fs.mkdirSync(trialDir, { recursive: true });

  let harnessResult: HarnessRunResult | undefined;

  try {
    // copy scaffold into trial dir
    copyDirSync(scaffoldDir, trialDir);

    // install dependencies before handing off to the agent
    if (language.preTrialCommand) {
      execSync(language.preTrialCommand, {
        cwd: trialDir,
        stdio: "pipe",
        timeout: 120_000,
      });
    }

    // read the task spec
    const spec = fs.readFileSync(specPath, "utf-8");

    // build prompt
    const prompt = [
      `You are working in ${trialDir}.`,
      `Your task is to implement a solution in ${language.id}.`,
      "",
      "## Task Specification",
      "",
      spec,
      "",
      "## Development Environment",
      "",
      `- **Language**: ${language.id}`,
      `- **Test framework**: ${language.testFramework}`,
      `- **Run tests**: \`${language.testCommand}\``,
      language.preScoringCommand
        ? `- **Setup/build**: \`${language.preScoringCommand}\``
        : "",
      "",
      "## Instructions",
      "",
      "Follow a test-driven development (TDD) approach:",
      "",
      "1. Read the existing files in the working directory to understand the scaffold.",
      "2. Write a thorough test suite first, covering the requirements in the spec — including edge cases.",
      `3. Run your tests with \`${language.testCommand}\` to confirm they fail (since the implementation is a stub).`,
      "4. Implement the solution in the stub file(s). Do NOT modify the runner entrypoint (run.* file).",
      "5. Run your tests again and iterate until all tests pass.",
      "",
      "Your solution will be scored separately, so focus on writing good tests and a correct implementation.",
    ].filter(Boolean).join("\n");

    const transcriptPath = path.join(trialDir, "transcript.jsonl");
    const transcriptStream = fs.createWriteStream(transcriptPath);

    const harness = getHarness(runConfig.harness);
    harnessResult = await harness.run({
      prompt,
      trialDir,
      model: runConfig.model,
      codexModelProvider: runConfig.codexModelProvider,
      maxTurns: runConfig.maxTurns,
      maxActions: runConfig.maxActions,
      maxBudgetUsd: runConfig.maxBudgetUsd,
      timeoutMs: runConfig.timeoutMs,
      allowedTools: runConfig.allowedTools,
      transcriptStream,
    });

    transcriptStream.end();
  } catch (err: unknown) {
    return {
      taskId,
      language: language.id,
      trial,
      status: "error",
      costUsd: 0,
      costEstimated: false,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      turns: 0,
      actions: 0,
      durationMs: Date.now() - startedAt,
      testsPassed: 0,
      testsTotal: 0,
      testOutput: `harness error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // score the result
  const scoreResult = await scoreTrialDir(trialDir, language, testsPath);

  // AI code review (best-effort — failure shouldn't tank the trial)
  let reviewScore: number | undefined;
  let reviewText: string | undefined;

  try {
    const review = await reviewTrialDir(
      trialDir,
      specPath,
      rubricPath,
      scaffoldDir,
      reviewModel,
      reviewProvider,
    );
    reviewScore = review.score;
    reviewText = review.review;
  } catch (err: unknown) {
    reviewText = `review failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  // harness.run() always resolves (never throws), so this is always set here
  const h = harnessResult!;

  return {
    taskId,
    language: language.id,
    trial,
    status: h.status,
    costUsd: h.costUsd,
    costEstimated: h.costEstimated,
    inputTokens: h.inputTokens,
    cachedInputTokens: h.cachedInputTokens,
    outputTokens: h.outputTokens,
    reasoningOutputTokens: h.reasoningOutputTokens,
    turns: h.turns,
    actions: h.actions,
    durationMs: h.durationMs,
    testsPassed: scoreResult.passed,
    testsTotal: scoreResult.total,
    testOutput: scoreResult.output,
    reviewScore,
    reviewText,
  };
}
