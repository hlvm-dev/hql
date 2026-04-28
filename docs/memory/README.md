# HLVM Memory System — SSOT

> Authoritative reference for HLVM's memory architecture. Read this first.
> Every other memory doc redirects here.
>
> Audience: a developer (or AI agent) who has never seen this code before.
> By the end you should know what every piece does, where it lives, and how
> to extend or debug it without spelunking.

**Status (last updated: this branch):** Production memory backend complete and
verified. TUI picker complete. Editor lifecycle "REPL survives" (not full
CC-style alt-screen pause/resume). Manual smoke pending.

---

## TL;DR — what HLVM memory IS

A **markdown-file memory system** modeled on Claude Code's production memory
(not CC's experimental gated features). Three layers:

| Layer | Path | Scope |
|---|---|---|
| **User memory** | `~/.hlvm/HLVM.md` | Global preferences across all projects |
| **Project memory** | `./HLVM.md` (in repo) | Team-shared, version-controllable |
| **Auto-memory** | `~/.hlvm/projects/<sanitized-canonical-git-root>/memory/` | Per-project topic files + `MEMORY.md` index |

Plus:
- A **per-turn LLM selector** picks ~5 relevant topic files for each user message
- **Freshness warnings** ("47 days old, verify before asserting")
- **`@import` resolution** in HLVM.md content (depth-capped, root-validated)
- **`/memory` Ink picker** — interactive overlay that opens the chosen file in `$VISUAL/$EDITOR/vi`
- **`Memory updated in <path>`** inline notification when the model writes memory autonomously
- **Permission carve-out** so `read_file`/`write_file`/`edit_file` can target memory paths
- No dedicated memory tools — the model uses HLVM's standard file tools

What it is **not**: a SQLite database, an FTS5 index, an entity graph, a
BM25/decay scoring system. The old algorithm-heavy memory was deleted in the
CC port. See [`./memory-system-old-sqlite-DELETED.md`](#deleted-systems) (gone
as of this branch).

---

## Quick orientation: where to look first

| If you want to… | Read |
|---|---|
| Understand the model's view of memory | [`memoryTypes.ts`](#srchlvmmemorymemorytypests) — the prompt that the agent sees |
| Trace a user query → memory injection | [End-to-end flow §1](#end-to-end-flow-1--user-message-to-memory-injection) |
| Trace a model write → notification | [End-to-end flow §2](#end-to-end-flow-2--model-writes-memory) |
| Understand `/memory` UX | [End-to-end flow §3](#end-to-end-flow-3--user-types-memory) |
| Add a new test | [`tests/unit/memory/`](#test-inventory) |
| Find a known limitation | [Known gaps & TODOs](#known-gaps--todos) |
| Debug a permission denial | [Permission model](#permission-model) |

---

## Code layout (every memory file, in dependency order)

### `src/hlvm/memory/` — the new memory module

| File | Purpose | Key exports |
|---|---|---|
| `memoryTypes.ts` | Prompt sections + 4-type taxonomy (`user`/`feedback`/`project`/`reference`) | `TYPES_SECTION`, `WHAT_NOT_TO_SAVE_SECTION`, `WHEN_TO_ACCESS_SECTION`, `TRUSTING_RECALL_SECTION`, `MEMORY_FRONTMATTER_EXAMPLE`, `parseMemoryType` |
| `memoryAge.ts` | Freshness math + system-reminder wrapping | `memoryAgeDays`, `memoryAge`, `memoryFreshnessText`, `memoryFreshnessNote` |
| `paths.ts` | All memory file paths + git-root resolution | `getUserMemoryPath`, `getProjectMemoryPath`, `getAutoMemPath`, `getAutoMemEntrypoint`, `findCanonicalGitRoot`, `sanitizeProjectKey`, `isAutoMemPath`, `isAutoMemoryEnabled` |
| `memoryScan.ts` | Recursive `**/*.md` scan + frontmatter extraction | `scanMemoryFiles`, `formatMemoryManifest`, type `MemoryHeader` |
| `findRelevantMemories.ts` | Per-turn LLM selector via `classifyJson()` | `findRelevantMemories`, type `RelevantMemory` |
| `memdir.ts` | The orchestration centerpiece — `loadMemoryPrompt`, `@import` resolution, MEMORY.md cap | `loadMemoryPrompt`, `loadMemorySystemMessage`, `isMemorySystemMessage`, `truncateEntrypointContent`, `MAX_ENTRYPOINT_LINES`, `MAX_ENTRYPOINT_BYTES`, `ENTRYPOINT_NAME` |

### Helpers outside `src/hlvm/memory/`

| File | Role |
|---|---|
| `src/hlvm/runtime/local-llm.ts` | Exports `classifyJson()` (used by the selector). Internally delegates to private `collectClassificationJson()` which routes through `resolveLocalFallbackModelId()` — no model name hardcoded |
| `src/common/sanitize.ts` | `sanitizeSensitiveContent` PII helper (moved here from the deleted memory module) |
| `src/common/paths.ts` | `getHlvmDir`, `getHlvmInstructionsPath` — both used by memory paths |
| `src/hlvm/agent/path-utils.ts` | `resolveToolPath` permission carve-out for `read_file`/`write_file`/`edit_file` |

### UI / CLI

| File | Role |
|---|---|
| `src/hlvm/cli/repl-ink/components/MemoryPickerOverlay.tsx` | The `/memory` Ink overlay (4 rows + status, ↑↓/Enter/Esc + 1-4 shortcuts) |
| `src/hlvm/cli/repl-ink/components/conversation/MemoryUpdateNotification.tsx` | Inline `Memory updated in <path> · /memory to edit` line |
| `src/hlvm/cli/repl-ink/hooks/useOverlayPanel.ts` | `OverlayPanel` union including `"memory-picker"` |
| `src/hlvm/cli/repl/commands.ts` | Slash command registration; `/memory` dispatches to overlay (Ink) or text handler (non-Ink) |
| `src/hlvm/cli/repl/commands-memory.ts` | Text-mode `/memory <user\|project\|auto>` fallback for non-Ink callers |
| `src/hlvm/cli/repl/edit-in-editor.ts` | `editFileInEditor` + `editFileInEditorWithInkPause` — spawns `$VISUAL → $EDITOR → vi` |
| `src/hlvm/cli/repl/helpers.ts` | HQL `(memory)` REPL helper — opens user HLVM.md in editor |

### Orchestrator integration

| File | Role |
|---|---|
| `src/hlvm/agent/orchestrator.ts` | Per-turn `maybeInjectRelevantMemories` (called after first user message); pre-compaction nudge text |
| `src/hlvm/agent/orchestrator-state.ts` | `LoopState.surfacedMemoryPaths: Set<string>` — de-dup across iterations |
| `src/hlvm/agent/session.ts` | `injectMemoryPromptContext` — calls `loadMemorySystemMessage` at session create + reuse |
| `src/hlvm/agent/tools/run-agent.ts` | Subagent path also uses `loadMemorySystemMessage` |
| `src/hlvm/cli/repl/handlers/chat-context.ts` | Chat-mode reuses `loadMemorySystemMessage` for replay |

### Tests

`tests/unit/memory/` — see [Test inventory](#test-inventory).
Plus `tests/unit/agent/global-instructions.test.ts` exercises the consolidated path.

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
│ memdir.ts loadMemoryPrompt(cwd)         │                    │
│  ├─ buildUserMemorySection             │                    │
│  │   ├─ readTextFileOrEmpty(~/.hlvm/HLVM.md)                │
│  │   └─ resolveAtImports (allowed: ~/.hlvm)                 │
│  ├─ buildProjectMemorySection          │                    │
│  │   ├─ readTextFileOrEmpty(./HLVM.md) │                    │
│  │   └─ resolveAtImports (allowed: cwd + ~/.hlvm)           │
│  └─ buildAutoMemorySection             │                    │
│      ├─ buildMemoryLines (4-type taxonomy + write rules)    │
│      └─ truncate MEMORY.md to 200 lines / 25KB              │
│  Returns one combined system message (CC parity)            │
└────────────────────────────────────────┘                    │
                                                                ▼
                                        ┌───────────────────────────────────┐
                                        │ findRelevantMemories(userRequest, │
                                        │   autoDir, signal, recentTools,   │
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
              ├─ getMemoryAllowedRoots(workspace)
              │   ├─ getUserMemoryPath()                       (~/.hlvm/HLVM.md)
              │   └─ getAutoMemPath(workspace)                 (~/.hlvm/projects/<key>/memory/)
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
App.tsx slash dispatch (around line 1050)
   ├─ parse arg ("user"/"project"/"auto"/"u"/"p"/"a"/"m" or none)
   ├─ setMemoryPickerInitial(arg)
   └─ setActiveOverlay("memory-picker")
       │
       ▼
MemoryPickerOverlay renders:
   ┌─ Memory ──────────────────────── Auto-memory: on ┐
   │ › User memory                ~/.hlvm/HLVM.md      │
   │   Project memory             ./HLVM.md            │
   │   Auto-memory MEMORY.md      ~/.hlvm/projects/... │
   │   Open auto-memory folder    ~/.hlvm/projects/... │
   │                                                    │
   │   ↑↓ select · Enter open · Esc cancel             │
   └────────────────────────────────────────────────────┘
       │
       ▼
user presses Enter on "User memory"
       │
       ▼
MemoryPickerOverlay onSelect:
   ├─ onClose() → setActiveOverlay("none")
   └─ if action === "edit":
        editFileInEditorWithInkPause(app, path)
           └─ editFileInEditor(path)
                └─ platform.command.output({ cmd: ["vim", path], stdin/stdout/stderr: "inherit" })
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
3. **Workspace** (current cwd) → ALLOW for `.ts`/`.md`/etc as usual
4. **`getUserSkillsDir()` / `getBundledSkillsDir()`** → ALLOW (pre-existing carve-outs)
5. **`getUserMemoryPath()`** (exact: `~/.hlvm/HLVM.md`) → ALLOW
6. **`getAutoMemPath(workspace)`** (`~/.hlvm/projects/<key>/memory/`) → ALLOW for `.md` only
7. **Other project's auto-memory** (`~/.hlvm/projects/<other-key>/memory/`) → DENY
8. **Anything else** under `~/.hlvm/` → DENY (e.g. `~/.hlvm/secret.txt`)
9. **Outside workspace + carve-outs** → DENY

The 8-case smoke test `/tmp/test-permissions.ts` verifies all of these. See
also `tests/unit/memory/e2e-comprehensive.test.ts` Section C.

---

## `@import` resolution

Implemented in `memdir.ts:resolveAtImports`. Activated when HLVM.md content
contains a line that matches `^\s*@(.+\.md)\s*$`.

| Property | Value |
|---|---|
| Syntax | `@./relative/path.md` or `@/abs/path.md` |
| Depth cap | 5 (then replaced with `<!-- @import skipped: depth cap reached -->`) |
| Cycle detection | Per-import `seen: Set<string>` of absolute paths |
| Allowed roots (user HLVM.md) | `~/.hlvm` only |
| Allowed roots (project HLVM.md) | `<project-cwd>` AND `~/.hlvm` |
| Outside roots | Replaced with `<!-- @import skipped: outside allowed roots -->` |
| Non-`.md` extension | Replaced with `<!-- @import skipped: non-.md target -->` |
| Missing file | Replaced with `<!-- @import skipped: not found -->` |

Tests: `tests/unit/memory/import-resolution.test.ts` (8 tests).

---

## Test inventory

`tests/unit/memory/` — 98 tests across 6 suites, all passing.

| Suite | Tests | Coverage |
|---|---|---|
| `cc-port.test.ts` | 20 | Phase 6 plan-spec scenarios; HLVM.md+MEMORY.md round-trips, freshness, scan caps, worktree resolution |
| `e2e-comprehensive.test.ts` | 52 | User journeys, edge cases, security, performance, concurrency, CC parity, prompt budget |
| `import-resolution.test.ts` | 8 | `@import` depth, cycles, missing/non-md/cross-root denials, leading-whitespace |
| `per-turn-recall.test.ts` | 6 | Selector module — stub picks, dedup, capping, failure modes |
| `picker-behavior.test.ts` | 7 | `editFileInEditor` precedence, picker contract, auto-memory toggle status |
| `orchestrator-recall.test.ts` | 5 | `maybeInjectRelevantMemories` integration — message shape, dedup, fail-soft |

Plus `tests/unit/agent/global-instructions.test.ts` (2 tests) for the
consolidated user+project HLVM.md injection path.

**Stubbing pattern**: `HLVM_MEMORY_SELECTOR_STUB=<json-file-path>` makes the
selector deterministic. Production never sets this var.

**Run all memory tests**:
```sh
deno test --allow-all tests/unit/memory/
```

---

## CC parity status

```
                  CC MEMORY PARITY
┌──────────────────────────────┬──────────────┐
│ File layout / HLVM.md         │ █████████░   │
│ Prompt memory sections        │ █████████░   │
│ Memory write permissions      │ █████████░   │
│ Inline update notification    │ ██████████   │
│ /memory interactive picker    │ █████████░   │
│ Ink editor handoff            │ ██████░░░░   │ ← survives but no proper pause/resume
│ @import resolution            │ █████████░   │
│ Per-turn relevant memories    │ █████████░   │
│ SQLite migration              │ N/A          │ ← pre-release; migrator removed
└──────────────────────────────┴──────────────┘
```

**Sub-10/10 deviations are intentional:**
- `HLVM.md` instead of `CLAUDE.md` (HLVM convention)
- Local LLM selector via `classifyJson` (gemma4 today) instead of CC's Sonnet 3.5
- `Auto-dream` row absent (AUTODREAM out of scope)
- Team / agent / `@-imported nested rows` absent in picker

**See [`./phase7-notes.md`](./phase7-notes.md)** for the per-fixture CC vs HLVM
behavioral comparison.

---

## Known gaps & TODOs

Ranked by impact:

| # | Gap | Severity | Pointer |
|---|---|---|---|
| 1 | **Real Ink pause/resume during editor spawn.** Currently Ink stays mounted while vim takes the alt-screen — REPL survives, but visual glitches possible. CC's pattern (`commands/memory/memory.tsx:42` + `utils/promptEditor.ts`) cleanly hands off the alt-screen. | medium | `src/hlvm/cli/repl/edit-in-editor.ts:editFileInEditorWithInkPause` |
| 2 | **Manual `/memory` smoke not yet performed.** Need to verify `hlvm repl → /memory → Enter → edit → quit → REPL alive`. Cannot be automated from sandboxed envs. | blocker for merge | (manual) |
| 3 | **Post-editor "Opened memory file at..." line not emitted in Ink path.** `MemoryPickerOverlay` accepts `onEditorExit` callback but App.tsx doesn't pass one — needs conversation-hook plumbing to emit info messages from outside an existing handler. | low | `src/hlvm/cli/repl-ink/components/App.tsx` (where overlay is rendered) |
| 4 | **Per-turn recall is awaited inline.** Adds local-classifier latency (~500ms typical) to first turn. Future optimization: async-prefetch at session-creation overlapping with prompt assembly. | low | `src/hlvm/agent/orchestrator.ts:maybeInjectRelevantMemories` |
| 5 | **`recentTools` array is always empty in selector calls.** CC threads tool-use history into the selector to filter out reference docs for tools currently in use. HLVM passes `[]`. | low | `src/hlvm/agent/orchestrator.ts:maybeInjectRelevantMemories` |
| 6 | **No "Auto-memory: off → on" toggle in picker.** Only a read-only status row. CC has an interactive toggle. Would need a config-mutation surface for env vars or a settings file. | low | `src/hlvm/cli/repl-ink/components/MemoryPickerOverlay.tsx` |

---

## How to extend / debug

### "Memory isn't loading"
1. `deno run --allow-read --allow-env --allow-write=$HOME/.hlvm /tmp/test-memory.ts`
   (smoke script that calls `loadMemoryPrompt` and prints the output)
2. Check `~/.hlvm/HLVM.md` exists and has content. `cat ~/.hlvm/HLVM.md`.
3. Check auto-memory path: `getAutoMemPath()` should produce `~/.hlvm/projects/<sanitized-cwd-or-git-root>/memory/`.
4. If `HLVM_DISABLE_AUTO_MEMORY=1` is set, the auto-memory section is skipped (but user/project HLVM.md still load).

### "Model can't write to memory path"
1. Path must end with `.md` (auto-memory dir requires `.md` extension).
2. Path must be exactly `~/.hlvm/HLVM.md`, exactly `<workspace>/HLVM.md`, or under `~/.hlvm/projects/<current-key>/memory/`.
3. Other projects' memory dirs are denied.
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
4. Add a number-key shortcut (5/6/...) in the keyboard handler.
5. Add a test in `picker-behavior.test.ts`.

---

## Glossary

- **HLVM.md** — the user-facing memory markdown file (parallels CC's `CLAUDE.md`)
- **MEMORY.md** — the auto-memory index file inside `~/.hlvm/projects/<key>/memory/`
- **Topic file** — any `*.md` file in the auto-memory dir (e.g. `feedback_tabs.md`)
- **Auto-memory** — the per-project markdown directory the model can write to autonomously
- **Selector** — the per-turn LLM call that picks which topic files to inject
- **Permission carve-out** — paths the model can read/write that fall outside the workspace boundary
- **Freshness note** — system-reminder text injected for memories older than 1 day
- **`@import`** — line-level inclusion directive in HLVM.md content
- **`classifyJson`** — exported wrapper at `src/hlvm/runtime/local-llm.ts` for local-LLM JSON classifier calls
- **CC** — Claude Code (the reference implementation we ported from)
- **CC-experimental features** — `TEAMMEM`, `KAIROS`, `AUTODREAM`, `EXTRACT_MEMORIES`, `MEMORY_SHAPE_TELEMETRY` — all out of scope per plan v3
- **plan v3** — `~/.claude/plans/don-t-do-hard-code-mossy-gem.md` (the implementation plan; see for full decision history)

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

---

## Plan reference

The full implementation plan with every decision, revision history, and
rationale is at:

```
~/.claude/plans/don-t-do-hard-code-mossy-gem.md
```

Read it if you need the "why" behind any decision in this doc. Read this doc
if you need the "what" and "where."
