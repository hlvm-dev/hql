#!/bin/bash
# Simple test runner for HQL
# Usage: ./test.sh [filter]

set -e

if [ -n "$1" ]; then
  echo "Running tests matching: $1"
  deno test --allow-all test/*$1*.test.ts test/organized/syntax/*/*.test.ts
else
  echo "Running all HQL tests..."
  deno test --allow-all test/*.test.ts test/organized/syntax/*/*.test.ts
fi
