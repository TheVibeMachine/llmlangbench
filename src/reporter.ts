import { generateText, type ReviewProvider } from "./llm.js";
import type { BenchmarkRun, TrialResult } from "./types.js";

interface LangSummary {
  language: string;
  trials: number;
  avgPassRate: number;
  avgCostUsd: number;
  costAvailable: boolean;
  avgTurns: number;
  avgActions: number;
  avgDurationMs: number;
  avgInputTokens: number;
  avgCachedInputTokens: number;
  avgOutputTokens: number;
  avgReasoningOutputTokens: number;
  avgReviewScore?: number;
}

interface TaskSummary {
  taskId: string;
  language: string;
  trials: number;
  passRate: number;
  avgCostUsd: number;
  costAvailable: boolean;
  avgReviewScore?: number;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = map.get(k);
    if (group) {
      group.push(item);
    } else {
      map.set(k, [item]);
    }
  }
  return map;
}

function passRate(results: TrialResult[]): number {
  const rates = results.map((r) =>
    r.testsTotal > 0 ? r.testsPassed / r.testsTotal : 0,
  );
  return avg(rates);
}

function avgReviewScore(results: TrialResult[]): number | undefined {
  const scores = results
    .map((r) => r.reviewScore)
    .filter((s): s is number => s != null);
  return scores.length > 0 ? avg(scores) : undefined;
}

function costsAvailable(results: TrialResult[]): boolean {
  return results.every((r) => r.costAvailable !== false);
}

function formatCost(costUsd: number, available: boolean): string {
  return available ? `$${costUsd.toFixed(4)}` : "n/a";
}

function buildLanguageSummaries(results: TrialResult[]): LangSummary[] {
  const byLang = groupBy(results, (r) => r.language);
  const summaries: LangSummary[] = [];

  for (const [language, trials] of byLang) {
    summaries.push({
      language,
      trials: trials.length,
      avgPassRate: passRate(trials),
      avgCostUsd: avg(trials.map((t) => t.costUsd)),
      costAvailable: costsAvailable(trials),
      avgTurns: avg(trials.map((t) => t.turns)),
      avgActions: avg(trials.map((t) => t.actions ?? 0)),
      avgDurationMs: avg(trials.map((t) => t.durationMs)),
      avgInputTokens: avg(trials.map((t) => t.inputTokens)),
      avgCachedInputTokens: avg(trials.map((t) => t.cachedInputTokens ?? 0)),
      avgOutputTokens: avg(trials.map((t) => t.outputTokens)),
      avgReasoningOutputTokens: avg(trials.map((t) => t.reasoningOutputTokens ?? 0)),
      avgReviewScore: avgReviewScore(trials),
    });
  }

  return summaries.sort((a, b) => b.avgPassRate - a.avgPassRate);
}

function buildTaskSummaries(results: TrialResult[]): TaskSummary[] {
  const byCombo = groupBy(results, (r) => `${r.taskId}:${r.language}`);
  const summaries: TaskSummary[] = [];

  for (const [, trials] of byCombo) {
    const first = trials[0]!;
    summaries.push({
      taskId: first.taskId,
      language: first.language,
      trials: trials.length,
      passRate: passRate(trials),
      avgCostUsd: avg(trials.map((t) => t.costUsd)),
      costAvailable: costsAvailable(trials),
      avgReviewScore: avgReviewScore(trials),
    });
  }

  return summaries.sort((a, b) => {
    if (a.taskId !== b.taskId) return a.taskId.localeCompare(b.taskId);
    return b.passRate - a.passRate;
  });
}

function pad(s: string, len: number): string {
  return s.padEnd(len);
}

