#!/usr/bin/env bash
set -euo pipefail

pass=0
fail=0
warn=0
harness="claude-code"
review_provider=""
language="all"

usage() {
  cat <<EOF
usage: $0 [--harness claude-code|codex] [--review-provider anthropic|openai] [--language id]

Defaults mirror llmlangbench:
  --harness claude-code        requires Claude Code and ANTHROPIC_API_KEY
  --harness codex              requires Codex CLI and OPENAI_API_KEY
  --review-provider            defaults to anthropic for claude-code, openai for codex
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --harness)
      harness="${2:-}"
      shift 2
      ;;
    --review-provider)
      review_provider="${2:-}"
      shift 2
      ;;
    --language)
      language="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$harness" in
  claude-code|codex) ;;
  *)
    echo "invalid --harness: $harness" >&2
    exit 2
    ;;
esac

if [ -z "$review_provider" ]; then
  if [ "$harness" = "codex" ]; then
    review_provider="openai"
  else
    review_provider="anthropic"
  fi
fi

case "$review_provider" in
  anthropic|openai) ;;
  *)
    echo "invalid --review-provider: $review_provider" >&2
    exit 2
    ;;
esac

case "$language" in
  all|typescript|javascript|python|ruby|rust|go|haskell|java) ;;
  *)
    echo "invalid --language: $language" >&2
    exit 2
    ;;
esac

ok()   { pass=$((pass + 1)); printf "  \033[32m✓\033[0m %s\n" "$1"; }
fail() { fail=$((fail + 1)); printf "  \033[31m✗\033[0m %s\n" "$1"; }
warn() { warn=$((warn + 1)); printf "  \033[33m?\033[0m %s\n" "$1"; }

check_cmd() {
  local cmd="$1" label="$2" version_cmd="${3:---version}"
  if command -v "$cmd" &>/dev/null; then
    local version
    version=$("$cmd" $version_cmd 2>&1 | head -1) || version="(version unknown)"
    ok "$label — $version"
  else
    fail "$label — \`$cmd\` not found"
  fi
}

check_cmd_optional() {
  local cmd="$1" label="$2" version_cmd="${3:---version}"
  if command -v "$cmd" &>/dev/null; then
    local version
    version=$("$cmd" $version_cmd 2>&1 | head -1) || version="(version unknown)"
    ok "$label — $version"
  else
    warn "$label — \`$cmd\` not found"
  fi
}

check_env() {
  local name="$1" label="$2"
  if [ -n "${!name:-}" ]; then
    ok "$label"
  else
    fail "$label — $name is not set"
  fi
}

check_env_optional() {
  local name="$1" label="$2"
  if [ -n "${!name:-}" ]; then
    ok "$label"
  else
    warn "$label — $name is not set"
  fi
}

echo ""
echo "harness"
echo "-------"
echo "selected harness: $harness"
echo "selected review provider: $review_provider"
check_cmd node "Node.js"
check_cmd npm "npm"

if [ "$harness" = "claude-code" ]; then
  check_cmd claude "Claude Code (for --harness claude-code)"
else
  check_cmd_optional claude "Claude Code (optional, for --harness claude-code)"
fi

if [ "$harness" = "codex" ]; then
  check_cmd codex "Codex CLI (for --harness codex)"
else
  check_cmd_optional codex "Codex CLI (optional, for --harness codex)"
fi

if [ "$harness" = "claude-code" ] || [ "$review_provider" = "anthropic" ]; then
  check_env ANTHROPIC_API_KEY "ANTHROPIC_API_KEY is set"
else
  check_env_optional ANTHROPIC_API_KEY "ANTHROPIC_API_KEY is set"
fi

if [ "$harness" = "codex" ] || [ "$review_provider" = "openai" ]; then
  check_env OPENAI_API_KEY "OPENAI_API_KEY is set"
else
  check_env_optional OPENAI_API_KEY "OPENAI_API_KEY is set"
fi

echo ""
echo "languages"
echo "---------"
echo "selected language: $language"

if [ "$language" = "all" ] || [ "$language" = "typescript" ] || [ "$language" = "javascript" ]; then
  check_cmd npx "TypeScript / JavaScript (npx)"
fi

if [ "$language" = "all" ] || [ "$language" = "python" ]; then
  check_cmd python3 "Python"
  if python3 -m venv --help &>/dev/null; then
    ok "Python — venv module"
  else
    fail "Python — venv module not available (apt install python3-venv on Debian/Ubuntu)"
  fi
fi

if [ "$language" = "all" ] || [ "$language" = "ruby" ]; then
  check_cmd ruby "Ruby"
  check_cmd bundle "Ruby — Bundler"
fi

if [ "$language" = "all" ] || [ "$language" = "rust" ]; then
  check_cmd cargo "Rust"
fi

if [ "$language" = "all" ] || [ "$language" = "go" ]; then
  check_cmd go "Go" "version"
fi

if [ "$language" = "all" ] || [ "$language" = "haskell" ]; then
  check_cmd stack "Haskell"
fi

if [ "$language" = "all" ] || [ "$language" = "java" ]; then
  check_cmd java "Java (JDK)" "-version"
  check_cmd javac "Java — javac (confirms full JDK)" "-version"
fi

echo ""
echo "---"
printf "%d passed, %d failed, %d warnings\n" "$pass" "$fail" "$warn"

if [ "$fail" -gt 0 ]; then
  echo ""
  echo "some prerequisites are missing. you can still run benchmarks for"
  echo "languages whose prerequisites are met — use --language to filter."
  exit 1
fi
