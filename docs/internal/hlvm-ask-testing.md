# Testing Models via `hlvm ask`

How to run prompts through the HLVM agent loop for benchmarking or
verification. This doc exists because multiple AI agents have wasted time
debugging connectivity issues that have a simple fix.

## TL;DR

```bash
# 1. Ensure exactly ONE serve process is running
ps aux | grep 'hlvm serve' | grep -v grep
# If zero or multiple: kill all, start fresh
kill $(lsof -ti:11435) $(lsof -ti:11439) 2>/dev/null
./hlvm serve &

# 2. Wait for AI runtime
for i in $(seq 1 30); do
  curl -s http://127.0.0.1:11435/health | grep -q '"aiReady":true' && break
  sleep 2
done

# 3. Test
./hlvm ask --print --permission-mode dontAsk "your prompt"                                    # gemma4 (default)
./hlvm ask --model claude-code/claude-haiku-4-5-20251001 --print --permission-mode dontAsk "your prompt"  # haiku
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

**Why it happens**: Two serve processes running simultaneously. The GUI app
(`/Users/seoksoonjang/dev/hql/hlvm serve`) may have started one, and you
started another. The CLI connects to whichever grabbed port 11435 first —
if that's the stale one, message serialization breaks because the protocol
changed between builds.

**Fix**: Kill ALL serve processes, verify only one remains:

```bash
# Kill everything on both ports
kill $(lsof -ti:11435) $(lsof -ti:11439) 2>/dev/null
# Also kill any orphaned ollama runners
ps aux | grep 'ollama runner' | grep -v grep | awk '{print $2}' | xargs kill 2>/dev/null
sleep 1
# Verify clean
lsof -ti:11435 && echo "STILL OCCUPIED" || echo "OK"
# Start fresh
./hlvm serve &
```

**Critical**: Always check `ps aux | grep 'hlvm serve'` BEFORE starting.
If you see TWO processes, kill both first.

### 3. "Unauthorized" on port 11439

**Cause**: Stale Ollama process from a previous serve session with different
auth config. Port 11439 is the Ollama API — it normally has no auth layer.
If you see "Unauthorized", something unexpected is listening there.

**Fix**: Same as above — kill everything, restart clean.

### 4. Simple prompts work but agent loop fails

**Cause**: Likely the two-serve-process problem (failure mode #2). Simple
prompts may route differently (fewer messages = less chance of hitting the
serialization mismatch). The agent loop sends 20-30+ messages with tool
calls/results, which exposes the version mismatch.

## Verification Checklist

Before running benchmarks, confirm all three:

```bash
# 1. Exactly one serve process
ps aux | grep 'hlvm serve' | grep -v grep | wc -l   # must be 1

# 2. Health check passes
curl -s http://127.0.0.1:11435/health | grep '"aiReady":true'   # must match

# 3. Both models respond through agent loop
./hlvm ask --print --permission-mode dontAsk "What is 2+2?"
./hlvm ask --model claude-code/claude-haiku-4-5-20251001 --print --permission-mode dontAsk "What is 2+2?"
```

## Key Code Paths (for debugging)

| What | File | Key Lines |
|------|------|-----------|
| "Model not found" error | `src/hlvm/cli/repl/handlers/chat.ts` | ~516 |
| Ollama model lookup | `src/hlvm/providers/ollama/api.ts` | `getModel()` ~317-370 |
| AI runtime startup | `src/hlvm/runtime/ai-runtime.ts` | `startAIEngine()` ~724 |
| Default Ollama port | `src/common/config/types.ts` | `DEFAULT_OLLAMA_ENDPOINT` ~23 |
| Serve initialization | `src/hlvm/cli/commands/serve.ts` | `initializeRuntime()` ~98 |
