# HLVM Memory System — SSOT

> Authoritative reference for HLVM's memory architecture. Read this first.
> Every other memory doc redirects here.
>
> Audience: a developer (or AI agent) who has never seen this code before.
> By the end you should know what every piece does, where it lives, and how
> to extend or debug it without spelunking.

**Status (last updated: this branch):** Memory is complete in **global-only**
form. Backend, write path, permission carve-out, picker, per-turn selector,
chat/agent/subagent injection, and live model recall are verified.

The live proof used `claude-code/claude-haiku-4-5-20251001` through the
Claude Code OAuth/Max path: a temporary `HLVM.md` contained
`MEMORY_LIVE_MARKER_VALUE = pineapple`, and `hlvm ask` answered `pineapple`.
Local `ollama/gemma4:e2b` timed out on that large memory/agent prompt; that is
a model/runtime limitation, not a memory-system blocker.

---

## TL;DR — what HLVM memory IS

A **markdown-file memory system** modeled on Claude Code's production memory,
adapted to HLVM's **global-only** architecture (see `docs/ARCHITECTURE.md`).

Two locations, both global, both under `~/.hlvm/`:

| Layer | Path | What it is |
|---|---|---|
| **User memory** | `~/.hlvm/HLVM.md` | User-authored notes, loaded every session |
| **Auto-memory** | `~/.hlvm/memory/MEMORY.md` + `~/.hlvm/memory/*.md` | Model-writable; per-turn selector picks ~5 relevant files |

That's it. Same in every directory you run `hlvm` from. **No `./HLVM.md`,
no per-project keying, no `~/.hlvm/projects/<key>/` subdirs.**

Plus:
- A **per-turn LLM selector** picks ~5 relevant topic files for each user message
- **Freshness warnings** ("47 days old, verify before asserting")
- **`@import` resolution** in HLVM.md content (depth-capped + root-validated)
- **`/memory` Ink picker** — 3 rows: User, Auto-memory MEMORY.md, Open folder
- **`Memory updated in <path>`** inline notification when the model writes
- **Permission carve-out** so `read_file`/`write_file`/`edit_file` can target memory paths
- **GUI editor overrides** (`code` → `code -w`, `subl` → `subl --wait`, etc.)
- No dedicated memory tools — model uses HLVM's standard file tools

