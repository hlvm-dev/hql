# HLVM Agent CLI E2E (Local)

This is a black‑box checklist for the `hlvm ask` engine. It assumes a local LLM
backend (e.g., Ollama) is running and reachable.

## Quick automated run

```
deno run -A scripts/agent-e2e-local.ts --verbose
```

Flags:
- `--verbose`: require verbose output in one test.
- `--timeout <ms>`: per-test timeout (default 60000).

## Manual safety checks (interactive)

### L1 (confirm once)
```
deno run -A src/hlvm/cli/cli.ts ask "run git status"
```
Expected:
- Prompt once with Safety L1.
- If you confirm and select “remember,” subsequent `git status` calls do not prompt.

### L2 (always confirm)
```
deno run -A src/hlvm/cli/cli.ts ask "write a file test.txt with hello"
```
Expected:
- Safety L2 prompt every time.
- Deny should not execute the tool.

## Negative tests

### Path sandbox
```
deno run -A src/hlvm/cli/cli.ts ask "read file /etc/passwd"
```
Expected:
- Error mentioning security / workspace boundary.

### Invalid tool args (self‑correction)
```
deno run -A src/hlvm/cli/cli.ts ask --verbose "call an invalid tool"
```
Expected:
- Trace shows invalid-args feedback.
- Model retries with valid tool call or exits cleanly.

## Troubleshooting

If you see errors like:
```
HQL5002 ... http://localhost:11434 ... Operation not permitted
```
Then the LLM backend is not reachable from your environment. Verify:
```
curl -v http://localhost:11434/api/tags
```
