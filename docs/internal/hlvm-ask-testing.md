# Testing Models via `hlvm ask`

How to run prompts through the HLVM agent loop for benchmarking or
verification. This doc exists because multiple AI agents have wasted time
debugging connectivity issues that have a simple fix.

## TL;DR

```bash
# 1. Production path: use the compiled binary. It owns the shared daemon.
./hlvm ask --print --permission-mode dontAsk "your prompt"                                    # gemma4 (default)
./hlvm ask --model claude-code/claude-haiku-4-5-20251001 --print --permission-mode dontAsk "your prompt"  # haiku

# 2. Source-mode diagnostics: isolate explicitly so you do not touch the shared daemon.
HLVM_REPL_PORT=19435 deno run -A src/hlvm/cli/cli.ts ask --print --permission-mode dontAsk "your prompt"
```

## Architecture

```
hlvm ask (CLI)  ──HTTP POST──▶  hlvm serve (:11435)  ──manages──▶  Ollama (:11439)
                                     │                                   ▲
                                     │  chat handler calls               │
                                     └──ai.models.get()────HTTP POST────┘
                                        ollama/api.ts        /api/show
```

- **Port 11435**: HLVM serve (HTTP REPL server). All `hlvm ask` requests go
  here first.
- **Port 11439**: HLVM-managed Ollama engine. Serve starts it during
  `initializeRuntime()`. The CLI never talks to Ollama directly — it goes
  through serve, which calls Ollama's API internally.
- **No backdoor**: Never `curl` Ollama on 11439 directly. Never start a
  separate Ollama process. Always go through `hlvm ask` / `hlvm serve`.

## Available Models

| Model | Flag | Auth |
|-------|------|------|
| gemma4:e4b (local) | none (default) | None — Ollama on 11439 |
| claude-haiku-4-5 | `--model claude-code/claude-haiku-4-5-20251001` | OAuth via `~/.claude/.credentials.json` (requires `claude login` once) |

Opus/Sonnet may be 429 rate-limited on Max subscription. Haiku is the
reliable cloud tier.

## Common Flags

```bash
--print                  # Non-interactive: print response to stdout and exit
--verbose                # Show agent header, tool labels, stats, trace events
--permission-mode dontAsk  # Auto-approve all tool calls (for benchmarking)
```

## Failure Modes and Fixes

### 1. "Model not found: ollama/gemma4:e4b. Default model also unavailable."

**Cause**: Ollama is not running on port 11439.

**Why it happens**: The Ollama process was spawned by serve with `.unref()`
(detached). If it crashes, serve doesn't know. An orphaned `ollama runner`
subprocess may survive but can't accept API requests — only the main Ollama
server listens on 11439.

**Fix**: Restart serve (it will re-start Ollama):

```bash
kill $(lsof -ti:11435) $(lsof -ti:11439) 2>/dev/null
./hlvm serve &
# Wait for aiReady:true in health endpoint
```

### 2. "Cannot read properties of undefined (reading 'type')"

**Cause**: Version mismatch between CLI binary and running serve process.

**Why it happens**: You are talking to a stale shared daemon that predates the
current binary build. Normal first-party usage now converges on one shared
runtime, so if you still see multiple runtime processes they are usually
leftovers from older behavior or explicitly isolated source-mode tests.

**Fix**: Kill the shared runtime and let `./hlvm ask` restart it:

```bash
kill $(lsof -ti:11435) $(lsof -ti:11439) 2>/dev/null
./hlvm ask --print --permission-mode dontAsk "what is 2+2?"
```

**Critical**: Do not use `deno run -A src/hlvm/cli/cli.ts ...` against the
shared daemon without `HLVM_REPL_PORT`. Source mode now refuses to auto-start
or replace the shared runtime unless you isolate it explicitly.

### 3. "Unauthorized" on port 11439

**Cause**: Stale Ollama process from a previous serve session with different
auth config. Port 11439 is the Ollama API — it normally has no auth layer.
If you see "Unauthorized", something unexpected is listening there.

**Fix**: Same as above — kill everything, restart clean.

### 4. Simple prompts work but agent loop fails

**Cause**: Usually a stale shared daemon, not a second fresh daemon. Restart
the shared runtime and retry through `./hlvm ask`.

## Verification Checklist

Before running benchmarks, confirm all three:

```bash
# 1. Shared runtime responds through the real user path
./hlvm ask --print --permission-mode dontAsk "What is 2+2?"
./hlvm ask --model claude-code/claude-haiku-4-5-20251001 --print --permission-mode dontAsk "What is 2+2?"

# 2. If debugging from source, use an isolated port
HLVM_REPL_PORT=19435 deno run -A src/hlvm/cli/cli.ts ask --print --permission-mode dontAsk "What is 2+2?"
```

## Topology Smoke

Use the opt-in live topology smoke when you need to prove the single-daemon
contract itself, not just that one prompt succeeded:

```bash
HLVM_E2E_RUNTIME_TOPOLOGY=1 \
HLVM_E2E_GUI_APP_PATH=/path/to/HLVM.app \
deno test --allow-all tests/e2e/runtime-topology-smoke.test.ts
```

What it asserts:

- starts from a clean machine state
- compiled `./hlvm ask` cold-starts one shared daemon on `11435`
- repeated compiled `ask` reuses that same daemon
- source-mode `deno run -A src/hlvm/cli/cli.ts ask` without `HLVM_REPL_PORT`
  fails fast and spawns nothing
- the rebuilt GUI app attaches to the same daemon and does not spawn its own
  bundled runtime

## Key Code Paths (for debugging)

| What | File | Key Lines |
|------|------|-----------|
| "Model not found" error | `src/hlvm/cli/repl/handlers/chat.ts` | ~516 |
| Ollama model lookup | `src/hlvm/providers/ollama/api.ts` | `getModel()` ~317-370 |
| AI runtime startup | `src/hlvm/runtime/ai-runtime.ts` | `startAIEngine()` ~724 |
| Default Ollama port | `src/common/config/types.ts` | `DEFAULT_OLLAMA_ENDPOINT` ~23 |
| Serve initialization | `src/hlvm/cli/commands/serve.ts` | `initializeRuntime()` ~98 |