function rpad(s: string, len: number): string {
  return s.padStart(len);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * generate the tables/stats section of the report as a markdown string.
 */
export function generateReport(run: BenchmarkRun): string {
  const lines: string[] = [];
  const isCodex = run.config.harness === "codex";

  lines.push(`# Benchmark Run: ${run.id}`);
  lines.push("");
  lines.push(`**Model:** ${run.config.model}`);
  if (run.config.reviewProvider && run.config.reviewModel) {
    lines.push(`**Review:** ${run.config.reviewProvider} / ${run.config.reviewModel}`);
  }
  if (isCodex) {
    const maxActions = run.config.maxActions;
    const actionBudget = maxActions == null
      ? "action cap not recorded"
      : maxActions === 0
        ? "no action cap"
        : `max ${maxActions} actions`;
    lines.push(`**Config:** ${run.config.trials} trials, ${actionBudget}, ${(run.config.timeoutMs / 1000).toFixed(0)}s timeout`);
  } else {
    lines.push(
      `**Config:** ${run.config.trials} trials, max ${run.config.maxTurns} turns, $${run.config.maxBudgetUsd} budget`,
    );
  }
  lines.push(`**Total results:** ${run.results.length}`);

  // language summary table
  const langSummaries = buildLanguageSummaries(run.results);

  lines.push("");
  lines.push("## Per-Language Summary");
  lines.push("");
  const effortHeader = isCodex ? "Avg Actions" : "Avg Turns";
  lines.push(
    `| ${pad("Language", 14)} | ${rpad("Trials", 7)} | ${rpad("Pass%", 7)} | ${rpad("Avg Cost", 10)} | ${rpad(effortHeader, 11)} | ${rpad("Avg Time", 10)} | ${rpad("Review", 8)} |`,
  );
  lines.push(
    `| ${"-".repeat(14)} | ${"-".repeat(7)}: | ${"-".repeat(7)}: | ${"-".repeat(10)}: | ${"-".repeat(11)}: | ${"-".repeat(10)}: | ${"-".repeat(8)}: |`,
  );

  for (const s of langSummaries) {
    const effort = isCodex ? s.avgActions : s.avgTurns;
    lines.push(
      `| ${pad(s.language, 14)} | ${rpad(String(s.trials), 7)} | ${rpad((s.avgPassRate * 100).toFixed(1) + "%", 7)} | ${rpad(formatCost(s.avgCostUsd, s.costAvailable), 10)} | ${rpad(effort.toFixed(1), 11)} | ${rpad(formatDuration(s.avgDurationMs), 10)} | ${rpad(s.avgReviewScore != null ? s.avgReviewScore.toFixed(0) : "-", 8)} |`,
    );
  }

  // task breakdown table
  const taskSummaries = buildTaskSummaries(run.results);

  lines.push("");
  lines.push("## Per-Task Breakdown");
  lines.push("");
  lines.push(
    `| ${pad("Task", 20)} | ${pad("Language", 14)} | ${rpad("Trials", 7)} | ${rpad("Pass%", 7)} | ${rpad("Avg Cost", 10)} | ${rpad("Review", 8)} |`,
  );
  lines.push(
    `| ${"-".repeat(20)} | ${"-".repeat(14)} | ${"-".repeat(7)}: | ${"-".repeat(7)}: | ${"-".repeat(10)}: | ${"-".repeat(8)}: |`,
  );

  for (const s of taskSummaries) {
    lines.push(
      `| ${pad(s.taskId, 20)} | ${pad(s.language, 14)} | ${rpad(String(s.trials), 7)} | ${rpad((s.passRate * 100).toFixed(1) + "%", 7)} | ${rpad(formatCost(s.avgCostUsd, s.costAvailable), 10)} | ${rpad(s.avgReviewScore != null ? s.avgReviewScore.toFixed(0) : "-", 8)} |`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * build per-language data sections used as context for AI narrative calls.
 */
function buildLangDataSections(run: BenchmarkRun): {
  sections: string[];
  languages: string[];
} {
  const byLang = groupBy(run.results, (r) => r.language);
  const sections: string[] = [];

  for (const [language, trials] of byLang) {
    const pr = passRate(trials);
    const avgCost = avg(trials.map((t) => t.costUsd));
    const costAvailable = costsAvailable(trials);
    const avgTurns = avg(trials.map((t) => t.turns));
    const avgActions = avg(trials.map((t) => t.actions ?? 0));
    const avgDuration = avg(trials.map((t) => t.durationMs));
    const reviewScore = avgReviewScore(trials);

    let section = `### ${language}\n`;
    section += `- Trials: ${trials.length}\n`;
    section += `- Pass rate: ${(pr * 100).toFixed(1)}%\n`;
    section += `- Avg cost: ${formatCost(avgCost, costAvailable)}\n`;
    if (run.config.harness === "codex") {
      section += `- Avg actions: ${avgActions.toFixed(1)}\n`;
    } else {
      section += `- Avg turns: ${avgTurns.toFixed(1)}\n`;
    }
    section += `- Avg time: ${formatDuration(avgDuration)}\n`;
    if (reviewScore != null) {
      section += `- Avg review score: ${reviewScore.toFixed(0)}/100\n`;
    }

    const reviews = trials
      .filter((t) => t.reviewText)
      .map((t) => `  - [${t.taskId}, trial ${t.trial}]: ${t.reviewText}`);
    if (reviews.length > 0) {
      section += `- Review excerpts:\n${reviews.join("\n")}\n`;
    }

    sections.push(section);
  }

  return { sections, languages: Array.from(byLang.keys()) };
}

interface AnalysisResult {
  languages: Map<string, string>;
  overall: string;
}

/**
 * single Claude API call that generates both per-language narratives
 * and an overall cross-language summary.
 */
export async function generateAnalysis(
  run: BenchmarkRun,
  model: string,
  provider: ReviewProvider,
): Promise<AnalysisResult> {
  const { sections, languages } = buildLangDataSections(run);

  const prompt = `You are analyzing benchmark results for an LLM coding benchmark that tests how well ${run.config.model} writes code in different programming languages.

Here is the per-language data:

${sections.join("\n")}

Write two things:

1. **Per-language narratives:** For each language, a concise analytical paragraph (3-5 sentences) that synthesizes the statistics and review feedback into a readable narrative. Focus on notable strengths, weaknesses, and patterns. Compare languages where relevant.

2. **Overall summary:** 2-4 paragraphs synthesizing insights from comparing all languages. Cover which languages the model handles best and worst (and why), cross-cutting patterns (e.g. paradigms, type systems, ecosystems), cost/efficiency tradeoffs, and any surprising or notable takeaways.

Respond with a JSON object containing:
- "languages": an object where keys are the language names (exactly: ${languages.map((l) => `"${l}"`).join(", ")}) and values are the narrative paragraphs
- "overall": the overall summary as a single string (use \\n for paragraph breaks)

Respond ONLY with the JSON object, no other text.`;

  const raw = await generateText(prompt, {
    provider,
    model,
    maxTokens: 4096,
  });

  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
  const jsonStr = (jsonMatch[1] ?? raw).trim();

  const parsed = JSON.parse(jsonStr) as {
    languages: Record<string, string>;
    overall: string;
  };

  return {
    languages: new Map(Object.entries(parsed.languages)),
    overall: parsed.overall,
  };
}

/**
 * build the full report markdown, including AI-generated
 * per-language narrative analysis and overall summary.
 */
export async function buildReport(
  run: BenchmarkRun,
  reviewModel: string,
  reviewProvider: ReviewProvider,
): Promise<string> {
  let report = generateReport(run);

  console.log("generating analysis...");
  const analysis = await generateAnalysis(run, reviewModel, reviewProvider);

  report += "\n## Language Analysis\n";
  for (const [language, narrative] of analysis.languages) {
    report += `\n### ${language}\n\n${narrative}\n`;
  }

  report += "\n## Overall Summary\n\n" + analysis.overall + "\n";

  return report;
}
