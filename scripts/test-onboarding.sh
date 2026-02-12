#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

FIRST_QUERY="${1:-go to yahoo stock and show me tesla stock price}"

FRESH_DIR="$(mktemp -d -t hlvm-onboarding-XXXXXX)"
export HLVM_DIR="$FRESH_DIR"

unset HLVM_DISABLE_AI_AUTOSTART
unset OLLAMA_API_KEY
unset OPENAI_API_KEY
unset ANTHROPIC_API_KEY
unset GOOGLE_API_KEY
unset OPENROUTER_API_KEY

if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'
  C_BOLD=$'\033[1m'
  C_DIM=$'\033[2m'
  C_CYAN=$'\033[36m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_RED=$'\033[31m'
else
  C_RESET=""
  C_BOLD=""
  C_DIM=""
  C_CYAN=""
  C_GREEN=""
  C_YELLOW=""
  C_RED=""
fi

line() {
  echo "${C_CYAN}============================================================${C_RESET}"
}

title() {
  line
  echo "${C_BOLD}${C_CYAN}$1${C_RESET}"
  line
}

step() {
  echo "${C_BOLD}${C_CYAN}[$1]${C_RESET} $2"
}

ok() {
  echo "${C_BOLD}${C_GREEN}[OK]${C_RESET} $1"
}

fail() {
  echo "${C_BOLD}${C_RED}[FAIL]${C_RESET} $1"
}

title "HLVM Onboarding Test (Real First-User Simulation)"
echo "${C_DIM}Repository:${C_RESET} $ROOT_DIR"
echo "${C_DIM}Fresh HLVM_DIR:${C_RESET} $HLVM_DIR"
echo "${C_DIM}Prompt:${C_RESET} \"$FIRST_QUERY\""
echo

step "1/4" "Building HLVM binary..."
make build
ok "Build complete: ./hlvm"
echo

if command -v ollama >/dev/null 2>&1; then
  step "2/4" "Signing out from ollama.com (fresh-user simulation)..."
  ollama signout || true
  ok "Signed out (or already signed out)."
else
  fail "Ollama CLI not found in PATH."
  echo "Install Ollama first: https://ollama.com/download"
  exit 1
fi
echo

step "3/4" "Running first ask (onboarding + meaningful task)..."
echo "${C_DIM}When prompted '${C_BOLD}Continue? [Y/n]${C_RESET}${C_DIM}', press Enter once.${C_RESET}"
echo "${C_DIM}If sign-in is required, complete the browser flow and return here.${C_RESET}"
echo
if ! ./hlvm ask "$FIRST_QUERY"; then
  echo
  fail "First run failed."
  echo "Complete sign-in, then rerun this script:"
  echo "  bash scripts/test-onboarding.sh \"$FIRST_QUERY\""
  echo
  echo "Or run directly:"
  echo "  ollama signin"
  echo
  exit 1
fi
ok "Onboarding + first query completed."
echo

step "4/4" "Final state"
echo "Config file:"
echo "  $HLVM_DIR/config.json"
cat "$HLVM_DIR/config.json"
echo
title "PASS: First-run onboarding flow executed"
echo "${C_DIM}Tip: run another ask with the same HLVM_DIR to confirm setup is skipped.${C_RESET}"
echo "  HLVM_DIR=\"$HLVM_DIR\" ./hlvm ask \"show me top 3 recent model releases from ollama.com\""
