import { claudeHarness } from "./claude.js";
import { codexHarness } from "./codex.js";
import type { Harness } from "./types.js";

export type { Harness, HarnessRunOptions, HarnessRunResult } from "./types.js";

export function getHarness(id: "claude-code" | "codex"): Harness {
  switch (id) {
    case "claude-code":
      return claudeHarness;
    case "codex":
      return codexHarness;
    default:
      throw new Error(`unknown harness: ${id}`);
  }
}
