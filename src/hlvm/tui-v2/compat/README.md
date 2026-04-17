# TUI v2 compat layer

This directory is the boundary between CC donor TUI code (engine, shell
primitives, transplanted components) and HLVM-native business logic (agent
runtime, REPL evaluation, model/config state, slash commands).

The doc (`docs/vision/repl-v2-tui.md` §6.4) names 7 domains. Each has a
sibling file here that documents the interface and stubs the implementation.
Fill in these files as CC slices are transplanted — do NOT call HLVM runtime
code directly from components inside `src/hlvm/tui-v2/transcript/`,
`src/hlvm/tui-v2/prompt/`, etc.; route through this directory.

Current status: SCAFFOLD ONLY. Each file defines the interface and exports
a placeholder implementation. The production wiring (in `TranscriptWorkbench`
and `PromptInput`) still reaches into `src/hlvm/cli/repl-ink/` directly for
`useConversation`, `useAttachments`, etc. Those call-sites are the follow-up
work that this layer unblocks — moving them behind the adapters here lets us
delete the `src/hlvm/cli/repl-ink/` reach-through when the port is done.

Files:
- `app-state.ts` — shell-level state adapter (current mode, focus, dialog
  stack, fullscreen flag).
- `runtime.ts` — submit / stream adapter (abort, model label, streaming
  state, runtime host lifecycle).
- `transcript.ts` — transcript normalization adapter (AgentUIEvent → row
  data shape the v2 renderer expects).
- `permission.ts` — permission-mode adapter (currently tracks UI state
  only; future: gate actual tool calls when plan / accept-edits active).
- `model-status.ts` — model / status-line adapter (active model id,
  context window, effort level, status hints).
- `history-input.ts` — history / input adapter (prompt history, history
  search state, queue state).
- `stubs.ts` — no-op replacements for Anthropic-only concerns (CC-only
  analytics, auth banners, growthbook flags).
