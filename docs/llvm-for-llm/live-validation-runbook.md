# Live Validation Runbook

This runbook is for release-confidence checks that go beyond the default
deterministic gate. It focuses on real runtime behavior, not feature
documentation.

## Setup

- Pick one active model per provider family you care about and export it as
  `HLVM_LIVE_AGENT_MODEL` before each run.
- Ensure the provider-specific credentials or auth flows for that model are
  already working.
- Use a clean `HLVM_DIR` when collecting artifacts so the transcript and hook
  output are easy to attribute to the run.

## Scenarios

### 1. Long-answer continuation

Prompt:

```text
Begin exactly with RESILIENCE-CONTINUATION-HEADER on its own line.
Then output a numbered list with the format `N. fruit-N` for as many lines as you can.
Do not call any tools. Do not add a preamble or closing sentence.
```

Pass:

- the final answer contains `RESILIENCE-CONTINUATION-HEADER` exactly once
- the final turn stats show `continuedThisTurn=true`
- the final turn stats show `continuationCount>=1`
- there is no duplicated prefix or obvious restart in the final text

Capture:

- final transcript excerpt
- turn stats line
- any continuation-related hook payloads

### 2. Proactive compaction under growing context

Seed the session with several long user/assistant messages, then ask:

```text
Reply with exactly RESILIENCE-COMPACTION-OK. Do not call any tools.
```

Use a small `context_window` so the next model call crosses urgent pressure.

Pass:

- the answer still completes successfully
- `compactionReason=proactive_pressure`
- the transcript or hook payload shows a compaction notice before the next
  model call
- the run does not fall back to `overflow_retry` unless the proactive path was
  insufficient

Capture:

- transcript excerpt around the compaction notice
- `turn_stats` payload
- any `context_compaction` trace or hook records

### 3. Repeated self-started local host runs

Run several back-to-back local `hlvm ask` turns with the same runtime host
pattern, including at least one write/verify turn and one read-heavy turn.

Pass:

- no `[HLVM5009]` or broken-body transport errors
- the host shuts down cleanly between self-started runs
- later runs do not inherit stale lifecycle state from earlier runs

Capture:

- runtime-host diagnostics block when present
- failing stdout/stderr if any transport issue occurs

### 4. Adversarial shell corpus

Review at least these command families:

- invisible or Unicode whitespace around otherwise safe commands
- shell trampolines like `bash -c`
- command/process substitution
- heredoc / here-string / multiline script bodies
- executor indirection such as `find -exec` or `xargs`
- remote install patterns such as `curl | sh`

Pass:

- normalized safe commands still succeed or remain `L0/L1`
- risky commands are escalated or blocked consistently
- no command bypasses classification because of invisible characters

Capture:

- command under test
- observed permission/safety outcome
- tool result summary or error text

## Status Labels

Use these labels when reporting confidence:

- `deterministic automated`: green in the default targeted gate
- `opt-in live`: green in env-gated live smoke tests
- `manual soak`: verified by following this runbook on real providers/runtime

Do not collapse these categories into a single “validated” claim.