What it is **not**: SQLite. FTS5. Entity graph. Per-project. Team-shared. The
old algorithm-heavy memory was deleted. CC's TEAMMEM/AUTODREAM/KAIROS/EXTRACT
features are out of scope (CC-experimental, gated, single-user systems
don't need them).

---

## Quick orientation: where to look first

| If you want to… | Read |
|---|---|
| Understand the model's view of memory | `src/hlvm/memory/memoryTypes.ts` — the prompt the agent sees |
| Trace a user query → memory injection | [End-to-end flow §1](#end-to-end-flow-1--user-message-to-memory-injection) |
| Trace a model write → notification | [End-to-end flow §2](#end-to-end-flow-2--model-writes-memory) |
| Understand `/memory` UX | [End-to-end flow §3](#end-to-end-flow-3--user-types-memory) |
| Add a new test | `tests/unit/memory/` ([test inventory](#test-inventory)) |
| Find non-blocking follow-ups | [Non-blocking follow-ups](#non-blocking-follow-ups) |
| Debug a permission denial | [Permission model](#permission-model) |

---

## Code layout (every memory file, in dependency order)

### `src/hlvm/memory/` — the new memory module

| File | Purpose | Key exports |
|---|---|---|
| `memoryTypes.ts` | Prompt sections + 4-type taxonomy (`user`/`feedback`/`project`/`reference`) | `TYPES_SECTION`, `WHAT_NOT_TO_SAVE_SECTION`, `WHEN_TO_ACCESS_SECTION`, `TRUSTING_RECALL_SECTION`, `MEMORY_FRONTMATTER_EXAMPLE`, `parseMemoryType` |
| `memoryAge.ts` | Freshness math + system-reminder wrapping | `memoryAgeDays`, `memoryAge`, `memoryFreshnessText`, `memoryFreshnessNote` |
| `paths.ts` | All memory file paths (no cwd args; global-only) | `getUserMemoryPath`, `getAutoMemPath`, `getAutoMemEntrypoint`, `isAutoMemPath`, `isAutoMemoryEnabled` |
| `memoryScan.ts` | Recursive `**/*.md` scan + frontmatter extraction | `scanMemoryFiles`, `formatMemoryManifest`, type `MemoryHeader` |
| `findRelevantMemories.ts` | Per-turn LLM selector via `classifyJson()` | `findRelevantMemories`, type `RelevantMemory` |
| `memdir.ts` | Orchestration centerpiece — `loadMemoryPrompt`, `@import` resolution, MEMORY.md cap | `loadMemoryPrompt`, `loadMemorySystemMessage`, `isMemorySystemMessage`, `truncateEntrypointContent`, `MAX_ENTRYPOINT_LINES`, `MAX_ENTRYPOINT_BYTES`, `ENTRYPOINT_NAME` |

**Note:** `getProjectMemoryPath`, `findCanonicalGitRoot`, `sanitizeProjectKey`,
`buildProjectMemorySection` were **deleted** — HLVM is global-only. If you
see references in older docs, they no longer exist.

### Helpers outside `src/hlvm/memory/`

| File | Role |
|---|---|
| `src/hlvm/runtime/local-llm.ts` | Exports `classifyJson()` (used by selector). Internally delegates to private `collectClassificationJson()` which routes through `resolveLocalFallbackModelId()` — no model name hardcoded |
| `src/common/sanitize.ts` | `sanitizeSensitiveContent` PII helper (moved here from the deleted memory module) |
| `src/common/paths.ts` | `getHlvmDir`, `getHlvmInstructionsPath` — used by memory paths |
| `src/hlvm/agent/path-utils.ts` | `resolveToolPath` permission carve-out for `read_file`/`write_file`/`edit_file` |

### UI / CLI

| File | Role |
|---|---|
| `src/hlvm/cli/repl-ink/components/MemoryPickerOverlay.tsx` | The `/memory` Ink overlay (3 rows: User memory, Auto-memory MEMORY.md, Open auto-memory folder) |
| `src/hlvm/cli/repl-ink/components/conversation/MemoryUpdateNotification.tsx` | Inline `Memory updated in <path> · /memory to edit` |
| `src/hlvm/cli/repl-ink/hooks/useOverlayPanel.ts` | `OverlayPanel` union including `"memory-picker"` |
| `src/hlvm/cli/repl/commands.ts` | Slash command registration; `/memory` dispatches to overlay (Ink) or text handler (non-Ink) |
| `src/hlvm/cli/repl/commands-memory.ts` | Text-mode `/memory <user\|auto>` fallback for non-Ink callers |
| `src/hlvm/cli/repl/edit-in-editor.ts` | `editFileInEditor` — spawns `$VISUAL → $EDITOR → vi` with GUI editor wait-flag injection |
| `src/hlvm/cli/repl/helpers.ts` | HQL `(memory)` REPL helper — opens `~/.hlvm/HLVM.md` in editor |

### Orchestrator integration

| File | Role |
|---|---|
| `src/hlvm/agent/orchestrator.ts` | Per-turn `maybeInjectRelevantMemories` (called after first user message); pre-compaction nudge text |
| `src/hlvm/agent/orchestrator-state.ts` | `LoopState.surfacedMemoryPaths: Set<string>` — de-dup across iterations |
| `src/hlvm/agent/session.ts` | `injectMemoryPromptContext` — calls `loadMemorySystemMessage` at session create + reuse |
| `src/hlvm/agent/tools/run-agent.ts` | Subagent path also uses `loadMemorySystemMessage` |
| `src/hlvm/cli/repl/handlers/chat-context.ts` | Chat-mode reuses `loadMemorySystemMessage` for replay |

---

## End-to-end flow §1 — user message to memory injection

```
user: "what should I write here?"
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│ orchestrator.runReActLoop                                         │
│  1. addContextMessage(user message)                                │
│  2. if (autoMemoryRecall) {                                        │
│       maybeInjectRelevantMemories(state, userRequest, config)     │ ← per-turn selector
│     }                                                              │
└──────────────────────────────────────────────────────────────────┘
                                   │
        ┌──────────────────────────┴──────────────────────────┐
        ▼                                                       ▼
session.ts (already done at session creation)              maybeInjectRelevantMemories
loadMemorySystemMessage()                                  (orchestrator.ts)
        │                                                       │
        ▼                                                       │
┌────────────────────────────────────────┐                    │
│ memdir.ts loadMemoryPrompt()            │                    │
│  ├─ buildUserMemorySection             │                    │
│  │   ├─ readTextFileOrEmpty(~/.hlvm/HLVM.md)                │
│  │   └─ resolveAtImports (allowed: ~/.hlvm)                 │
│  └─ buildAutoMemorySection             │                    │
│      ├─ buildMemoryLines (4-type taxonomy + write rules)    │
│      └─ truncate ~/.hlvm/memory/MEMORY.md to 200 lines / 25KB │
│  Returns one combined system message                        │
└────────────────────────────────────────┘                    │
                                                                ▼
                                        ┌───────────────────────────────────┐
                                        │ findRelevantMemories(userRequest, │
                                        │   ~/.hlvm/memory/, signal,        │
                                        │   recentTools,                    │
                                        │   state.surfacedMemoryPaths)      │
                                        │   ├─ scanMemoryFiles (recursive)  │
                                        │   ├─ filter alreadySurfaced       │
                                        │   ├─ classifyJson (local LLM)     │
                                        │   └─ return ≤5 picks              │
                                        └───────────────────────────────────┘
                                                                │
                                                                ▼
                                        For each pick:
                                          - read content (cap 4KB)
                                          - prepend memoryFreshnessNote
                                          - addContextMessage(role="system",
                                              content="<system-reminder><memory path=...>...</memory></system-reminder>")
                                          - state.surfacedMemoryPaths.add(path)
```

**Test stub for determinism:** set `HLVM_MEMORY_SELECTOR_STUB=<path-to-json>`
where the JSON contains `{ "selected": ["filename1.md", ...] }`. The selector
reads picks from this file instead of calling the local LLM.

## End-to-end flow §2 — model writes memory

```
agent decides to remember a fact
       │
       ▼
agent issues tool call: write_file({ path: "~/.hlvm/HLVM.md", content: "..." })
       │
       ▼
file-tools.ts writeFile()
       └─ resolveToolPath(path, workspace)   ← src/hlvm/agent/path-utils.ts
              ├─ getMemoryAllowedRoots()
              │   ├─ getUserMemoryPath()              (~/.hlvm/HLVM.md)
              │   └─ getAutoMemPath()                  (~/.hlvm/memory/)
              ├─ validatePath() — workspace + skills + memory roots
              └─ post-check: under auto-memory dir → must be `.md`
       │
       ▼ (allowed)
write succeeds
       │
       ▼
orchestrator-tool-execution.ts
   buildMemoryUpdatedEvent(toolCall, result)
   └─ if path matches isMemoryPath → emit AgentUIEvent { type: "memory_updated", path, ts }
       │
       ▼
agent-transcript-state reduces event into MemoryUpdatedItem
       │
       ▼
MemoryUpdateNotification renders inline:
   ┌─────────────────────────────────────────────────┐
   │ Memory updated in ~/.hlvm/HLVM.md · /memory to edit │
   └─────────────────────────────────────────────────┘
```

## End-to-end flow §3 — user types `/memory`

```
user types "/memory" in REPL
       │
       ▼
App.tsx slash dispatch (around line 1056)
   ├─ parse arg ("user"/"auto"/"u"/"a"/"m" or none)
   ├─ setMemoryPickerInitial(arg)
   └─ setActiveOverlay("memory-picker")
       │
       ▼
MemoryPickerOverlay renders:
   ┌─ Memory ───────── Auto-memory: on ┐
   │ › User memory             ~/.hlvm/HLVM.md           │
   │   Auto-memory MEMORY.md   ~/.hlvm/memory/MEMORY.md  │
   │   Open auto-memory folder ~/.hlvm/memory/           │
   └──────────────────────────────────────────────────────┘
       │
       ▼
user presses Enter on "User memory"
       │
       ▼
MemoryPickerOverlay onSelect:
   ├─ onClose() → setActiveOverlay("none")
   └─ if action === "edit":
        editFileInEditorWithInkPause(app, path)
           └─ editFileInEditor(path)  ← Ink stays mounted (real pause is TODO)
                └─ resolveEditor() → optionally adds "-w" / "--wait" for GUI editors
                └─ platform.command.run({ cmd: ["vim", path], stdin/stdout/stderr: "inherit" }).status
   └─ if action === "open-folder":
        ensureDir(path)
        getPlatform().openUrl(path)   ← OS file manager / Finder / Explorer
       │
       ▼
editor exits → terminal restores Ink's prior render
   (note: Ink's render loop kept running while editor was up;
    visual glitches possible but REPL survives)
```

---

## Permission model

Implemented in `src/hlvm/agent/path-utils.ts:resolveToolPath`. Order of evaluation:

1. **Lexical traversal** containing `..` → DENY
2. **Symlink crossing carve-out boundary** (resolved by `validatePath` in `path-sandbox.ts`) → DENY
3. **Workspace** (current cwd) → ALLOW
4. **`getUserSkillsDir()` / `getBundledSkillsDir()`** → ALLOW (pre-existing carve-outs)
5. **`getUserMemoryPath()`** (exact: `~/.hlvm/HLVM.md`) → ALLOW
6. **`getAutoMemPath()`** (`~/.hlvm/memory/`) → ALLOW for `.md` only
7. **Anything else** under `~/.hlvm/` → DENY (e.g. `~/.hlvm/secret.txt`, `~/.hlvm/projects/<old-key>/`)
8. **Outside workspace + carve-outs** → DENY

The 9-case smoke at `/tmp/test-permissions.ts` verifies all of these. Also
covered by `tests/unit/memory/e2e-comprehensive.test.ts` Section C.

---

## `@import` resolution

Implemented in `memdir.ts:resolveAtImports`. Activated when HLVM.md content
contains a line that matches `^\s*@(.+\.md)\s*$`.

| Property | Value |
|---|---|
| Syntax | `@./relative/path.md` or `@/abs/path.md` |
| Depth cap | 5 (then replaced with `<!-- @import skipped: depth cap reached -->`) |
| Cycle detection | Per-import `seen: Set<string>` of absolute paths |
| Allowed roots | `~/.hlvm` only (HLVM is global-only) |
| Outside roots | Replaced with `<!-- @import skipped: outside allowed roots -->` |
| Non-`.md` extension | Replaced with `<!-- @import skipped: non-.md target -->` |
| Missing file | Replaced with `<!-- @import skipped: not found -->` |

Tests: `tests/unit/memory/import-resolution.test.ts` (8 tests).

---

## Test inventory

`tests/unit/memory/` — 85 tests across 6 suites, all passing.

| Suite | Tests | Coverage |
|---|---|---|
| `cc-port.test.ts` | 15 | Core scenarios: HLVM.md+MEMORY.md, freshness, scan caps, predicate |
| `e2e-comprehensive.test.ts` | 43 | User journeys, edge cases, security, performance, concurrency, CC parity, prompt budget |
| `import-resolution.test.ts` | 8 | `@import` depth, cycles, missing/non-md/cross-root denials, leading-whitespace |
| `per-turn-recall.test.ts` | 6 | Selector module — stub picks, dedup, capping, failure modes |
| `picker-behavior.test.ts` | 8 | `editFileInEditor` precedence, GUI overrides, picker contract, status row |
| `orchestrator-recall.test.ts` | 5 | `maybeInjectRelevantMemories` integration — message shape, dedup, fail-soft |

Plus `tests/unit/agent/global-instructions.test.ts` (2 tests) for the
consolidated user HLVM.md injection path.

**Stubbing pattern**: `HLVM_MEMORY_SELECTOR_STUB=<json-file-path>` makes the
selector deterministic. Production never sets this var.

**Run all memory tests**:
```sh
deno test --allow-all tests/unit/memory/
```

**Historical smoke scripts** (ad hoc, not source-controlled):
```sh
deno run --allow-read --allow-env --allow-write=$HOME/.hlvm /tmp/test-loadprompt.ts
deno run --allow-read --allow-env --allow-write=$HOME/.hlvm /tmp/test-write-roundtrip.ts
deno run --allow-read --allow-env --allow-write=$HOME/.hlvm /tmp/test-permissions.ts
```

They were used on this branch to verify real-disk loading, write→scan→load,
and permission boundaries. Inspect or recreate them before rerunning. Prefer
`HLVM_TEST_STATE_ROOT=<tmpdir> HLVM_ALLOW_TEST_STATE_ROOT=1` for repeatable
smokes unless you intentionally want to touch live `~/.hlvm`.

**Current verification matrix**:

| Scenario | Status | Evidence |
|---|---|---|
| User memory loads from disk | verified | `loadMemorySystemMessage()` real-disk smoke + unit tests |
| Auto-memory `MEMORY.md` and topic files load | verified | write→scan→load smoke + `tests/unit/memory/` |
| `@import` from `HLVM.md` resolves safely | verified | `tests/unit/memory/import-resolution.test.ts` |
| Per-turn topic recall injects relevant files | verified | selector stub tests + orchestrator recall tests |
| Model writes to memory path trigger notification | verified | source smoke + `isMemoryPath()` regression tests |
| Permission carve-out is global-only and `.md`-only | verified | 9-case smoke + unit tests |
| `/memory` picker opens and returns to REPL | verified | PTY smoke: `/memory` → arrows → Enter → editor → return → `/memory auto` |
| Plain chat receives memory | verified | source-level provider-message smoke |
| Agent sessions receive memory | verified | memory/global agent tests |
| Subagents receive global `HLVM.md` | verified | `tests/unit/agent/agent-integration.test.ts` focused test |
| Live model answers from memory | verified | Haiku 4.5 live smoke answered `pineapple` from injected `HLVM.md` |

---

## CC parity status

```
                  CC MEMORY PARITY
┌──────────────────────────────┬──────────────┐
│ User-level memory             │ █████████░   │ ~/.hlvm/HLVM.md (vs ~/.claude/CLAUDE.md)
│ Project memory                │ N/A          │ HLVM is global-only by design
│ Auto-memory dir + MEMORY.md   │ █████████░   │ ~/.hlvm/memory/ (single global, not per-project)
│ Topic files                   │ █████████░   │ same shape
│ 4-type taxonomy               │ █████████░   │ user/feedback/project/reference
│ Memory write permissions      │ █████████░   │ carve-out + .md-only restriction
│ Inline update notification    │ ██████████   │ "Memory updated in <path>"
│ /memory interactive picker    │ █████████░   │ 3 rows (CC has more for team/agent — gated)
│ Ink editor handoff            │ ██████░░░░   │ survives but no proper pause/resume
│ GUI editor wait-flag injection│ █████████░   │ code -w / subl --wait / etc.
│ @import resolution            │ █████████░   │ depth=5 + cycles + ~/.hlvm root limit
│ Per-turn relevant memories    │ █████████░   │ wired in orchestrator after user message
│ Freshness warnings            │ █████████░   │ 1+ day old → system-reminder
│ TEAMMEM / AUTODREAM / KAIROS  │ N/A          │ CC-experimental, gated, not applicable
└──────────────────────────────┴──────────────┘
```

**Sub-10/10 deviations are intentional or cosmetic:**
- `HLVM.md` instead of `CLAUDE.md` (HLVM convention)
- `~/.hlvm/memory/` (global) instead of `~/.claude/projects/<key>/memory/` (per-project) — by design
- Local LLM selector via `classifyJson` instead of CC's Sonnet 3.5
- Ink editor handoff: REPL survives but render-loop keeps firing during edit
- 3 picker rows instead of CC's full set (team/agent rows are CC-experimental)

---

## Non-blocking follow-ups

These are not memory-completion blockers; they are polish or runtime/model
quality items.

| # | Follow-up | Severity | Pointer |
|---|---|---|---|
| 1 | **Real Ink pause/resume during editor spawn.** Currently Ink stays mounted while vim takes the alt-screen — REPL survives, but visual glitches possible. CC's pattern (`commands/memory/memory.tsx:42` + `utils/promptEditor.ts`) cleanly hands off the alt-screen using `inkInstance.enterAlternateScreen()`. The fork at `src/hlvm/vendor/ink/` exposes the same API. | medium | `src/hlvm/cli/repl/edit-in-editor.ts:editFileInEditorWithInkPause` |
| 2 | **Real vim/nano alt-screen polish.** PTY smoke passed with a controlled editor probe (`hlvm repl --port 11440 --no-banner → /memory → ↑↓ → Enter → editor exits → REPL alive → /memory auto works`). A real terminal editor smoke is useful for visual polish, not for memory correctness. | low | (manual) |
| 3 | **Post-editor "Opened memory file at..." line not emitted in Ink path.** `MemoryPickerOverlay` accepts `onEditorExit` callback but App.tsx doesn't pass one. Text-mode fallback emits the line. | low | `src/hlvm/cli/repl-ink/components/App.tsx` (where overlay is rendered) |
| 4 | **Per-turn recall is awaited inline.** Adds local-classifier latency (~500ms typical) to first turn. Future optimization: async-prefetch at session-creation. | low | `src/hlvm/agent/orchestrator.ts:maybeInjectRelevantMemories` |
| 5 | **`recentTools` array is always empty in selector calls.** CC threads tool-use history into the selector to filter out reference docs for actively-used tools. | low | `src/hlvm/agent/orchestrator.ts:maybeInjectRelevantMemories` |
| 6 | **Local Gemma performance on full memory/agent prompt.** `ollama/gemma4:e2b` answered a tiny prompt but timed out on the live memory proof. Haiku 4.5 proved memory recall; Gemma prompt latency is a model/runtime issue. | low | routing/runtime |

---

## How to extend / debug

### "Memory isn't loading"
1. Run focused load tests: `deno test --allow-all tests/unit/memory/cc-port.test.ts tests/unit/agent/global-instructions.test.ts`
2. Check `~/.hlvm/HLVM.md` exists and has content. `cat ~/.hlvm/HLVM.md`.
3. Check auto-memory dir exists: `ls ~/.hlvm/memory/`
4. If `HLVM_DISABLE_AUTO_MEMORY=1` is set, the auto-memory section is skipped (but user HLVM.md still loads).

### "Model can't write to memory path"
1. Path must end with `.md` (auto-memory dir requires `.md` extension).
2. Path must be exactly `~/.hlvm/HLVM.md`, OR under `~/.hlvm/memory/` (with `.md` extension).
3. Anything else under `~/.hlvm/` is denied.
4. Symlinks crossing the carve-out boundary are denied.

### "Selector picks unrelated files"
- Check `tests/unit/memory/per-turn-recall.test.ts` for the selector contract.
- Set `HLVM_MEMORY_SELECTOR_STUB=<path>` to force specific picks during testing.
- The local LLM is gemma4 by default — selector quality is structurally lower than CC's Sonnet 3.5.

### "Adding a new memory feature"
1. Read `src/hlvm/memory/memdir.ts` — most prompt-shape decisions live here.
2. If it's a frontmatter field: extend `parseFrontmatter` use in `memoryScan.ts`.
3. If it's a new prompt section: add to `memoryTypes.ts` constants, then include in `buildMemoryLines`.
4. If it's a new `@import` syntax: extend the regex in `resolveAtImports`.
5. Add tests to `e2e-comprehensive.test.ts` or a new file under `tests/unit/memory/`.

### "Adding a new picker row"
1. Edit `MemoryPickerOverlay.tsx:buildRows` — add a new `MemoryRow` with `key`, `action` (`"edit"` or `"open-folder"`), `label`, `path`, `description`.
2. If `action === "edit"`: file gets opened via `editFileInEditorWithInkPause`.
3. If `action === "open-folder"`: dir gets opened via `getPlatform().openUrl()`.
4. Add a number-key shortcut in the keyboard handler.
5. Add a test in `picker-behavior.test.ts`.

---

## Glossary

- **HLVM.md** — the user-facing memory markdown file (parallels CC's `CLAUDE.md`)
- **MEMORY.md** — the auto-memory index file inside `~/.hlvm/memory/`
- **Topic file** — any `*.md` file in `~/.hlvm/memory/` (e.g. `feedback_tabs.md`)
- **Auto-memory** — the markdown directory the model can write to autonomously
- **Selector** — the per-turn LLM call that picks which topic files to inject
- **Permission carve-out** — paths the model can read/write that fall outside the workspace boundary
- **Freshness note** — system-reminder text injected for memories older than 1 day
- **`@import`** — line-level inclusion directive in HLVM.md content
- **`classifyJson`** — exported wrapper at `src/hlvm/runtime/local-llm.ts` for local-LLM JSON classifier calls
- **CC** — Claude Code (the reference implementation we ported from)
- **CC-experimental features** — `TEAMMEM`, `KAIROS`, `AUTODREAM`, `EXTRACT_MEMORIES`, `MEMORY_SHAPE_TELEMETRY` — all out of scope (single-user system doesn't need them)
- **Global-only** — HLVM's design choice: no project-based memory. See `docs/ARCHITECTURE.md`.

---

## Deleted systems

The pre-port HLVM memory system used SQLite + FTS5 + entity graph. It is
**gone**. References:
- 14 files deleted from `src/hlvm/memory/` (db.ts, facts.ts, entities.ts, retrieve.ts, invalidate.ts, manager.ts, mod.ts, pipeline.ts, policy.ts, recall.ts, store.ts, tools.ts, extract.ts, explicit.ts)
- `memory_write` / `memory_search` / `memory_edit` tools removed from registry
- `MemoryActivityLine.tsx` UI deleted
- `~/.hlvm/memory/memory.db` is no longer read or written
- `src/hlvm/api/memory.ts` HTTP endpoint deleted
- `(remember "text")` HQL helper deleted (parallel direct-write would duplicate logic)

The `(memory)` HQL helper was rewired: it now opens `~/.hlvm/HLVM.md` in
`$EDITOR` (CC `/memory` parity at the REPL helper level).

The **project-based memory concept was also eliminated** in a later cleanup
(see git history for `getProjectMemoryPath`, `findCanonicalGitRoot`,
`sanitizeProjectKey`). HLVM is global-only.

---

## Plan reference

The full implementation plan with every decision, revision history, and
rationale is at:

```
~/.claude/plans/don-t-do-hard-code-mossy-gem.md
```

Read it if you need the "why" behind any decision in this doc. Read this doc
if you need the "what" and "where."
