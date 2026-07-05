import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_ANTHROPIC_REVIEW_MODEL, generateText, type ReviewProvider } from "./llm.js";

export interface ReviewResult {
  score: number;
  review: string;
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  ".mypy_cache",
  "target",
  ".stack-work",
  "dist",
  "build",
  ".gradle",
  "gradle",
  ".git",
  "vendor",
]);

const SKIP_EXTENSIONS = new Set([
  // compiled / binary
  ".jar",
  ".class",
  ".o",
  ".so",
  ".dylib",
  ".exe",
  ".pyc",
  ".a",
  ".rlib",
  ".rmeta",
  ".hi",
  ".dyn_hi",
  ".bin",
  // generated / metadata
  ".lock",
  ".jsonl",
  ".map",
  ".d",
  ".timestamp",
]);

/**
 * it's necessary to filter out all the non-source files before passing the results to
 * the reviewer. otherwise, it sees tons of irrelevant stuff and gives bad reviews.
 */
export function collectSourceFiles(dir: string): Map<string, string> {
  const files = new Map<string, string>();

  function walk(current: string, relPrefix: string): void {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && !SKIP_DIRS.has(entry.name)) {
          walk(path.join(current, entry.name), relPath);
        }
      } else {
        // skip run.* entrypoints and binary/lock files
        if (/^run\./.test(entry.name)) continue;
        if (SKIP_EXTENSIONS.has(path.extname(entry.name))) continue;

        // skip files without extensions (likely compiled binaries like Go executables)
        if (!path.extname(entry.name)) continue;

        // skip files over 500KB (definitely not source code)
        const filePath = path.join(current, entry.name);
        try {
          const stat = fs.statSync(filePath);
          if (stat.size > 500_000) continue;
        } catch { continue; }

        try {
          const content = fs.readFileSync(
            filePath,
            "utf-8",
          );
          files.set(relPath, content);
        } catch {
          // skip files that can't be read as utf-8
        }
      }
    }
  }

  walk(dir, "");
  return files;
}

export async function reviewTrialDir(
  dir: string,
  specPath: string,
  rubricPath: string,
  scaffoldDir: string,
  model = DEFAULT_ANTHROPIC_REVIEW_MODEL,
  provider: ReviewProvider = "anthropic",
): Promise<ReviewResult> {
  const spec = fs.readFileSync(specPath, "utf-8");
  const rubric = fs.readFileSync(rubricPath, "utf-8");

  const allFiles = collectSourceFiles(dir);

  // only review files the agent wrote or modified (exclude unchanged scaffold)
  const scaffold = collectSourceFiles(scaffoldDir);
  const sourceFiles = new Map(
    Array.from(allFiles).filter(
      ([relPath, content]) => !scaffold.has(relPath) || scaffold.get(relPath) !== content,
    ),
  );

  if (sourceFiles.size === 0) {
    return { score: 0, review: "No source files found in trial directory." };
  }

  const filesSection = Array.from(sourceFiles.entries())
    .map(([relPath, content]) => `### ${relPath}\n\`\`\`\n${content}\n\`\`\``)
    .join("\n\n");

  const prompt = `You are a code reviewer evaluating AI-generated code. Review the following code that was written to satisfy a task specification.

## Task Specification

${spec}

## Review Rubric

${rubric}

## Source Files

${filesSection}

## Instructions

Evaluate the code against the rubric and specification. Score each rubric dimension independently, then sum the dimension scores for the total. A score of 100 is appropriate when all criteria are fully met — do not reserve points for hypothetical improvements not mentioned in the rubric.

Respond with a JSON object containing:
- "score": the summed total (0-100)
- "review": a brief written review (1-2 paragraphs) explaining the per-dimension scores

Respond ONLY with the JSON object, no other text.`;

  const raw = await generateText(prompt, {
    provider,
    model,
    maxTokens: 2048,
  });

  // parse JSON, handling optional markdown code fences and malformed responses
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
  let jsonStr = (jsonMatch[1] ?? raw).trim();

  let parsed: { score: number; review: string };
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    // fallback: try to extract score and review with regex
    const scoreMatch = raw.match(/"score"\s*:\s*(\d+)/);
    const reviewMatch = raw.match(/"review"\s*:\s*"([\s\S]*?)(?:"\s*[,}])/);
    if (scoreMatch) {
      parsed = {
        score: parseInt(scoreMatch[1]!),
        review: reviewMatch?.[1] ?? "review text could not be parsed",
      };
    } else {
      throw new Error(`Could not parse review response: ${raw.slice(0, 300)}`);
    }
  }

  return {
    score: Math.max(0, Math.min(100, parsed.score)),
    review: parsed.review,
  };
}
