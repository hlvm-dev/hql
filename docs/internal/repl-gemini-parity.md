# REPL Gemini Parity Map (Migration SSOT)

This document is the migration source of truth for Gemini-inspired REPL UI behavior.

## Pattern Mapping

| Gemini Pattern | HLVM Target | Status |
|---|---|---|
| Streaming state FSM (`Idle/Responding/WaitingForConfirmation`) | `src/hlvm/cli/repl-ink/hooks/useConversation.ts` + `App.tsx` + `FooterHint.tsx` | Implemented |
| Static history + pending turn split | `src/hlvm/cli/repl-ink/components/ConversationPanel.tsx` | Implemented |
| React markdown block + inline renderer | `src/hlvm/cli/repl-ink/components/markdown/*` + `AssistantMessage.tsx` | Implemented |
| 3-section footer (workspace/state/model) | `src/hlvm/cli/repl-ink/components/FooterHint.tsx` | Implemented |
| Prompt-first startup IA | `Banner.tsx` + `/help` | Implemented |
| Deterministic Tab toggle completion | `Input.tsx` + completion navigation/lookup modules | Implemented |
| Mention + attachment end-to-end payload wiring | `Input.tsx` + `App.tsx` + `agent/*` + `providers/sdk-runtime.ts` | Implemented |

## Intentional Deviations

1. HLVM keeps HQL-specific paredit and placeholder editing semantics.
2. HLVM keeps non-conversation ANSI markdown rendering for non-React output surfaces.
3. HLVM keeps viewport-aware pending/static split in `ConversationPanel` instead of a strict Ink `<Static>`-only split.
4. Provider/model capability mismatch emits explicit errors rather than silent fallback.

## Acceptance Guardrails

1. No dual runtime state sources for conversation streaming.
2. No duplicated markdown engines on the same surface.
3. No new CLI flags introduced by parity migration.
4. Startup must remain compact and prompt-first.
