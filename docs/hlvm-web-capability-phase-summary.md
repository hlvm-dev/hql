# HLVM Provider Execution Plan Summary

State captured on 2026-03-22.

This is the current fresh-agent handoff for the provider-native web and remote
execution work.

## Goal

Replace scattered raw tool-name branching with one session-resolved execution
plan that decides, per capability and provider:

- whether HLVM exposes a custom tool
- whether HLVM exposes a provider-native tool
- whether the capability is disabled entirely

Public HLVM tool names remain canonical:

- `web_search`
- `web_fetch`
- `fetch_url`
- `remote_code_execute`

`compute` remains separate and must not be treated as remote code execution.

## Current Architecture

The SSOT is now a session-scoped `ResolvedProviderExecutionPlan`.

```text
                    +----------------------------------+
                    | ResolvedProviderExecutionPlan    |
                    | routingProfile: conservative     |
                    +----------------------------------+
                       |                  |
                       |                  |
                       v                  v
           +--------------------+   +----------------------+
           | web capability     |   | remote code          |
           | sub-plan           |   | execution capability |
           +--------------------+   +----------------------+
                       |                  |
   ---------------------------------------------------------------
   |              |                |              |               |
   v              v                v              v               v
prompt        SDK injection     tool_search    grounding       citations
```

This outer plan is now threaded through:

- session creation
- prompt generation
- SDK tool injection
- tool-search projection
- orchestrator execution wiring
- final-response citation preference

The older `webCapabilityPlan` still exists as the nested web sub-plan for
compatibility, but the outer provider execution plan is the new top-level SSOT.

## Capability Model

Logical capabilities:

- `web_search`
- `web_page_read`
- `raw_url_fetch`
- `remote_code_execution`

Conservative routing rules:

- Prefer native `web_search` when the provider supports it.
- Keep `fetch_url` custom.
- Keep `web_fetch` custom by default.
- Allow native `web_fetch` only on the dedicated conservative surface:
  `toolAllowlist === ["web_fetch"]`
- Never surface `remote_code_execute` unless it is explicitly allowlisted and
  the provider advertises native support.

## Current Provider Behavior

```text
Provider      web_search     web_fetch        fetch_url      remote_code_execute
-----------   ------------   --------------   -----------    -------------------
OpenAI        native         custom           custom         disabled
Anthropic     native         custom           custom         explicit native
Claude Code   native         custom           custom         explicit native
Google        native         dedicated native custom         explicit native
Ollama        custom         custom           custom         disabled
```

Important nuance for Google page-read:

- the SDK exposes `urlContext`
- HLVM only activates it for the explicit dedicated `web_fetch` surface
- mixed surfaces stay on custom `web_fetch`

That conservative rule exists because session-scoped planning cannot inspect
future tool arguments, and HLVM does not treat provider `urlContext` as a full
semantic replacement for batch fetches, raw reads, or shaped fetches.

## What Is Implemented

1. `ResolvedProviderExecutionPlan` now wraps:
   - the existing web capability plan
   - remote code execution state
   - the fixed internal routing profile `conservative`
2. Google native search is active through the same provider adapter boundary as
   OpenAI and Anthropic.
3. Native provider discovery now covers:
   - web search
   - native page read (`urlContext` on Google)
   - remote code execution
4. SDK tool merging uses the resolved execution plan instead of search-only
   assumptions.
5. Provider-executed native tool calls are filtered out of local execution for:
   - `web_search`
   - conservative native `web_fetch`
   - `remote_code_execute`
6. Prompt/tool-search projection now respects the outer execution plan,
   including remote code surfacing.
7. `remote_code_execute` exists as an explicit public tool stub in the registry,
   but it is only exposed when the resolved execution plan activates a
   provider-native version.
8. Prompt guidance now explains:
   - native search behavior
   - conservative native page-read behavior
   - remote code execution constraints

## Validation Status

Scoped validation that was actually run:

- targeted unit tests passed:
  - `tests/unit/agent/tool-capabilities.test.ts`
  - `tests/unit/agent/engine-sdk.test.ts`
  - `tests/unit/agent/agent-runner-engine.test.ts`
  - `tests/unit/agent/llm-integration.test.ts`
  - `tests/unit/agent/grounding.test.ts`
  - `tests/unit/agent/citation-spans.test.ts`
  - `tests/unit/agent/orchestrator-response.test.ts`
- `deno task ssot:check` passed
- new E2E smoke files type-check with `deno test --no-run`

Live provider E2E that already existed and remains relevant:

- `tests/e2e/native-web-search-smoke.test.ts`

New live smoke coverage added in this phase:

- `tests/e2e/native-google-web-search-smoke.test.ts`
- `tests/e2e/native-web-page-read-smoke.test.ts`
- `tests/e2e/native-remote-code-smoke.test.ts`

Current gate behavior for the new live smokes:

- `native-google-web-search-smoke` runs only when `GOOGLE_API_KEY` is set
- `native-web-page-read-smoke` additionally requires `HLVM_E2E_NATIVE_PAGE_READ`
- `native-remote-code-smoke` additionally requires `HLVM_E2E_NATIVE_REMOTE_CODE`

Those env vars were not present during this session, so the new live Google
smokes were added and type-checked but not executed.

Per repository policy, the full `deno task test:unit` suite has not been run in
this phase because it must remain the final step and requires explicit approval.

## Critical Invariants

Do not break these:

1. `compute` is not `remote_code_execute`.
2. `web_fetch` is not `fetch_url`.
3. `search_web` and `web_search` are one logical search capability.
4. Provider-executed native tools must not be sent back through local tool
   execution.
5. Do not add a second routing SSOT in `query-tool-routing.ts`.
6. Do not expose `remote_code_execute` by default.
7. Do not widen native page-read beyond the dedicated conservative surface
   unless semantic parity is explicitly proven.

## Files To Read First

- `src/hlvm/agent/tool-capabilities.ts`
- `src/hlvm/agent/session.ts`
- `src/hlvm/agent/engine-sdk.ts`
- `src/hlvm/agent/llm-integration.ts`
- `src/hlvm/agent/orchestrator-tool-execution.ts`
- `src/hlvm/providers/native-web-tools.ts`
- `src/hlvm/providers/sdk-runtime.ts`

## Remaining Boundary

What is still intentionally not done:

- no full `deno task test:unit` run yet
- no user-facing policy/cost routing modes
- no broad semantic expansion of native page-read beyond the conservative gate
- no default remote-code exposure
