#!/usr/bin/env bash
set -euo pipefail

attempts=3
delay_seconds=5

while [ "$#" -gt 0 ]; do
  case "$1" in
    --attempts)
      attempts=${2:-}
      shift 2
      ;;
    --delay)
      delay_seconds=${2:-}
      shift 2
      ;;
    --)
      shift
      break
      ;;
    *)
      break
      ;;
  esac
done

if [ "$#" -eq 0 ]; then
  echo "Usage: scripts/with-retry.sh [--attempts N] [--delay SECONDS] -- <command> [args...]" >&2
  exit 1
fi

if ! [[ "$attempts" =~ ^[0-9]+$ ]] || [ "$attempts" -lt 1 ]; then
  echo "--attempts must be a positive integer." >&2
  exit 1
fi

if ! [[ "$delay_seconds" =~ ^[0-9]+$ ]] || [ "$delay_seconds" -lt 0 ]; then
  echo "--delay must be a non-negative integer." >&2
  exit 1
fi

attempt=1
while true; do
  set +e
  "$@"
  status=$?
  set -e

  if [ "$status" -eq 0 ]; then
    exit 0
  fi
  if [ "$attempt" -ge "$attempts" ]; then
    echo "Command failed after ${attempts} attempts: $*" >&2
    exit "$status"
  fi

  echo "Attempt ${attempt}/${attempts} failed for: $*" >&2
  if [ "$delay_seconds" -gt 0 ]; then
    echo "Retrying in ${delay_seconds}s..." >&2
    sleep "$delay_seconds"
  fi
  attempt=$((attempt + 1))
done
