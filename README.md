# llmlangbench

benchmark LLM coding performance across programming languages.

**Results may be found in [the Releases tab](https://github.com/vivshaw/llmlangbench/releases).**

## languages

| language   | why it's interesting                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------- |
| Python     | the lingua franca of LLM training data. expected baseline                                          |
| TypeScript | massively in-distribution, types to keep things in line                                            |
| JavaScript | just like TypeScript, but no types. how important are types to agent success?                      |
| Ruby       | elegant, concise, expressive, but smaller training corpus than Python/JS, and highly dynamic       |
| Go         | simple language with strict conventions. do LLMs thrive with less ambiguity?                       |
| Rust       | borrow checker and ownership are hard for humans, but provide strong guarantees. how do LLMs fare? |
| Haskell    | pure FP with a powerful type system. a real test of reasoning ability                              |
| Java       | verbose and ceremony-heavy. can LLMs handle the boilerplate?                                       |

## prerequisites

run `./scripts/check-prereqs.sh` to verify your system is ready. The check is
harness-aware:

```bash
./scripts/check-prereqs.sh --harness claude-code
./scripts/check-prereqs.sh --harness codex
./scripts/check-prereqs.sh --harness codex --language python
./scripts/check-prereqs.sh --harness claude-code --review-provider openai
```

**harness:**

- [Node.js](https://nodejs.org/) (>= 18)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and `ANTHROPIC_API_KEY` if you want to run trials with `--harness claude-code`
- [Codex CLI](https://github.com/openai/codex) and `OPENAI_API_KEY` if you want to run trials with `--harness codex`
- `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` for AI code review/report generation. `--harness codex`
  defaults reviews to OpenAI; `--harness claude-code` defaults reviews to Anthropic.

**languages:**
| language   | requires                                                           |
| ---------- | ------------------------------------------------------------------ |
| TypeScript | node, npm                                                          |
| JavaScript | node, npm                                                          |
| Python     | python3, venv module (`apt install python3-venv` on Debian/Ubuntu) |
| Ruby       | ruby, bundler                                                      |
| Rust       | cargo                                                              |
| Go         | go                                                                 |
| Haskell    | stack                                                              |
| Java       | JDK (java, javac)                                                  |

## running benchmarks

```bash
npm install

# run the benchmark
npx tsx src/cli.ts run

# view an agent's transcript from a trial
npx tsx src/cli.ts transcript results/{runId}/{task}/{lang}/trial-1

# re-score an existing trial
npx tsx src/cli.ts score results/{runId}/{task}/{lang}/trial-1 --tests tasks/{task}/tests.json

# regenerate the AI report for a previous run
npx tsx src/cli.ts report results/{runId}

# regenerate the AI report with OpenAI instead of Anthropic
npx tsx src/cli.ts report results/{runId} --review-provider openai
```

these flags can be supplied:

| flag             | default                                           | description                                                |
| ---------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| `--harness`      | `claude-code`                                      | agent harness to run trials with (`claude-code`, `codex`)  |
| `-m, --model`    | `claude-sonnet-4-5-20250929` (`gpt-5.4` for codex) | model for trial agents                                     |
| `-t, --trials`   | `3`                                                 | number of trials per task/language combo                  |
| `--max-turns`    | `60`                                                | max agent turns per trial (`claude-code` only)             |
| `--max-actions`  | `60`                                                | max completed shell commands plus file changes per trial (`codex` only; `0` disables) |
| `--max-budget`   | `5`                                                 | max cost in USD per trial (`claude-code` only)             |
| `--timeout`      | `600`                                               | per-trial timeout, in seconds: wall-clock ceiling from trial start for `codex`; inactivity/stall ceiling (resets on each new SDK message) for `claude-code` |
| `--codex-model-provider` | unset                                      | Codex-only `-c model_provider=<id>` override               |
| `--task`         | all                                                 | run only a specific task                                   |
| `--language`     | all                                                 | run only a specific language                               |
| `--review-provider` | `openai` for `--harness codex`, otherwise `anthropic` | provider for AI code review and analysis (`openai`, `anthropic`) |
| `--review-model` | provider-specific                                  | model for AI code review and analysis (`gpt-5.4` for OpenAI, `claude-sonnet-4-5-20250929` for Anthropic) |

**note on Codex cost:** Codex's `--json` output reports token usage but no billed USD
cost, so `costUsd` for the `codex` harness is estimated from a static per-model pricing
table (`src/pricing.ts`) multiplied by token counts. When a model has cached-input
pricing in the table, cached input tokens are priced separately; otherwise all
input tokens are priced at the standard input rate. If the model is not in the
pricing table, reports show `n/a` instead of treating the run as free. This is
still an estimate, not a billed figure.

When you want benchmark traffic to go through a custom Codex provider without changing your
interactive default, use `--codex-model-provider custom-provider`. This makes the harness spawn:

```bash
codex exec ... -c model_provider=custom-provider
```

That override applies only to the benchmark child process.

**note on Codex actions:** Codex's non-interactive JSON stream usually reports a
single top-level turn for the whole `codex exec` session, so turns are not comparable
to Claude Code turns. For Codex runs, llmlangbench records `actions` instead: one
completed shell command execution, or one individual file add/update/delete. Reports
show `Avg Actions` for Codex and `Avg Turns` for Claude.

## scoring

trials are evaluated on two axes:

**test scoring:** black-box stdin/stdout testing. the harness pipes each test case's `input` to the runner entrypoint and compares stdout against `expected`. supports exact match and approximate float comparison.

**AI code review:** after tests, an LLM reads the agent's source files and evaluates them against the task's `rubric.md`. produces a score (0-100) and written review. this captures code quality, idiom usage, simplicity, and other things tests can't measure. the review model is configurable separately from the trial model.

## results

each run is saved to `results/{runId}/` with the trial working directories preserved, so you can inspect the results:

```
results/2026-02-14T10-07-58-099Z/
  run.json                          # scores, costs, timing
  report.md                         # markdown report (tables + AI analysis)
  add-two-numbers/
    python/trial-1/                 # the agent's working directory
    typescript/trial-1/
    ...
```

## language configuration

languages are configured in `languages.json` at the project root. each entry defines how to install dependencies, run code, and run tests for that language:

```json
{
  "python": {
    "runCommand": "python3 run.py",
    "preTrialCommand": "python3 -m venv .venv && .venv/bin/pip install pytest",
    "testCommand": ".venv/bin/python -m pytest",
    "testFramework": "pytest"
  }
}
```

| field               | purpose                                                    | when it runs                  |
| ------------------- | ---------------------------------------------------------- | ----------------------------- |
| `preTrialCommand`   | install dependencies (npm install, pip install, etc.)      | before the trial agent starts |
| `preScoringCommand` | build/compile the project                                  | before scoring                |
| `testCommand`       | run the test suite                                         | by the trial agent during TDD |
| `testFramework`     | human-readable name shown to the agent                     | in the agent prompt           |
| `runCommand`        | execute the runner entrypoint (reads stdin, writes stdout) | during scoring                |

commands support `{taskId}` interpolation for languages where the binary name depends on the task (e.g. `"./target/release/{taskId}"` for Rust).

### adding a new language

1. add an entry to `languages.json`
2. create a scaffold directory for each task

## tasks

each task lives in `tasks/{taskId}/` and contains:

| file          | purpose                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| `spec.md`     | task specification shown to the agent                                   |
| `tests.json`  | black-box test cases (input/expected pairs for stdin/stdout scoring)    |
| `rubric.md`   | criteria for AI code review scoring                                     |
| `{language}/` | scaffold directory per language (stub files, runner entrypoint, config) |

the agent is presented with the spec and scaffold, then prompted to follow a TDD workflow: write tests, run them, implement, iterate until passing.

### current tasks

| task                  | difficulty | domain            | description                                                                                                                                                                                             |
| --------------------- | ---------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sudoku-solver`       | easy       | search/constraint | solve 9x9 sudoku puzzles using backtracking & constraint propagation, including hard puzzles with minimal givens                                                                                        |
| `regex-matcher`       | medium     | automata theory   | build a regex engine from scratch supporting literals, `.`, `*`, `+`, `?`, `{n,m}`, `\|`, groups, character classes, `\d\w\s` shorthands, escapes                                                       |
| `http-request-parser` | medium     | protocol parsing  | parse raw HTTP/1.1 requests from scratch: headers, Content-Length bodies, chunked transfer encoding with chunk extensions                                                                               |
| `process-simulator`   | medium     | concurrency       | CSP-inspired concurrent process simulator with bounded channels (capacity 1), locks (mutual exclusion), worker-limited scheduling with provisional state updates, and deadlock detection                |
| `mini-typechecker`    | hard       | PL theory         | Hindley-Milner type inference with let-polymorphism, `let rec`, mutual recursion, product types (tuples), type annotations                                                                              |
| `sql-database`        | extreme    | databases         | in-memory SQL database engine: parser, storage, joins (inner/left), aggregation (GROUP BY/HAVING), subqueries (correlated, EXISTS, IN), NULL three-valued logic, ORDER BY, LIMIT/OFFSET, DISTINCT, LIKE |

### adding a new task

1. copy `tasks/_template/` to `tasks/{your-task-id}/`
2. write `spec.md` with the task description and requirements
3. write `tests.json` with stdin/stdout test cases:
   ```json
   {
     "tests": [
       { "input": "1 2\n", "expected": "3" },
       { "input": "0.1 0.2\n", "expected": "0.3", "approx": true }
     ]
   }
   ```
4. write `rubric.md` with task-specific review criteria
5. create a scaffold directory for each language you want to support (e.g. `python/`, `typescript/`), each containing:
   - a runner entrypoint (`run.py`, `run.ts`, etc.) that reads stdin and writes to stdout
   - stub implementation file(s) for the agent to fill in
   - any config files needed (`package.json`, `Cargo.toml`, etc.)

## troubleshooting

there are a number of reasons that a run might crash before completion. two i experienced: network outage, and busted trial results that cause the OOM killer to kill the whole process. further, there can be times when a successfully completed run registers as a failure due to the odd way errors are reported from the Claude subprocess.

if this happen, never fear- you can use `scripts/reconstruct-run.ts` to rebuild `run.json` from transcript files. as long as the source files and the session `transcript.jsonl`s are present, you have everything you need to recover.

```bash
# reconstruct the run
npx tsx scripts/reconstruct-run.ts results/{runId}
```

this tool also supports incremental passes:

| flag             | description                                                  |
| ---------------- | ------------------------------------------------------------ |
| `--skip-scoring` | don't re-run test scoring                                    |
| `--skip-reviews` | don't re-run AI code reviews                                 |
| `--only-missing` | only run scoring/reviews for trials that don't have them yet |
