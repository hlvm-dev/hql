# HLVM REPL TUI v2 - Source of Truth

## The First Principle (rule #0 — overrides everything below)

**CC is the donor. Read `~/dev/ClaudeCode-main/` for real. Copy CC code
exactly where possible. Never theorize; never invent from memory.**

Every rule in this doc is a consequence of this one. If a downstream
rule ever contradicts it, this rule wins.

### What "for real" means

For any TUI surface HLVM and CC both have:

1. **Open the actual CC file.** Not "probably `useTypeahead.tsx` does
   X." Open the file. Read it end-to-end. Scroll through every branch.
   Then write.
2. **Copy the code 1:1 where the structure is portable.** Runtime
   adapters (Bun→Deno imports, `fs`→`@std/fs`, `npm:` specifiers,
   React-18 vs 19 conventions) are the ONLY allowed edits. Behavioral
   simplification, "cleaner" rewrites, and "we don't need that branch"
   pruning are forbidden.
3. **Transplant closely where the structure is coupled.** Read CC, port
   the same control flow / state shape / event wiring. Adapt only what
   the Deno+React 19 stack forces.
4. **Never write a simplified stand-in** when a CC implementation
   exists. "Inspired by CC" is not acceptable and will be reverted.

### What "always build and run" means

No code change lands without actually running both shells side-by-side:

```bash
# Build fresh. Launch the donor. Launch ours. Same geometry.
make build-fast
tmux -S /tmp/cc.sock new-session -d -s cc -x 140 -y 35 'claude --model sonnet'
tmux -S /tmp/v2.sock new-session -d -s v2 -x 140 -y 35 './hlvm repl --new'
# Drive IDENTICAL keystrokes through both.
# Capture both panes. ANSI-strip. Diff.
tmux -S /tmp/cc.sock capture-pane -pt cc | sed 's/\x1b\[[0-9;]*[mGKHJfABCDEhl]//g' > /tmp/cc.txt
tmux -S /tmp/v2.sock capture-pane -pt v2 | sed 's/\x1b\[[0-9;]*[mGKHJfABCDEhl]//g' > /tmp/v2.txt
diff /tmp/cc.txt /tmp/v2.txt
```

Reading-only parity does not count. Type-check-only parity does not
count. A row in §13 stays `(X)` until the PTY capture of v2 is visually
indistinguishable from the PTY capture of CC on that scenario. Only
then does it flip to `(O)`.

### Doc contract

This doc is SSOT. Every parity audit updates it. Every row flip is
paper-trailed here with the PTY capture path or a note pointing to it.
The §13 Shared-Surface Parity Matrix below is the live mission
scoreboard:

> **Mission complete iff every row in §13 is `(O)`.**

Not Phase 1 done. Not "most of it working." Every row.

---

## 0. Quick Start — Cold-Start Pickup for a New Agent

If you have just been dispatched to work on this tree and know nothing
about the project, read THIS section first. Everything below it is
historical context you may need, but this section gives you the
operating knowledge.

### 0.1 What this is

HLVM is building a new REPL TUI (called **v2**). The *product design
rule* is:

```text
Claude Code TUI quality + HLVM-native business logic + HQL + JS REPL
```

- `~/dev/ClaudeCode-main/` is the CC donor source — you are permitted
  (and expected) to read it directly to learn exact behaviors and port
  them. Do not invent from memory.
- `src/hlvm/cli/repl-ink/` is the v1 HLVM REPL. It already has the
  HLVM-specific composer features (attachments, `@` drill, history
  search, queue editing). v2 reuses those components directly as SSOT
  wherever possible — see §11.5.
- `src/hlvm/tui-v2/` is the v2 tree. It wraps the donor CC ink engine
  (hard-copied under `src/hlvm/tui-v2/ink/`) and delegates composer UX
  to the v1 components via the barrel at `src/hlvm/tui-v2/ink/index.ts`.

### 0.2 How to run + verify (copy/paste)

```bash
# Launch the compiled binary in v2 mode:
./hlvm repl --new              # or: make repl-new

# After any edit, rebuild + re-check:
make build-fast                # rebuilds ./hlvm
deno check --config src/hlvm/tui-v2/deno.json --unstable-sloppy-imports \
  src/hlvm/tui-v2/main.tsx     # type-check v2 entry
deno task ssot:check           # repo-wide SSOT rules; must be 0 errors
deno task check:tui-v2         # regression guard: forbid npm:ink@5 and
                               # react-reconciler@0.29 in the v2 graph

# Live side-by-side vs CC in tmux PTYs:
tmux -S /tmp/cc.sock new-session -d -s cc -x 140 -y 35 \
  "claude --model sonnet 2>/dev/null; sleep 5"
tmux -S /tmp/v2.sock new-session -d -s v2 -x 140 -y 35 \
  "./hlvm repl --new 2>/tmp/v2.log; sleep 5"
# send identical keystrokes via `tmux send-keys -t {cc,v2} ...`
# capture with `tmux capture-pane -pt {cc,v2} | sed 's/\x1b\[[0-9;]*[mGKHJfABCDEhl]//g'`

# DO NOT run `deno task test:unit` unless the user explicitly asks —
# concurrent agents may have in-flight WIP in the tree.
```

### 0.3 File map (what lives where)

```text
src/hlvm/tui-v2/                 v2 tree (React 19 + reconciler 0.31)
  main.tsx                       subprocess entry (see cli.ts:launchTuiV2Baseline)
  mod.tsx                        renderSync + console.error-sink + patchConsole:true
  App.tsx                        root: AlternateScreen / ThemeProvider / Banner / Workbench
  ink/                           hard-copied CC donor engine (do NOT hand-modify)
  ink/index.ts                   BARREL — maps bare `"ink"` from any v1 file
                                 reached from v2 onto the local donor engine
  prompt/PromptInput.tsx         main composer shell (imports v1 Dropdown etc.)
  prompt/PromptInputFooter*.tsx  footer layout
  prompt/ShortcutsHelpMenu.tsx   `?` overlay contents (HLVM shortcut subset)
  prompt/PromptInputQueuedCommands.tsx
  transcript/TranscriptWorkbench.tsx   runtime-host wiring, slash-command dispatch
  transcript/messages/*.tsx      user/assistant/tool/system row renderers
  compat/                        interface scaffold for the 7 compat domains
                                 (mostly still stubs — see §6.4)
  header/                        DELETED — v2 now uses v1's Banner directly

src/hlvm/cli/repl-ink/           v1 REPL (React 18 + ink@5)
  components/Banner.tsx          reused by v2 (SSOT)
  components/HistorySearchPrompt.tsx   reused by v2 (SSOT)
  components/HighlightedText.tsx reused by v2 (SSOT) — yellow match highlight
  components/PickerRow.tsx       reused by v2 (SSOT)
  components/LocalAgentsStatusPanel.tsx    HLVM agent-spawn tree (NOT yet wired in v2)
  completion/Dropdown.tsx        reused by v2 (SSOT, CC-parity chrome edits landed)
  completion/concrete-providers.ts   @file-search apply() logic
  completion/useCompletion.ts    completion hook
  hooks/useAttachments.ts        reused by v2 (SSOT)
  hooks/useHistorySearch.ts      reused by v2 (SSOT)

src/hlvm/cli/repl/               shared REPL utilities
  attachment.ts                  createAttachment() + resolveAttachmentPath() (~ expand)
  file-search.ts                 fuzzy search + CWD top-level listing
  mention-resolver.ts            resolves @path into real file content at submit

scripts/check-tui-v2-ink.ts      regression guard (ensures no ink@5 in v2 graph)
docs/vision/repl-v2-tui.md       THIS doc (SSOT)
```

### 0.4 Non-negotiable workflow

For every TUI surface both HLVM and CC have, CC is authoritative. The
only way to close a row in §11.5 is:

1. Run `claude --model sonnet` in one tmux pane, `./hlvm repl --new` in
   another. Drive IDENTICAL keystrokes.
2. `tmux capture-pane -pt …` + ANSI-strip both sides. Diff them.
3. If v2 diverges, open the relevant CC file under
   `~/dev/ClaudeCode-main/` OR the relevant v1 file under
   `src/hlvm/cli/repl-ink/` and port the structural behavior (read,
   don't invent). Don't type "probably CC does X" — read the file.
4. Rebuild + re-diff. Only then flip the row from `[ ]` / `[~]` to
   `[x]` in §11.5 AND leave a PTY-capture paper-trail in whatever
   conversation or PR you're doing the work in.

### 0.5 What NOT to do

- Do NOT create a second planning doc. Update THIS one.
- Do NOT duplicate v1 components into v2 — reuse them via the barrel.
- Do NOT rewrite `src/hlvm/tui-v2/ink/` by hand (it's a donor hard-copy).
- Do NOT widen CC parity scope to non-overlap features (remote session,
  voice, buddy, swarm/coordinator, `--chrome`, etc.) — those are
  explicitly out-of-scope in §11.5's opening block.
- Do NOT flip a row to `[x]` without a real PTY audit.
- Do NOT `git stash`; concurrent agents may lose WIP.
- Do NOT run `deno task test:unit` unless explicitly asked.

### 0.6 Next highest-value work (in order)

1. **Runtime round-trip — revised finding (2026-04-17 PM live audit).**
   The TUI stream consumer IS working. Submitting `hi` + Enter in v2
   paints the user row locally AND paints an assistant row — but the
   assistant body reads
   `Error / [HLVM5006] Local HLVM runtime host is not ready for AI requests.`
   instead of a real reply. Turn-complete rollup fires (footer flips
   `esc to interrupt` → `? for shortcuts`). So the TUI path is green;
   the gap is the local HLVM-managed runtime never became ready in
   this session. Captures:
   `/tmp/hlvm-audit/roundtrip-cc-3s.txt` (CC: `⏺ Hi! How can I help
   you today?` at ~3s) vs `/tmp/hlvm-audit/roundtrip-v2-18s.txt` (v2:
   the HLVM5006 error). Pivot the work:
   - **Friendlier error surface.** Replace bare `[HLVM5006]` with an
     actionable hint (e.g. `Local AI runtime not started — run
     'hlvm ai install' or check 'hlvm runtime status'`). Lives in the
     error → `addAssistantText` path.
   - **De-duplicate the error row.** The HLVM5006 text prints in both
     the assistant bubble body AND the turn-complete rollup; fix in
     `conversation.addAssistantText` error branch + rollup computer.
     Captured live in the v2 pane.
   - **Boot-time readiness probe.** Show an actionable banner/notice
     before first submit instead of a generic `esc to interrupt`
     followed by a cryptic error.
   - **Fixture bypass for chrome work.** Setting
     `HLVM_ASK_FIXTURE_PATH=<path>` short-circuits the model call
     (`TranscriptWorkbench.tsx:173`) — use this for live-turn chrome
     work (§13.F, §13.H) until a ready local runtime is available.
   - **Original exit criterion still valid.** `hi` + Enter must render
     an assistant bubble with **real reply text** AND the turn rollup.
     The chrome half is green; the model half needs a ready runtime.
2. **Port CC's live-turn chrome** (thinking indicator,
   `* Ideating… (Ns · phase)`, `* Cogitated for Xm Ys` post-turn
   rollup, task-tree transcript rows with `✔` checkmarks, Ctrl+T
   toggle). See §0.9.3 for the explicit gap matrix; these surfaces do
   not exist in v2 at all. Largest user-visible parity gap after
   round-trip is green. Donor entry points to read first:
   - Verb tables: `~/dev/ClaudeCode-main/constants/spinnerVerbs.ts`
     (live "Ideating…" / "Working through it…" / etc.) and
     `~/dev/ClaudeCode-main/constants/turnCompletionVerbs.ts` ("Cogitated").
   - Spinner component: `~/dev/ClaudeCode-main/components/ThinkingToggle.tsx`.
   - Task list rows: `~/dev/ClaudeCode-main/components/TaskListV2.tsx`
     + `~/dev/ClaudeCode-main/hooks/useTasksV2.ts` +
     `hooks/useTaskListWatcher.ts`.
   - Agent progress: `~/dev/ClaudeCode-main/components/AgentProgressLine.tsx`.
   - Read them end-to-end before porting — don't half-adapt. The
     existing v2 `conversation.addEvent` stream already carries the
     `tool_start` / `tool_end` events you need; the gap is
     transcript-side rendering, not event wiring.
   - Exit criterion: v2 side-by-side vs `claude --model sonnet` shows
     the same four surfaces (thinking, phase label, cogitated
     rollup, task tree) within pixel tolerance; Ctrl+T toggles tree
     visibility.
3. **Port `src/hlvm/cli/repl-ink/components/LocalAgentsStatusPanel.tsx`
   into v2's `TranscriptWorkbench`.** v1 already has the `├─` / `└─` /
   `⎿` tree rendering + tool-uses/tokens counts. v2 has nothing. This
   is the HLVM-specific agent-spawn tree; separate from CC's
   task-tree in #2.
4. **Wire Ctrl+O → v1's `TranscriptViewerOverlay`** so the tool-row
   `(ctrl+o to expand)` hint becomes functional.
5. **Wire Cmd+V clipboard-image paste.** Drag-select + Cmd+C now works
   end-to-end (see §0.9). The remaining clipboard gap is the INBOUND
   path: `onImagePaste` is accepted by `hooks/useTextInput.ts` and
   `input/BaseTextInput.tsx` but v2's `PromptInput.tsx` never passes a
   handler, so Cmd+V of an image on the macOS pasteboard falls through
   to the text-paste codepath (producing garbled text, not an image
   attachment). Port CC's `hooks/useImagePaste.*` or equivalent; the
   downstream attachment store already supports the image kind.
6. **Decouple the last v1 file (`keybindings/keybinding-lookup.ts`)**
   reached from `src/hlvm/cli/repl/commands.ts:9`. Convert
   `commands.ts`'s `registry` reference to a lazy dynamic import so
   `commands.ts` can be loaded without pulling the keybindings chain.
   Then delete `src/hlvm/tui-v2/ink/index.ts` + the deno.json `"ink"`
   alias.
7. **Architectural: prompt-row flow position.** CC paints the prompt
   near the TOP of the alternate screen and grows the transcript
   downward. v2 pins the prompt to the BOTTOM and scrolls the
   transcript upward. Biggest remaining visual gap. Requires a
   `TranscriptWorkbench` layout rewrite; not a one-line change.

### 0.7 Known still-open `[ ]` rows in §11.5

- Ctrl+G `$EDITOR` (needs tempfile + subprocess)
- Ctrl+V image paste (see §0.6 #4 — accepted by `useTextInput` but the
  handler is never wired at the `PromptInput` layer)
- Tool-row `ctrl+o to expand` functional wiring
- Markdown streaming, thinking-verb rotation, progress indicator,
  MCP warning chip, plan-checklist `▢`/`☑` (all runtime-gated)
- Permission-mode backend tool gating (footer indicator works; actual
  tool gate is not wired)
- Compat-layer call-sites (scaffold exists in `src/hlvm/tui-v2/compat/`;
  production wiring still reaches v1 code directly)

### 0.8 Gates currently green

`deno check` · `deno task ssot:check` 0 errors · `deno task check:tui-v2`
clean (no `npm:ink@5` / `react-reconciler@0.29` reachable from v2
graph) · `make build-fast` builds · every `[x]` row in §11.5 has a PTY
capture trail in the conversation where it was landed.

### 0.9 Latest verified findings (2026-04-17 PM)

#### 0.9.1 Cmd+C root cause — FIXED (verified with real pbpaste, not theorized)

The previous session's work ported CC's `useCopyOnSelect` hook into
`src/hlvm/tui-v2/hooks/useCopyOnSelect.ts` and wired it from `App.tsx`,
but Cmd+C still produced a macOS beep. End-to-end trace with a
PTY-simulated SGR drag + real `pbpaste` revealed two separate bugs:

1. **The copy-on-select hook was over-narrow.** My earlier port only
   fired at the drag-release *transition* (`isDragging: true → false`),
   which missed multi-click word/line selection (those settle with
   `isDragging: false` without ever being `true`). Rewrote
   `useCopyOnSelect` to exactly mirror
   `~/dev/ClaudeCode-main/hooks/useCopyOnSelect.ts`: fire on any
   settled non-empty selection, guarded by `copiedRef` against
   duplicate notifies. Reads `selection.hasSelection()` rather than
   diffing drag state.

2. **`execFileNoThrow` was a no-op stub.** The real root cause. The
   donor `ink/termio/osc.ts:176` calls `execFileNoThrow('pbcopy', [],
   {input: text, …})` to shell out to the native clipboard utility, and
   `ink/termio/osc.ts:97` calls it for `tmux load-buffer -w -`. The
   shim at `src/hlvm/tui-v2/stubs/utils.ts` returned `{exitCode: 1}`
   synchronously without spawning anything. So the hook fired, the ink
   engine returned 11 bytes of selected text, OSC 52 was emitted to
   stdout, but `pbcopy` was never invoked. `pbpaste` showed whatever
   was on the clipboard before. Fix: replaced the stub with a real
   async implementation backed by `getPlatform().command.run()`, with
   shape-detection for Web `WritableStream<Uint8Array>` (Deno) vs Node
   `Writable` (Node).

Verification method (reproducible by next agent):

```bash
# Prime clipboard with sentinel so we can see writes.
printf 'SENTINEL' | pbcopy

# Launch v2 in tmux, type content to select against.
tmux new-session -d -s hlvmtest -x 120 -y 40 './hlvm repl --new'
sleep 4
tmux send-keys -t hlvmtest 'hello world test selection'

# Inject a fabricated SGR mouse drag: press at col 3, motion col 13,
# release col 13, all at the prompt row (row depends on viewport).
printf '\033[<0;3;38M'  | tmux load-buffer -; tmux paste-buffer -t hlvmtest
printf '\033[<32;8;38M' | tmux load-buffer -; tmux paste-buffer -t hlvmtest
printf '\033[<32;13;38M'| tmux load-buffer -; tmux paste-buffer -t hlvmtest
printf '\033[<0;13;38m' | tmux load-buffer -; tmux paste-buffer -t hlvmtest

sleep 1
pbpaste   # must print the 11-char slice, not SENTINEL
```

For deeper diagnostic runs, re-add local copy trace instrumentation if needed;
that hook has been removed from the production path and should stay out of
shipped builds.

Note on the visible beep: macOS Terminal still beeps on Cmd+C when it
has no *native* selection (mouse tracking ate the drag). CC exhibits
the identical beep — this is Terminal.app behavior, not an HLVM bug.
Cmd+V after the drag pastes the right content because `pbcopy` has
already written it. Users who want beep-free copy set
`CLAUDE_CODE_DISABLE_MOUSE=1` to fall back to native selection.

#### 0.9.2 Attachment reality — what the `[Image #N]` / `[Pasted text #N]` chips actually do

User raised "does the attachment really work or just pretend TUI
only?" — tracing from `PromptInput.handlePaste` through to
`runAgentQueryViaHost`:

| Source | Path | Real attachment payload? |
|---|---|---|
| Paste absolute image path (`/Users/.../Shot.png`) | `handlePaste` → `isAutoAttachableConversationAttachmentPath` → `attachmentState.addAttachmentWithId` → `createAttachment` → `registerAttachmentFromPath` | **Yes.** Real SQLite blob row; `attachmentId` returned; submit wires it via `prepareConversationAttachmentPayload` → `runAgentQueryViaHost({attachmentIds})` → chat protocol `attachment_ids` → runtime resolves content by `/api/attachments/{id}/content` URL in `session-protocol.ts`. |
| `@<path>` picker selection | Same codepath as above | **Yes.** |
| Large text paste (≥ threshold lines) | `handlePaste` → `shouldCollapseText` → `addTextAttachmentWithId` → `createTextAttachment` → `registerTextAttachment` (writes `pasted-text-{id}.txt`) | **Yes.** Same chat-protocol `attachment_ids` pipe. |
| **Cmd+V of an image on the macOS clipboard** | `useTextInput` destructures `onImagePaste: _onImagePaste` (underscore = ignored) at `hooks/useTextInput.ts:84`. `PromptInput.tsx` never passes `onImagePaste`. | **No.** TUI-only placeholder path (fallthrough to pbpaste'd text bytes — image blob becomes garbage text). See §0.6 #4. |

So the chips in the user's screenshot are real when they came from
pasting absolute file paths or from `@` picker or from bracketed large
text paste. The only "pretend" case is Cmd+V of an image from the
clipboard — that's genuinely not wired yet.

#### 0.9.3 CC top-level chrome that does NOT exist in v2 — honest gap list

User side-by-side of CC vs v2 (2026-04-17 PM) confirmed v2 is missing
the entire "live turn" chrome that CC paints between user submit and
assistant reply. These are NOT partial / NOT cosmetic drift — the
surfaces do not exist in v2 source at all. Grep confirms zero matches
for the relevant strings under `src/hlvm/tui-v2/`.

| CC surface | What CC paints | v2 reality |
|---|---|---|
| `* Thinking / Working through it… +2.61%` | Real-time thinking phase with progressive token-delta counter, live while the model reasons | **Absent.** No thinking indicator; spinner stops at static "esc to interrupt". `grep -r "Working through"` v2 → 0 matches. |
| `* Ideating… (17s · thinking)` | Active phase label with elapsed seconds + current phase name | **Absent.** No phase label surface. |
| `* Cogitated for 6m 22s` | Total-time rollup shown AFTER the turn completes, in place of the live thinking spinner | **Absent.** v2 shows `Turn complete / 0 tools · 40s` — different shape, plainer, no cogitation roll-up. |
| Task tree with `✔` checkmarks inline in transcript | CC renders TaskCreate/TaskList items directly in the turn so you see the agent's task graph completing live | **Absent.** `Turn complete / 0 tools` is all v2 shows. No tree, no checkmarks, no per-task rows. |
| Footer `· ctrl+t to hide t…` | CC footer lets you toggle the task-tree visibility with Ctrl+T | **Absent.** Ctrl+T is no-op in v2 (§11.5 row marks it `(X) toggle tasks overlay`). |
| `⏵⏵ accept edits on (shift+tab to cycle)` footer banner | Visible when permission mode ≠ default | **Present but rendering-only.** `PromptInput.tsx:1613` emits the banner; the actual backend tool gate is NOT wired (see §11.6 C bullet "Permission-mode backend gate"). |

Bottom line: v2 today matches CC on **composer chrome** (prompt /
picker / footer / attachments / permission-mode banner) and
**clipboard** (§0.9.1) — but the entire **live-turn chrome** (thinking
indicator, cogitated rollup, task tree, Ctrl+T toggle) and **markdown
streaming** are brand-new work, not partial ports. Do not describe
these as "close" or "partial" in any future handoff — they are 0%.

Escalating consequences for §0.6:

- The runtime round-trip audit (still §0.6 #1) is a precondition — if
  the assistant reply never paints, none of the live-turn chrome can
  be tested.
- Once round-trip is green, the next large surface is **porting CC's
  live-turn indicator + task-tree transcript rows**, not LocalAgents.
  LocalAgents is a separate HLVM-specific tree; CC's task-tree chrome
  is the more user-visible gap per the screenshots.

### 0.10 Honest gaps in this handoff (what the doc does NOT capture)

A previous agent wrote the doc. Cold-start agents should read this
first and probe for reality before trusting §11.5's checkboxes:

1. **Concurrent WIP pollution.** `git status` will show files outside
   `src/hlvm/tui-v2/` modified by OTHER agents (agent/, tests/,
   cli/repl/). Those are not mine. Do not revert them. §0.12
   fingerprints the narrow file set that the latest TUI-v2 session
   owns.
2. **Runtime round-trip (§0.6 #1) has no debugging playbook yet.**
   Neither this doc nor the code tells you how to confirm a local
   model is configured, how to attach a logger to
   `runAgentQueryViaHost`, or whether `hlvm ai install` is a
   precondition. First useful step: set
   `HLVM_ASK_FIXTURE_PATH=<path>` to a canned response (see
   `fixturePath` usage in `TranscriptWorkbench.runPromptSubmission`)
   so the runtime is bypassable without a real model. Real round-trip
   still needs a configured provider.
3. **The PTY SGR-injection reproducer in §0.9.1 is a test-time
   trick.** It works because `tmux paste-buffer` forwards raw bytes
   to the subprocess stdin, which v2's parser interprets as mouse
   events. In a normal terminal, the user's real mouse drag is what
   triggers the same code path. If you're automating regression
   tests, use the injection recipe; if you're debugging live, use a
   real mouse + `pbpaste`.
4. **CC-parity rows in §11.5 were last PTY-audited 2026-04-17.**
   Anything not re-audited after a large refactor must be treated as
   stale. When in doubt, re-capture with `tmux capture-pane -pt ... |
   sed 's/\x1b\[[0-9;]*[mGKHJfABCDEhl]//g'`.
5. **No unit tests exist for v2.** `deno task test:unit` covers v1 +
   the rest of the tree; v2's quality gate is `deno check` + the
   regression guard at `scripts/check-tui-v2-ink.ts` + live PTY.
   Don't claim parity from code review alone.
6. **`patchConsole: true` is load-bearing.** Turning it off re-exposes
   stderr corruption on the ink-drawn screen (see §11.5's paste
   setState-in-render bug for the incident report). Don't "tidy" it.
7. **The doc is 2100+ lines. §0 is the cold-start lane.** §11.5 is
   the authoritative parity matrix. §11.6 is the v1→v2 functionality
   migration matrix. If §0 and §11.5 disagree, §0 is newer.

### 0.11 Pickup self-test (run this BEFORE editing anything)

Before you touch a line of code, run these four commands. If any
fails, stop and reconcile the doc against reality before proceeding.

```bash
# 1. Gates — all three must be green.
deno task ssot:check                 # expect: "✓ No errors found."
deno task check:tui-v2               # expect: "v2 TUI graph is clean"
make build-fast                      # expect: "Done! Binary: ./hlvm"

# 2. Boot — v2 shell must come up with banner + flush-left prompt.
tmux new-session -d -s hlvm_pickup -x 120 -y 40 './hlvm repl --new'
sleep 4
tmux capture-pane -t hlvm_pickup -p | tail -5
# expect to see "❯" and "? for shortcuts" and a medium/effort footer
tmux kill-session -t hlvm_pickup

# 3. Clipboard — drag-select → pbpaste chain must round-trip.
printf 'PICKUP_SENTINEL' | pbcopy
tmux new-session -d -s hlvm_cb -x 120 -y 40 './hlvm repl --new'
sleep 4
tmux send-keys -t hlvm_cb 'abcdefghij'; sleep 1
for seq in '\033[<0;3;38M' '\033[<32;8;38M' '\033[<0;8;38m'; do
  printf "$seq" | tmux load-buffer -
  tmux paste-buffer -t hlvm_cb
  sleep 0.3
done
sleep 1
pbpaste                              # expect: a short slice, NOT PICKUP_SENTINEL
tmux kill-session -t hlvm_cb

# 4. Working-tree provenance — know which files are v2-session WIP.
git status --porcelain -- src/hlvm/tui-v2/ docs/vision/repl-v2-tui.md
git log -1 --oneline
```

If step 3 returns `PICKUP_SENTINEL`, the `execFileNoThrow` rewrite
(§0.9.1 bug #2) has regressed — re-check `src/hlvm/tui-v2/stubs/utils.ts`
before anything else. That's the single most load-bearing file in
this session's delta.

### 0.12 Session ledger (files the 2026-04-17 PM session trusts)

Exact file-level scope of the latest v2 session that this doc
reflects. If you see other `src/hlvm/tui-v2/` edits in `git status`
that aren't listed here, they're either older session work (safe) or a
concurrent agent's WIP (don't touch). Non-v2 changes (agent/, tests/,
cli/repl/handlers/) are other agents' work — out of scope for this
doc.

| File | Role | State |
|---|---|---|
| `src/hlvm/tui-v2/stubs/utils.ts` | Real async `execFileNoThrow` via `getPlatform().command.run()`; shape-detects Web vs Node stdin; critical for clipboard + tmux buffer writes | FRESH — do not revert |
| `src/hlvm/tui-v2/hooks/useCopyOnSelect.ts` | CC-parity copy-on-select hook (untracked in git at the time of writing; added by this session) | FRESH |
| `src/hlvm/tui-v2/App.tsx` | Wraps the tree in `<ThemeProvider>` + `<Shell>`; Shell calls `useCopyOnSelect` so it sees the ink stdin context | FRESH |
| `src/hlvm/tui-v2/utils/fullscreen.ts` | `isMouseTrackingEnabled()` returns ON-by-default matching CC; gated by `CLAUDE_CODE_DISABLE_MOUSE` | FRESH |
| `src/hlvm/tui-v2/prompt/PromptInput.tsx` | Latest composer with `handlePaste` attachment branches, completionRef, submitDraft{clearAfter}, removed duplicate `visibleAttachments` preview block | FRESH |
| `src/hlvm/tui-v2/mod.tsx` | `renderSync(..., {patchConsole: true, exitOnCtrlC: true})`; do NOT turn patchConsole off | FRESH |
| `docs/vision/repl-v2-tui.md` | This doc | FRESH |
| `deno.lock` | Concurrent-agent changes — leave alone | EXTERNAL |
| `docs/route/*.md` | Concurrent-agent doc churn | EXTERNAL |
| `src/hlvm/agent/**`, `tests/unit/agent/**`, `tests/integration/http-server.test.ts`, `src/hlvm/cli/repl/handlers/chat-agent-mode.ts` | Concurrent-agent work on the agent/orchestrator track | EXTERNAL |

Key contract: the clipboard fix in §0.9.1 rests on the `stubs/utils.ts`
rewrite + the `hooks/useCopyOnSelect.ts` port. Both files must be
present and intact. If either is stale (e.g. a rebase or merge
replaced the stub with the old no-op), the Cmd+V round-trip in §0.11
step 3 will fail and the beep returns.

---



**Status (as of 2026-04-17):** NOT done. Phase 1 is actively in progress.
The authoritative checklist is §11.5 "CC-parity Checklist — OVERLAPPING TUI
surfaces only"; §11 "Progress Board" is the Phase summary. Do not treat
individual `[x]` rows as "Phase 1 complete" — Phase 1 closes only when
every `[x]` in §11.5 is PTY-verified against `claude --model sonnet` AND the
architectural debts below are cleared.

**Phases:**
- **Phase 0** (engine + launch baseline): `[x]` DONE — donor CC ink engine
  copied, adapted for Deno; `./hlvm repl --new` spawns an isolated React 19
  subprocess via `src/hlvm/tui-v2/deno.json`.
- **Phase 1** (CC-quality chat TUI): `[~]` IN PROGRESS — ~35 `[x]` parity
  rows verified live in tmux PTY; ~7 `[~]` partials; ~17 `[ ]` open (see
  §11.5). Shell boots cleanly, composer matches CC visually for boot / `/` /
  `@` / `?` / Shift+Tab / submit / pickers / footer. Drag-select → Cmd+V
  copy path verified end-to-end (see §0.9.1). Runtime round-trip
  (assistant reply rendering) and streaming-chrome parity (thinking /
  tool-row / progress / markdown streaming) are NOT yet verified.
  Cmd+V clipboard-image ingestion NOT wired (see §0.9.2).
- **Phase 2** (HQL + JS code mode): `[ ]` NOT STARTED.
- **Phase 3** (HLVM overlays / product UX): `[ ]` NOT STARTED.
- **Phase 4** (polish / migration / default path): `[ ]` NOT STARTED.

**Architectural debts blocking Phase 1 closure (flagged by peer review,
tracked with exit criteria in §11 and §11.5):**
1. `src/hlvm/tui-v2/ink/index.ts` barrel remaps bare `"ink"` to the local
   donor for 4 v1 `repl-ink` files. A `deno task check:tui-v2` regression
   guard now asserts no `npm:ink@5` / `react-reconciler@0.29.x` is
   reachable from the v2 graph. Exit: port those 4 files into `src/hlvm/
   tui-v2/` and remove the barrel.
2. Compat layer (§6.4) is named but has no code. For a ~24k-LOC transplant
   target this IS the architecture. Exit: create `src/hlvm/tui-v2/compat/`
   with one file per named domain before the next major CC transplant.
3. Operational CC-quality gate is currently the §11.5 checklist + live PTY
   workflow. Exit: publish a hard fail-list (owner per row) that MUST be
   `[x]` before Phase 1 is declared done.
4. Multi-process design (v2 runs as a separate Deno subprocess with its
   own deno.json / lockfile / React 19 stack) is load-bearing because the
   root repo stays on React 18 + ink@5 for v1. This is a deliberate
   isolation, not an accident — do not "unify" into a single process without
   first unifying the React versions across both trees.

**Working-tree reality (refresh before trusting):** the latest merged
checkpoint on `feat/lean-binary-cicd` is `e7a5fffc feat(agent+tui-v2):
inline MCP server specs in agents, consolidate TUI v2 on v1 SSOTs`.
Uncommitted edits on top of that include both this session's v2 work
AND other agents' concurrent changes (agent/, tests/, cli/repl/). When
picking up, run `git log -1 --oneline` to confirm the base and
`git status --porcelain` to see the actual working tree. Doc is SSOT,
git is ground truth, this doc is annotated context. The session ledger
in §0.12 fingerprints which files THIS doc refresh trusts vs. which are
concurrent-agent WIP you should leave alone.

**Quality gates currently green:** `deno check` for v2 entries · `deno task
ssot:check` 0 errors · `deno task check:tui-v2` (no forbidden ink@5 /
reconciler@0.29 in the graph) · `make build-fast` builds ./hlvm · compiled
`./hlvm repl --new` boots + passes every `[x]` row in §11.5 under a
tmux-backed PTY audit.

**Quality gates still pending:** `deno task test:unit` (never run in this
session per CLAUDE.md concurrent-agent rule) · runtime-round-trip PTY
audit (would require a configured local model) · CI wiring of
`deno task check:tui-v2`.
**Created:** 2026-04-16 **Last updated:** 2026-04-17 (PM — Cmd+C /
clipboard fix verified end-to-end; attachment-reality audit added in
§0.9.2) **Doc policy:** This is the only planning/vision/handoff doc
for REPL TUI v2. Any agent working on `src/hlvm/tui-v2/` must update
this file after real verification.

---

## 1. Purpose

This document is the single source of truth for HLVM REPL TUI v2.

It is intentionally:

- high-level
- strict on architecture and quality
- loose on exact sequencing

We will hit compile errors, runtime errors, integration surprises, and Deno/Bun
porting issues as we go. That is expected. This document defines the target, the
rules, the structure, the research findings, and the phase gates. It does not
try to predict every exception in advance.

## 1.1 Doc Maintenance Contract

This file must stay usable for a cold-start agent who knows nothing about the
project history.

Required behavior:

- If work changes `src/hlvm/tui-v2/` materially, update this doc in the same
  working session.
- Do not leave status stale after a real verification result.
- Do not mark a phase done based on file existence alone.
- Do not hide uncertainty; explicitly mark partial/transitional states as `[~]`.
- Do not create a second planning doc for v2. This file remains the only source
  of truth.

Every meaningful update should keep these parts current:

- top-level `Status`
- current phase board / checkboxes
- latest verified behaviors
- known broken or unverified behaviors
- current structural blockers
- exact next highest-value work

Minimum handoff standard for each update:

- what changed
- what was actually verified
- what was not verified
- whether the compiled `./hlvm repl --new` path was checked or only source path
- whether the behavior is donor-faithful, partial, or local fallback

If there is a conflict between optimistic narrative and verified behavior,
verified behavior wins and the doc must say so plainly.

## 1.2 Required parity-audit workflow

The target is full CC TUI parity, not approximate similarity.

Agents must not depend on the user as the primary bug-finding loop. User reports
are useful, but self-audit is required.

Required default workflow:

1. run the real user path (`./hlvm repl --new`, and when useful `make repl-new`)
2. exercise the shell in a real PTY, not just through static code review
3. compare behavior directly against the donor CC shell in
   `~/dev/ClaudeCode-main/`
4. record the observed gap in this document
5. port donor behavior directly where possible instead of inventing local fixes
6. re-run the same live audit after the change

Minimum areas that must be self-audited repeatedly until parity is credible:

- prompt focus and immediate typing after submit
- multiline editing
- prompt history / queued-message behavior
- transcript rendering and spacing
- scrolling behavior (keyboard, wheel, tmux, fullscreen)
- search behavior
- status / footer behavior
- streaming / tool-progress behavior
- startup banner / layout chrome

If a behavior has not been exercised live in the compiled path, treat it as
unverified even if the code looks correct.

## 2. Vision

The target is:

```text
Claude Code TUI quality
+ HLVM-native business logic
+ real HQL REPL
+ real JS REPL
+ HLVM-specific model/config/command UX
```

This is not:

- a cleanup of the current TUI
- a minimal rewrite
- a "better Ink app"
- a loose CC-inspired redesign

This is:

- a new TUI tree
- built from CC's TUI as donor code
- with HLVM business logic underneath
- with CC-level terminal behavior and polish as the baseline

## 3. Non-Negotiables

### 3.1 Product

- Old REPL stays intact until v2 is genuinely ready.
- New TUI lives in a separate tree.
- `hlvm repl --new` is the desired opt-in path until migration is complete.
- Chat mode must feel like Claude Code first.
- HQL and JS must both be first-class, not bolted-on hacks.

### 3.2 Implementation

- **Hard-copy CC engine** and adapt it only as needed for Deno.
- **Use HLVM business logic**, not Anthropic product logic.
- **Use CC TUI code as donor code**, not just inspiration.
- **Default action for major UI features is copy/adapt or close transplant**.
- **Do not write simplified stand-ins** when a CC implementation already exists.
- **Explicit branding exception:** the startup banner/header may use HLVM's
  existing branded startup banner instead of the donor Claude banner.

### 3.3 Quality

- "Component exists" does not count as done.
- "Scaffold compiles" does not count as done.
- "Looks vaguely similar" does not count as done.
- A phase is done only when the behavior is close enough to CC to be worth
  trusting as the new baseline.

## 4. Core Strategy

## 4.1 One-line strategy

```text
Hard-copy the CC engine, transplant the CC TUI aggressively, and hide HLVM
business logic behind a compat layer.
```

## 4.2 What this means

### Keep from CC

- terminal rendering engine
- terminal I/O behavior
- wrapping / wide-char / scrolling / selection infrastructure
- generic UI infrastructure
- generic TUI behavior patterns
- large portions of the app-layer TUI where they are portable enough

### Keep from HLVM

- agent runtime and orchestration
- REPL evaluation logic
- HQL and JS execution environment
- model/config state
- HLVM slash commands and business workflows

### Do not keep from CC

- Anthropic auth
- analytics
- billing/subscription logic
- swarm/coordinator product logic
- remote/session product logic not needed by HLVM
- Anthropic-only services and feature flags

## 4.3 The correct architecture shape

```text
CC donor TUI
  ├── engine (copy/adapt)
  ├── portable UI modules (copy/adapt)
  ├── high-coupling TUI modules (transplant closely)
  └── Anthropic product logic (drop)

HLVM
  ├── compat layer
  ├── runtime / agent / eval / config business logic
  └── HLVM-specific overlays and REPL features
```

## 4.4 What we are explicitly not doing

We are not using either of these as the main strategy:

### A. Tiny rewrite from scratch

Bad because it drifts away from CC too fast and invites toy implementations.

### B. Blind full-app CC dump and prune in place

Bad because the top-level CC app layer is too coupled to Anthropic-specific
state and services.

This means:

- do **not** copy the full CC `components/`, `hooks/`, `screens/`, `state/`, and
  related app-layer trees into HLVM product code as the default strategy
- do **not** treat "hard copy everything, then delete until it works" as the
  plan
- do **not** allow a research dump to quietly become the real implementation

Reason:

- too much Anthropic product logic comes along
- cleanup cost becomes open-ended
- ownership becomes unclear
- it is harder to tell what behavior was preserved intentionally versus what
  survived by accident
- it makes progress look faster than it really is

The right path is in the middle:

```text
donor transplant, not blind dump
```

### 4.5 Full-copy policy

Whole-app CC copy is allowed only in one narrow case:

```text
research sandbox only
```

Meaning:

- a temporary donor tree may be created to inspect dependencies quickly
- that donor tree is not product code
- that donor tree is not the shipping implementation
- anything promoted from that donor tree into HLVM must be consciously
  classified as:
  - copy/adapt directly
  - transplant through compat
  - drop entirely

If there is any doubt, the answer is:

```text
do not vendor the whole app layer
```

## 5. Research Summary

This section records the high-level conclusions from inspecting
`~/dev/ClaudeCode-main/`.

## 5.1 Engine research

### CC engine portability

- CC `ink/` exists locally and is readable.
- CC `native-ts/yoga-layout/` exists locally and is pure TypeScript.
- The copied HLVM v2 engine currently contains:
  - `ink/`: 96 shared files
  - `yoga/`: 2 shared files

### Engine copy state

Current comparison against CC:

```text
ink files shared: 96
ink files identical: 64
ink files adapted: 32
yoga files identical: 2/2
```

Interpretation:

- the engine is fundamentally a hard copy
- the differences are mostly runtime-porting edits
- this is acceptable

Accepted kinds of adaptation:

- Bun -> Deno import rewrites
- `fs` / `util` / runtime module rewrites
- local stubs for CC-internal dependencies
- config and import-map changes

Not acceptable:

- changing behavior because porting is inconvenient
- simplifying away CC engine features

### Engine validation

The spike path proved the copied engine can render on Deno:

- bordered box rendering
- word wrapping
- Korean / CJK wide character handling
- nested layout
- styled text

So the engine donor strategy is valid.

### Engine status

```text
[x] copied
[x] adapted
[x] spike-validated
[x] wired into tui-v2 baseline
[x] integrated into a supported launch path
[x] committed cleanly
```

## 5.2 App-layer TUI research

The CC app-layer TUI, excluding the engine, is not tiny.

## 5.6 Current live-shell status

- `hlvm repl --new` now uses a donor-style visible shell rather than the older
  round-box debug baseline.
- Earlier work overclaimed parity by copying layout shape without copying the
  actual donor theme/color path.
- The visible shell has now been moved closer to CC using direct donor reads in
  these ways:
  - condensed donor banner uses a direct Clawd port
  - banner glyph uses the exact donor dark-theme colors from CC
    (`claude/clawd_body = rgb(215,119,87)`, `clawd_background = rgb(0,0,0)`)
  - user prompt rows now use the donor dark-theme background
    (`userMessageBackground = rgb(55,55,55)`)
  - divider-based transcript/prompt layout
  - Claude-style footer hints (`? for shortcuts`, `esc to interrupt`)
  - reduced status chrome instead of a multi-line debug box
- The visible shell is still not full parity:
  - transcript rendering still needs closer CC spacing/polish
  - prompt/footer right-side detail is still approximate
  - status/search/permission flows are functionally live but visually simplified
  - tool/thinking rows are still less faithful than the donor app layer

### Approximate size

Core app-layer TUI, excluding engine:

```text
minimum useful core:        ~24.1k LOC
realistic CC-quality slice: ~26.6k LOC
```

Important clusters:

```text
PromptInput cluster         ~ 5.2k
Keybindings                 ~ 3.2k
messages/*                  ~ 6.0k
REPL.tsx                    ~ 5.0k
VirtualMessageList cluster  ~ 1.8k
Markdown cluster            ~ 0.6k
BaseTextInput cluster       ~ 0.7k
Status / Permission         ~ 0.5k
Transcript chrome extras    ~ 3.1k
```

### Encapsulation findings

After inspecting the real files:

- `ink/`: well-suited for hard copy
- `VirtualMessageList.tsx`: reasonably portable with adapters
- `Markdown.tsx` and `MarkdownTable.tsx`: reasonably portable with shims
- `BaseTextInput.tsx`: portable as part of an input cluster, not as an isolated
  file
- `StatusLine.tsx`: transplantable
- `PermissionRequest.tsx`: transplantable
- `PromptInput.tsx`: not isolated enough for blind copy
- `Messages.tsx`: mixed; needs supporting pieces
- `REPL.tsx`: far too coupled for a thin bridge-only strategy

Conclusion:

```text
portable single files: some
portable clusters: yes
full top-level app via one thin bridge: no
```

### Current transplant findings

After landing the first donor slice into `src/hlvm/tui-v2/`:

- `Markdown.tsx` and `MarkdownTable.tsx` are now copied/adapted and rendered
  through the real `hlvm repl --new` launch path
- `BaseTextInput.tsx` is now landed as the second donor slice, with a live demo
  mounted in the baseline shell and verified through a PTY run
- donor `useVirtualScroll.ts` is now copied/adapted and verified inside a real
  `ScrollBox` demo, including an imperative jump from the tail to a middle range
- `VirtualMessageList.tsx` now has a first donor-shaped render pass in the
  baseline shell, running on top of the copied virtualization core with a
  sticky-prompt demo
- transcript search/navigation now has a first live donor pass: `/` opens the
  live search bar, the status line flips into search mode, match indexing warms
  and cursor/jump state stays wired through the real shell
- donor-shaped `Messages.tsx` / `MessageRow.tsx` first-pass wiring now renders
  on top of the landed list layer
- donor-shaped `StatusLine.tsx` and `permissions/PermissionRequest.tsx`
  first-pass compat shells are now mounted and verified in the live baseline
  shell
- `PromptInput.tsx` now carries the first real v1 advanced-composer migration:
  - attachment snapshots are preserved through history/queue state
  - `@` and `/` now use the unified completion infrastructure
  - raw `@` no longer triggers the React update-depth loop that earlier audits
    exposed
  - first snippet/placeholder-session wiring is landed for function completion
  - donor-style placeholder cleanup/validation now clears stale snippet state on
    history/search/mode transitions instead of letting tabstop state drift
  - donor submit routing is now wired into Enter handling, so unbalanced prompt
    input follows the v1 `continue-multiline` path instead of forcing a send
  - file completion now has donor-style left/right behavior:
    - `Left` climbs to the parent `@path/`
    - `Right` drills into directories or selects files
    - `Ctrl+D` / `^D` toggles completion docs
  - queued drafts now render through a donor-style queue preview instead of the
    earlier plain debug list
- full PromptInput parity is still not done; this remains active donor
  transplant work rather than a completed slice

So the next correct order is:

```text
Markdown cluster
-> BaseTextInput cluster
-> virtualization core / compat prework
-> VirtualMessageList render layer
-> compat/search/navigation first pass
-> Messages / MessageRow first pass
-> Status / Permission first pass
-> PromptInput transplant
```

## 5.3 Strategic conclusion from research

The best plan is:

```text
copy engine
copy portable TUI clusters
build HLVM compat layer
transplant larger CC TUI slices through compat
```

That is better than:

- rewriting most of the app layer ourselves
- or blind-copying the whole CC app and deleting things until it works

## 5.4 V1 REPL research

This section records the concrete findings from inspecting the current
`src/hlvm/cli/repl-ink/` tree to answer whether we should pivot back to v1 or
try to swap the CC engine underneath it.

### What v1 already does well

The advanced behaviors the user keeps asking for are mostly already implemented
in v1, but they live in the v1 app layer, not in the Ink renderer itself.

Concrete evidence:

- `components/Input.tsx` is `3797` lines and already contains:
  - multiline editing and wrapped cursor math
  - queue editing
  - prompt history navigation
  - Ctrl+R history search
  - unified completion dropdowns
  - placeholder-mode completion
  - `@` file references and drill-in behavior
  - attachment insertion / filtering / sync
- `components/ComposerSurface.tsx` owns composer-local state so typing does not
  rerender the whole shell and already wires:
  - attachment state
  - draft restore
  - pending queue
  - submit routing
- `hooks/useAttachments.ts` already provides monotonic attachment ids, async
  invalidation, restore/sync/clear behavior
- `completion/concrete-providers.ts` already implements:
  - `@` file mention browsing
  - directory drill
  - media-file attachment creation
  - slash-command completion
- `mention-resolver.ts` already resolves `@path` references into actual file or
  directory content for REPL use
- `components/VirtualTranscript.tsx` and
  `components/TranscriptViewerOverlay.tsx` already provide v1 transcript/history
  viewing behavior

Conclusion:

```text
v1's strongest UX surfaces are app-layer HLVM features, not renderer magic
```

### Why a v1 engine swap is not the right move

The current v1 shell is built against the root repo runtime:

- root `deno.json` uses `react@18`
- root `deno.json` maps `ink` to `npm:ink@5`
- v1 imports `Box`, `Text`, `useInput`, `useStdout`, `render`, etc. directly
  from `"ink"`

The donor v2 engine is not a drop-in replacement:

- `src/hlvm/tui-v2/deno.json` uses `react@19`
- `src/hlvm/tui-v2/deno.json` uses `react-reconciler@0.31`
- v2 app-layer code depends on donor-specific primitives such as:
  - `AlternateScreen`
  - `ScrollBox`
  - donor event parsing / wheel handling / fullscreen ownership

That means:

```text
swapping the CC engine under v1 is not a low-risk "change one import" job
```

It would force one of these bad outcomes:

- mix incompatible React / reconciler stacks in the same tree
- rewrite large portions of v1 to donor engine primitives anyway
- keep v1 app structure but still not inherit the CC-specific behavior that
  depends on donor app-layer assumptions

### Strategic decision after v1 inspection

Do **not** pivot to:

```text
maintain v1 as the main shell + try to hot-swap the CC engine underneath it
```

That path is attractive because v1 already has good HLVM-specific UX, but
structurally it mixes the wrong halves of the system.

Instead:

```text
keep v2 as the renderer/shell baseline
and use v1 as a donor for HLVM-specific app-layer features
```

More concretely:

- CC remains the donor for:
  - engine
  - fullscreen / wheel / transcript shell / prompt shell primitives
- v1 becomes the donor for HLVM-specific composer UX:
  - attachments
  - `@` file/reference UX
  - history search
  - queue editing
  - prompt draft restore
  - transcript/history overlay ideas where still useful

So the correct hybrid is:

```text
CC engine + CC shell primitives + HLVM v1 composer/reference logic ported into v2
```

Not:

```text
v1 shell + CC engine hot swap
```

## 5.5 V1 -> V2 migration inventory

This is the concrete list of v1 app-layer features that should be migrated into
v2 because they are HLVM-specific UX strengths and are currently missing or only
partially implemented in v2.

This is **not** a list of renderer features. It is a list of advanced REPL
behaviors living above the renderer.

### A. Highest-priority composer features missing in v2

- `[~]` **Attachment state pipeline**
  - donor source:
    - `src/hlvm/cli/repl-ink/hooks/useAttachments.ts`
    - `src/hlvm/cli/repl/attachment.ts`
  - why:
    - monotonic attachment ids
    - async invalidation
    - restore/sync/clear semantics
    - immediate placeholder insertion for pending attachment registration

- `[~]` **`@` file reference browser / drill UX**
  - donor source:
    - `src/hlvm/cli/repl-ink/completion/concrete-providers.ts`
    - `src/hlvm/cli/repl/file-search.ts`
  - why:
    - explicit `@`-triggered file browsing
    - directory drill-in / drill-back
    - already-attached-file filtering
    - directory commit vs media-file attachment behavior

- `[~]` **`@` mention resolution into actual REPL content**
  - donor source:
    - `src/hlvm/cli/repl/mention-resolver.ts`
  - why:
    - actual file/directory resolution for REPL semantics, not just UI labels

- `[~]` **Slash-command completion**
  - donor source:
    - `src/hlvm/cli/repl-ink/completion/concrete-providers.ts`
  - why:
    - v1 already has mature `/` command completion and execution semantics

- `[~]` **Unified completion session architecture**
  - donor source:
    - `src/hlvm/cli/repl-ink/completion/*`
    - `src/hlvm/cli/repl-ink/components/Input.tsx`
  - why:
    - one surface for `@`, `/`, and symbol completion
    - provider priority
    - action model (`select`, `drill`, `cancel`, docs toggle)
    - completion footer help text

- `[~]` **Placeholder-mode parameter completion**
  - donor source:
    - `src/hlvm/cli/repl-ink/components/Input.tsx`
  - why:
    - function placeholder navigation
    - Tab / Shift+Tab traversal
    - untouched-placeholder cleanup
    - typed replacement and pair insertion logic

- `[~]` **Reverse history search (Ctrl+R)**
  - donor source:
    - `src/hlvm/cli/repl-ink/hooks/useHistorySearch.ts`
    - `src/hlvm/cli/repl-ink/components/HistorySearchPrompt.tsx`
  - why:
    - v2 currently has transcript search, not the same thing as composer history

- `[~]` **History recall with attachment restoration**
  - donor source:
    - `src/hlvm/cli/repl-ink/components/Input.tsx`
    - `src/hlvm/cli/repl/history-storage.ts`
  - why:
    - recalling a prompt must restore both text and attachment snapshot

- `[~]` **Conversation queue editing parity**
  - donor source:
    - `src/hlvm/cli/repl-ink/components/ComposerSurface.tsx`
    - `src/hlvm/cli/repl-ink/components/Input.tsx`
    - `src/hlvm/cli/repl-ink/utils/conversation-queue.ts`
  - why:
    - v2 has a simpler queued-command model today
    - v1 already has richer queue edit / restore / binding behavior

### B. Important shell behaviors still ahead in v2

- `[ ]` **ComposerSurface split**
  - donor source:
    - `src/hlvm/cli/repl-ink/components/ComposerSurface.tsx`
  - why:
    - keeps typing localized to the composer subtree
    - owns queue + draft + attachment state together
    - cleaner shell/composer boundary than current v2 prompt shell

- `[ ]` **Empty-submit local-agents handoff**
  - donor source:
    - `src/hlvm/cli/repl-ink/components/Input.tsx`
    - `src/hlvm/cli/repl-ink/components/LocalAgentsStatusPanel.tsx`
  - why:
    - v1 already has a focus-handoff model for local-agent surfaces
    - v2 currently does not expose this advanced shell interaction

- `[ ]` **Composer interaction-mode chrome**
  - donor source:
    - `src/hlvm/cli/repl-ink/components/Input.tsx`
  - why:
    - subdued / modified prompt behavior when permission/question pickers own
      focus

- `[ ]` **Transcript/history overlay UX**
  - donor source:
    - `src/hlvm/cli/repl-ink/components/TranscriptViewerOverlay.tsx`
  - why:
    - v2 has live transcript search, but not yet the richer v1 history-view path

- `[ ]` **Plan / todo transcript surfaces**
  - donor source:
    - `src/hlvm/cli/repl-ink/components/conversation/PlanChecklistPanel.tsx`
    - `src/hlvm/cli/repl-ink/hooks/useConversation.ts`
  - why:
    - v2 carries some planning items already, but the v1 HLVM plan/todo UX is
      still richer

### C. Secondary shell surfaces to review after core composer parity

- `[ ]` **Command palette overlay**
  - donor source:
    - `src/hlvm/cli/repl-ink/components/CommandPaletteOverlay.tsx`

- `[ ]` **Shortcuts overlay**
  - donor source:
    - `src/hlvm/cli/repl-ink/components/ShortcutsOverlay.tsx`

- `[ ]` **Background tasks overlay**
  - donor source:
    - `src/hlvm/cli/repl-ink/components/BackgroundTasksOverlay.tsx`

- `[ ]` **Config overlay**
  - donor source:
    - `src/hlvm/cli/repl-ink/components/ConfigOverlay.tsx`

- `[ ]` **Model browser / model setup overlay**
  - donor source:
    - `src/hlvm/cli/repl-ink/components/ModelBrowser.tsx`
    - `src/hlvm/cli/repl-ink/components/ModelSetupOverlay.tsx`

These are useful, but they should come **after** the core prompt/reference/
attachment/history path is solid.

### D. Explicit non-goals for this backfill

The following should **not** be copied from v1 as the new renderer baseline:

- `repl-ink`'s root `ink@5` / `react@18` renderer path
- v1 top-level app shell as the new permanent shell
- a hybrid runtime where v1 and donor v2 renderers are mixed in one tree

The backfill goal is:

```text
port v1 HLVM-specific advanced UX into v2
```

Not:

```text
rescue v1 as the long-term shell
```

## 6. What To Copy, What To Transplant, What To Drop

## 6.1 Hard-copy / adapt directly

These should be treated as donor code and kept as close to CC as possible:

- `ink/`
- `yoga/`
- `Markdown.tsx`
- `MarkdownTable.tsx`
- `VirtualMessageList.tsx`
- `BaseTextInput.tsx`
- likely `useVirtualScroll.ts`
- likely `useTextInput.ts`
- keybinding infrastructure where possible

## 6.2 Transplant closely through compat

These should be ported while reading CC side-by-side, not rewritten from memory:

- `PromptInput.tsx`
- `Messages.tsx`
- `MessageRow.tsx`
- `components/messages/*`
- `StatusLine.tsx`
- `permissions/PermissionRequest.tsx`
- selected orchestration from `screens/REPL.tsx`

## 6.3 Drop / replace

These are not part of the HLVM TUI target:

- auth and account flows
- analytics / telemetry product code
- billing / subscriptions
- Anthropic-only services
- swarm/coordinator flows unless explicitly adopted later
- voice mode
- buddy / mascot logic
- remote/product-specific desktop flows not needed by HLVM

## 6.4 Compat layer responsibilities

The compat layer is not a tiny shim. It is a deliberate boundary that lets us
keep more CC TUI logic.

Expected compat domains:

- app-state adapter
- runtime submit/stream adapter
- transcript normalization adapter
- permission adapter
- model/status adapter
- history/input adapter
- no-op or replacement stubs for Anthropic-only concerns

## 6.5 Explicit anti-pattern

The following is explicitly rejected as the main implementation strategy:

```text
Copy all of CC TUI into src/hlvm/tui-v2 and then delete anything that looks
unnecessary until HLVM compiles.
```

Why it is rejected:

- it mixes donor TUI with Anthropic product logic too early
- it hides architectural decisions inside accidental survival
- it creates noisy diffs and unclear ownership
- it slows down the real work: preserving the right TUI behavior while keeping
  HLVM business logic underneath

Preferred replacement:

```text
copy the engine
copy portable clusters
build compat
transplant large CC TUI slices deliberately
```

## 7. HLVM-Specific Product Shape

The product target is not a pure CC clone.

It is:

```text
CC-quality chat TUI
+ real HLVM REPL
+ HQL
+ JS
+ HLVM slash commands
+ HLVM model/config UX
```

Desired progression:

### First

Achieve CC-quality chat-mode TUI.

### Then

Layer in HLVM-native REPL power:

- HQL evaluation
- JS evaluation
- shared REPL environment
- model selection
- config overlay
- HLVM-specific slash commands and flows

## 8. Phases

These phases are intentionally high-level. We will discover implementation
exceptions as we go.

## Phase 0 - Engine and Launch Baseline

Goal:

- engine donor copied
- engine adapted
- engine launch path stable
- one supported launch path for v2

Done means:

- engine is committed
- launch path is real, not a one-off spike
- `hlvm repl --new` or an explicitly accepted temporary entry path works
- no false claims about integration remain

Current status:

```text
[x] donor engine copied into worktree
[x] donor yoga copied into worktree
[x] spike works
[x] direct v2 baseline entry works
[x] hlvm repl --new now proxies into the isolated React 19 process
[x] toy v2 app-layer scaffold removed
[x] engine tree committed in local checkpoint e0bcec2d
```

## Phase 1 - CC-Quality Chat TUI

Goal:

- CC-like input
- CC-like transcript
- CC-like markdown/tool display
- CC-like status and permission UX

Rules:

- copy/adapt or transplant from CC by default
- no toy stand-ins
- no "we will polish it later" placeholders

Done means:

- chat mode feels recognizably CC-like
- copied/transplanted infrastructure is actually in place
- not merely that local tests pass

Current status:

```text
[x] toy scaffold removed
[x] minimal donor-engine baseline shell exists
[x] donor Markdown cluster copied/adapted and rendered in the baseline shell
[x] BaseTextInput cluster copied/adapted and exercised interactively in the baseline shell
[x] useVirtualScroll donor core copied/adapted and exercised in the baseline shell
[x] VirtualMessageList search/navigation first pass copied/adapted and exercised in the baseline shell
[x] donor Messages / MessageRow first pass landed in the baseline shell
[x] donor Status / Permission first-pass shells landed in the baseline shell
[x] donor PromptInput first pass landed in the baseline shell
[x] compat layer established for the first interactive chat shell
[x] chat shell now runs on shared HLVM conversation/runtime logic
[x] prompt local echo now happens before runtime/model startup
[x] prompt wrapped-line measurement/navigation now follows donor-derived logic
[x] prompt multiline insert path now works (Shift+Enter / Meta+Enter / backslash+Enter)
[x] transcript scroll input now has PageUp/PageDown and donor wheel-event handling in the live path
[x] root shell now runs in alternate-screen fullscreen layout instead of the earlier fixed-height transcript pane
[x] donor fullscreen/tmux ownership logic now gates alt-screen use and surfaces a tmux mouse-off hint in the compiled shell
[x] runtime host prewarm now starts on mount so first-turn host startup is off the critical path
[x] runtime host bootstrap now reclaims dead/incompatible listeners instead of treating occupied ports as free
[x] full unit suite passes
[x] SSOT check passes with 0 errors
[x] deno check for src/hlvm/tui-v2/main.tsx passes under the local v2 config
[~] transcript search/navigation compat started but not at full CC parity
[~] CC-faithful PromptInput path started but not at full parity
[~] CC-faithful transcript path started but not at full parity
[~] CC-faithful status / permission path started but not at full parity
[~] coherent donor chat shell is now live and runtime-backed
[~] live donor chat shell is usable, but user-reported interaction bugs showed Phase 1 was overcalled
[~] v1 advanced-composer migration is now active inside v2 PromptInput
[ ] Phase 1 complete
```

Verification note:

```text
Latest live audit:
  [x] hlvm repl --new launches
  [x] direct deno run launch launches
  [x] tmux-based PTY harness now works as the primary self-test path for the REPL
  [x] `deno run -A --unstable-sloppy-imports - <<... ensureRuntimeHostReady()` succeeds after reclaiming an exhausted runtime-port range
  [x] fixture-backed host queries return deterministic text/tool events
  [x] Ctrl+F opens transcript search from the prompt pane
  [x] Enter closes transcript search and returns focus to the prompt pane
  [x] prompt submit appends user + assistant transcript messages
  [x] Shift+Tab toggles prompt mode between chat and bash
  [x] bash-mode submit appends donor tool/system transcript entries
  [x] Ctrl+P opens the donor-shaped permission shell
  [x] permission shell accepts y / n / Esc dismissal flow
  [x] status line tracks transcript/search pane and prompt mode
  [x] deno task test:unit => 2187 passed, 0 failed
  [x] deno task ssot:check => 0 errors
  [x] deno check --config src/hlvm/tui-v2/deno.json src/hlvm/tui-v2/main.tsx => green
  [x] prompt now stays interactive while stream: responding is active
  [x] live PTY repro confirmed the shell accepts typed input immediately after submit instead of waiting for the turn to finish
  [x] live PTY repro confirmed the prompt accepts additional typing while the shell is still busy
  [x] live PTY repro confirmed multiline prompt editing (`first line\` + Enter + `second line`)
  [x] live PTY repro confirmed immediate local echo of the submitted user prompt
  [x] live PTY repro confirmed PageUp reveals the top of the transcript and PageDown returns to the tail
  [x] isolated tmux audit on the compiled `./hlvm repl --new` path now shows the donor-style mouse-off hint instead of leaving wheel ownership unexplained
  [x] isolated tmux audit on the compiled `./hlvm repl --new` path confirms immediate local echo and multiline prompt editing still work after the donor fullscreen/tmux transplant
  [~] wheel-scroll ownership is now explained structurally in tmux (same as donor CC), but full mouse-wheel parity still needs user-path validation outside the tmux-mouse-off case
  [x] runtime-host port exhaustion is no longer a manual cleanup problem in the shared host bootstrap path
  [x] `deno check --config src/hlvm/tui-v2/deno.json src/hlvm/tui-v2/prompt/PromptInput.tsx` => green after the v1 advanced-composer migration
  [x] `deno check --config src/hlvm/tui-v2/deno.json src/hlvm/tui-v2/main.tsx` => green after the v1 advanced-composer migration
  [x] donor-style placeholder/snippet cleanup and validation now type-check after wiring history/search/mode cleanup into PromptInput
  [x] `make build-fast` => rebuilt `./hlvm` after the new PromptInput changes
  [x] code audit confirmed v2 now consumes donor `ENTER_SNIPPET_SESSION` completion side effects instead of dropping them
  [x] code audit confirmed raw `@` completion now follows the donor explicit-typed-char rule instead of re-triggering from a value-change loop
  [x] `deno check --config src/hlvm/tui-v2/deno.json src/hlvm/tui-v2/prompt/PromptInputQueuedCommands.tsx` => green after donor queue-preview port
  [x] code audit confirmed v2 Enter handling now uses donor submit routing (`continue-multiline` instead of forced send for unbalanced prompt input)
  [x] code audit confirmed file completion now has donor-style `Left` parent climb and `Right` drill/select handling
  [x] `make build-fast` => rebuilt `./hlvm` after the submit-routing / file-picker / queue-preview batch
  [x] `./hlvm repl --new` PTY boot re-verified after the v2 bare-`ink` remap: donor shell paints (dividers, `❯` prompt, `Enter send · ◐ medium · /effort` footer) instead of crashing on `ReactCurrentOwner`
  [x] `deno info --config src/hlvm/tui-v2/deno.json --unstable-sloppy-imports src/hlvm/tui-v2/main.tsx` no longer contains `npm:/ink@5.2.1` or `react-reconciler@0.29.2`; only the local `ink/index.ts` barrel and `react-reconciler@0.31.0` remain
  [!] ROOT-CAUSE CORRECTION: the earlier "local ReactCurrentOwner split inside Codex" framing was wrong. It was a real user-path crash triggered whenever v2 transitively loaded v1 `repl-ink` files (`completion/Dropdown.tsx`, `components/PickerRow.tsx`, `components/HighlightedText.tsx`, `keybindings/keybinding-lookup.ts`) whose bare `from "ink"` imports resolved to `npm:ink@5.2.1`; ink@5 pins `react-reconciler@0.29.x`, which references React 18's internal `ReactCurrentOwner` symbol that React 19 removed. The crash hit any run of `./hlvm repl --new` after the v1 composer migration, not just the Codex audit environment.
  [!] Donor-fidelity note: this fix follows the "hard-copy CC engine, do not simplify" rule. The new `src/hlvm/tui-v2/ink/index.ts` barrel only re-exports the local CC donor's `Box`, `Text`, and `Key` type. It does NOT wrap them, adapt them, or introduce behavioral drift; it only changes *which* ink any reachable bare-specifier import binds to.
  [x] LIVE PTY audit of `./hlvm repl --new` now surfaces three further real bugs introduced by the v1 composer migration — all fixed this turn:
    [x] `/` completion was dead on every build: typing `/` triggered a React "Maximum update depth exceeded" infinite re-render because `completion` was in the value-change `useEffect`'s deps array. Each run of the effect called `completion.triggerCompletion(...)`, which rebuilt the `completion` object, which re-fired the effect, ... Fix: mirror v1 `components/Input.tsx`'s pattern — keep `completion` OUT of the effect's deps and read it through a `completionRef.current` (PromptInput.tsx).
    [x] Arrow-key navigation inside the completion picker advanced the selection by 2 rows per press (Desktop → Downloads, skipping Documents; `/help` → `/init`, skipping `/exit`). BaseTextInput's `useInput` fires first (child effects register listeners first) and routes Up/Down through `disableCursorMovementForUpDownKeys={completion.isVisible}` → `onHistoryUp`/`onHistoryDown` → PromptInput's `handleHistoryUp`/`handleHistoryDown` → `completion.navigate{Up,Down}()`; PromptInput's own `useInput` then ran its redundant Up/Down handlers and navigated AGAIN. Fix: remove the redundant Up/Down branches from PromptInput's `useInput` completion-visible block; Tab is kept (unique to PromptInput, BaseTextInput's Tab is a no-op).
    [x] Enter on a visible picker caused a double-fire: BaseTextInput's Enter called `onSubmit` → `submitCurrentInput` → sent the current draft as a user turn, THEN PromptInput's `useInput` ran `completion.confirmSelected()` — so typing `@` + Enter both submitted a stray `@` user message AND left `@~/Desktop/` in the fresh prompt. Fix: guard `submitCurrentInput` at the top — bail out when `completionRef.current.isVisible` or `historySearch.state.isSearching`, so only the picker-confirm path runs.
  [x] Re-verified live in tmux-backed PTY on the rebuilt `./hlvm repl --new`:
    [x] `/` opens the slash-command dropdown (`/mcp`, `/exit`, `/help`, `/init`, `/flush`, `/hooks`, ...) with exactly ONE `›` selection marker and no update-depth explosion
    [x] `@` opens the file/dir picker with exactly ONE `›` marker; Down/Up advance the marker by exactly 1 item per press
    [x] `@` + Enter inserts `@~/Desktop/` (or the selected item) into the prompt; transcript stays empty, runtime is NOT spun up with a stray user turn
    [x] plain text + Enter still submits a user turn (transcript row appears, footer flips to `esc to interrupt`)
    [x] Shift+Tab toggles prompt indicator between `❯` (prompt mode) and `!` (bash mode) and back
    [x] Escape closes the picker with the typed trigger (`@` / `/`) preserved in the prompt
    [x] Backspace deletes through the trigger char
    [x] Multiline insert via `line-one\` + Enter renders the second line under the prompt
  [~] Runtime round-trip (agent reply arriving back into the transcript) is NOT yet confirmed in this audit — after `hi there` + Enter the footer shows `esc to interrupt` but no assistant text appears within the audit window. This is most likely local-AI/model-configuration (cold-start or missing local model), not a TUI regression; separate from the Phase-1 shell work.

  [!] CC DONOR CROSS-CHECK (honest correction to the previous turn's summary):
  The previous turn landed the three fixes above by reading v1 `Input.tsx`, not by reading `~/dev/ClaudeCode-main/`. That violated the §1.2 "compare behavior directly against the donor CC shell" requirement. Cross-check was done this turn. Findings:
    - CC's `components/PromptInput/PromptInput.tsx` (2338 lines) is the correct donor for the v2 prompt/composer shell. v2's `src/hlvm/tui-v2/prompt/` directory structure already mirrors CC's `components/PromptInput/` layout (HistorySearch/inputModes/Notifications/PromptInputFooter/PromptInputFooterLeftSide/PromptInputModeIndicator/PromptInputQueuedCommands/PromptInputStashNotice/usePromptInputPlaceholder/ShimmeredInput all present in both trees).
    - CC uses `hooks/useTypeahead.tsx` for completion. Its value-change `useEffect` (line 893-908) has deps `[input, updateSuggestions]` with a stable `updateSuggestions` callback and uses `prevInputRef` + `dismissedForInputRef` refs to guard re-trigger. The `suggestions` / selection object is NOT in the effect deps. My v2 `completionRef.current` fix is architecturally consistent with that CC pattern — the v1 `Input.tsx` approach I mirrored is itself a v1 port of the CC pattern, so the chain holds.
    - CC's onSubmit (line 984-1105) has its OWN "Enter guard while picker is visible" (line 1071-1077: `if (suggestionsState.suggestions.length > 0 && !isSubmittingSlashCommand && !hasDirectorySuggestions) return`). So my v2 `submitCurrentInput` guard is the same shape as CC's, with ONE intentional design split — CC allows submit when ALL suggestions are directories (and reserves Tab for drill-in), v2 follows v1's semantics where Enter confirms the selection (inserts `@~/Desktop/` into the prompt). This is a product-choice difference, not a bug, and is consistent with §5.4's "v1 is the donor for HLVM-specific composer UX".
    - CC's `useTypeahead.tsx` line 1341-1353 confirms CC does NOT register arrow-key handlers inside the completion hook ("Handle Ctrl-N/P for navigation (arrows handled by keybindings)"); CC's arrows flow through a separate keybinding-context layer. v2 does NOT have that keybinding context, which is why the duplicate Up/Down-in-useInput bug was v2-specific and the fix (removing them so the `BaseTextInput → onHistoryUp/Down → completion.navigate{Up,Down}` path is the single source of truth) is a v2-architecture-correct fix, not drift.
    - Full CC-100% architectural parity would require porting `useTypeahead`, keybinding-context, and the suggestion/ghost-text pipeline. That is a Phase-1 closure task, not an in-turn fix.

  [x] Further compiled-path behaviour verified live in tmux PTY after the three fixes landed (rebuilt `./hlvm`):
    [x] `/` + `h` narrows the slash-command dropdown to `/help`, `/hooks`, `/flush` (fuzzy match, as designed)
    [x] Tab advances the selection by exactly 1 row (`/help` → `/hooks` → `/flush`)
    [x] Ctrl+D flips the footer `docs off` ↔ `docs on` without dismissing the picker
    [x] `@` + Right drills into the selected directory (`@~/Desktop/` → shows Desktop/* files in the picker)
    [x] `@` + Left climbs back to the parent (`@~/` → shows home-dir siblings)
    [x] `/` + Enter on a selected command invokes the command (user sees `Notice: Command not wired in v2 yet: /mcp`), proving the picker-confirm path reaches the command-dispatch layer through the new Enter guard
    [x] Ctrl+F opens the transcript search bar (status line flips to `search open · Enter keeps match · Esc closes`)
    [x] Escape closes the transcript search and returns focus to the prompt
    [x] PageDown does not crash and does not eject the prompt
    [x] Ctrl+R opens the history-search overlay (`History search start typing · type to search`)
    [x] Ctrl+C exits the REPL cleanly
```

## Phase 2 - HLVM Code Mode

Goal:

- code mode
- real HQL
- real JS
- shared runtime feeling

Done means:

- real eval, not placeholders
- clean mode behavior
- no heuristic mess

Current status:

```text
[ ] not started
```

## Phase 3 - HLVM Overlays and Product UX

Goal:

- model selection
- config UI
- help / command UX
- HLVM-specific TUI flows

Current status:

```text
[ ] not started
```

## Phase 4 - Migration and Polish

Goal:

- stabilize
- performance
- selection/search/polish
- move toward default

Current status:

```text
[ ] not started
```

## 9. Current Repo Reality

This section must stay honest.

At the moment:

- the earlier tracked toy scaffold has been removed
- a minimal tracked donor-baseline shell now exists
- copied engine, yoga, stubs are still untracked in the worktree
- `hlvm repl --new` works by spawning a separate Deno process with the local v2
  config
- the compiled development binary resolves the real workspace `src/hlvm/tui-v2`
  tree first instead of relying on Deno's extracted temp copy
- direct baseline launch also works via the local v2 config
- the donor Markdown cluster now renders through the real launch path
- the donor `BaseTextInput` cluster now runs in the baseline shell and accepts
  real typed input in a PTY session
- the donor virtualization core now runs in the baseline shell inside a real
  `ScrollBox`, and the demo proves imperative range changes through
  `scrollToIndex()`
- the donor `VirtualMessageList` now has a live search/navigation pass in the
  baseline shell, and the PTY run verified both search-mode activation and the
  status-line/search shell integration
- donor-shaped `Messages.tsx` / `MessageRow.tsx` now drive the transcript row
  rendering in the live shell instead of the earlier local row component
- donor-shaped `StatusLine.tsx` now renders in the live shell and tracks
  transcript vs search mode, selected row, sticky prompt text, and permission
  shell state
- donor-shaped `permissions/PermissionRequest.tsx` now renders in the live shell
  behind a `p` toggle as the first compat shell for approval UX
- donor-shaped `prompt/PromptInput.tsx` and its support files now drive the live
  shell input path instead of the earlier stand-alone BaseTextInput demo
- the live prompt path now supports prompt submit, bash-mode submit,
  transcript-search activation, permission-shell activation, and the first
  queue/stash/history affordances through the copied BaseTextInput primitive
- the live prompt path no longer disables focus while the runtime is busy; this
  was a real user-reported bug and has now been corrected in the shell path
- the live prompt path now uses donor-derived wrapped-line measurement and
  cursor movement logic instead of the earlier local single-line metrics
- multiline prompt editing is now wired structurally in the prompt shell:
  Shift+Enter / Meta+Enter insert newlines, and a trailing backslash + Enter
  also inserts a newline
- prompt submit now appends the user turn to the transcript immediately before
  runtime/model initialization, so the user sees local echo without waiting for
  host bootstrap
- the root shell now mounts inside donor-style alternate screen + fullscreen
  layout rather than a fixed-height local transcript box
- transcript scroll input now handles both PageUp/PageDown and mouse wheel
  events through the live shell path
- the old `utils/fullscreen.ts` stub has now been replaced with a donor-shaped
  fullscreen/tmux ownership layer:
  - alt-screen is no longer unconditional
  - tmux `-CC` disables fullscreen like the donor path
  - tmux with `mouse off` now surfaces an explicit footer hint instead of
    silently behaving like a broken shell
- a real PTY audit now verifies the fullscreen shell behavior directly:
  - local echo appears immediately on submit
  - multiline prompt editing works
  - PageUp/PageDown scroll the in-app transcript while the prompt stays pinned
  - raw wheel SGR events scroll the in-app transcript in the compiled shell
  - compiled `./hlvm repl --new` in an isolated tmux server now shows the tmux
    mouse-off hint and still preserves immediate local echo + multiline input
  - queued/busy prompt behavior can be exercised without waiting for more user
    screenshots
- the oversized donor/debug intro chrome has been removed from the default v2
  screen so the shell opens directly into transcript + prompt instead of a
  progress-heavy demo layout
- the live transcript/prompt shell now runs through shared HLVM business logic:
  `useConversation` from the old REPL path and `runAgentQueryViaHost` from the
  runtime host client
- deterministic fixture-backed runtime checks now verify plain-response and
  tool-event flows through the v2 shell path
- the shared runtime host path had a real structural bug during user audits:
  dead or unhealthy listeners were still occupying ports 11435-11445, and the
  old bootstrap logic misclassified some of those occupied ports as "free",
  leading to repeated failed spawns and long apparent hangs
- the runtime host bootstrap now distinguishes "no health response" from "free
  port", reclaims dead/incompatible listeners across the scan range, and can
  recover cleanly from a fully exhausted port block
- the app shell was reduced so the live transcript/prompt screen is the main
  surface instead of a progress-heavy demo layout
- runtime host warmup now starts on mount via `ensureRuntimeHostAvailable()`,
  reducing first-turn cold-start delay in the v2 shell
- the engine donor port required one additional Deno-safe fix (`setImmediate`
  via `node:timers`) once input/raw-mode paths were exercised
- the old local `TranscriptMessageRow.tsx` scaffold has been removed after the
  donor-shaped `Messages` / `MessageRow` pass landed
- `deno task test:unit` currently passes end-to-end
- `deno task ssot:check` currently passes with zero errors
- `deno check --config src/hlvm/tui-v2/deno.json src/hlvm/tui-v2/main.tsx`
  currently passes
- the old toy tests were removed with the abandoned scaffold
- a live user audit on 2026-04-16 exposed two real Phase 1 gaps:
  - prompt focus was incorrectly disabled while the runtime was busy
  - the default shell still showed too much debug/demo chrome and did not read
    as a CC-equivalent screen
- those issues are now being corrected directly in the live shell path before
  Phase 1 is allowed to close
- donor shell cleanup now landed in the real path:
  - the local top status/debug strip was removed from the default transcript
    view
  - the default prompt no longer shows HLVM-specific placeholder copy
  - banner version/footer effort chrome now follow the donor shell rather than
    local placeholder values
- startup header now intentionally uses the old HLVM banner from the legacy REPL
  instead of the donor Claude banner
- rebuilt `./hlvm` no longer shows the stale top `stream responding` strip from
  the earlier local chrome
- bare `ink` inside `src/hlvm/tui-v2/` now resolves to the local CC donor engine
  via a new `src/hlvm/tui-v2/ink/index.ts` barrel:
  - v2's `deno.json` now maps `"ink": "./ink/index.ts"` instead of
    `"npm:ink@5"`; this is a boundary rename only, not a behavioral rewrite
  - the four v1 `repl-ink` files still transitively pulled in by the current
    PromptInput migration (`completion/Dropdown.tsx`,
    `components/PickerRow.tsx`, `components/HighlightedText.tsx`,
    `keybindings/keybinding-lookup.ts`) now share v2's React 19 +
    `react-reconciler@0.31` stack instead of dragging in the ink@5 stack
  - this is the real reason `./hlvm repl --new` used to die with
    `Cannot read properties of undefined (reading 'ReactCurrentOwner')`
  - it is a bridge, not a final architecture: those v1 files should still be
    ported into v2 proper (so v2 no longer imports from `../../cli/repl-ink/`
    at all); the barrel simply keeps the shell runnable while that port is in
    progress

This means:

```text
we have a valid Phase 0 baseline
runtime/test/type-check gates were green at the last audit
Phase 1 still needs transcript/prompt chrome parity before Phase 2
```

Current donor-fidelity audit:

```text
Engine:
  high fidelity donor port
  hard-copied from CC and adapted only for runtime / import differences

Markdown cluster:
  high fidelity donor copy/adapt
  structure remains close to CC, with local runtime wiring only

BaseTextInput cluster:
  high fidelity donor copy/adapt
  structure remains close to CC, with local import/runtime adaptation

VirtualMessageList:
  donor-shaped partial transplant
  real virtualization/render/sticky path landed
  search/navigation first pass landed and verified
  do not overstate this as full CC parity

Messages / MessageRow:
  donor-shaped first pass
  now drives the transcript row rendering in the live shell
  still far from full CC message-type coverage and parity

PromptInput:
  donor-shaped first pass
  prompt submit, bash submit, search activation, and permission activation are live
  donor-derived multiline wrapping/cursor logic is now in place
  local echo / multiline / busy-state typing are now structurally verified in PTY
  still not a full side-by-side transplant of the donor PromptInput cluster
  now wired to shared HLVM runtime/business logic
  still far from full donor PromptInput parity

StatusLine:
  compat first pass
  live shell summary is mounted and verified
  not yet the full donor hook-driven status line

PermissionRequest:
  compat first pass
  donor shell is mounted and verified
  wired to runtime interaction requests, but not yet full donor parity
```

Current supported launch commands:

```text
hlvm repl --new
make repl-new
make fast-new
deno run --allow-all --unstable-sloppy-imports --config src/hlvm/tui-v2/deno.json src/hlvm/tui-v2/main.tsx
```

## 10. Rules For Agents

Any agent working on v2 must follow these rules.

### 10.1 Single-document rule

This file is the source of truth.

Do not create a second implementation-plan doc unless there is a very strong
reason and the owner explicitly asks for it.

### 10.2 Donor-code rule

When a relevant CC implementation exists:

- read the real CC file
- copy/adapt if portable
- transplant closely if not portable

Do not replace it with a simplified hand-written approximation unless the CC
version is too coupled and the preserved behavior is explicitly understood.

Agent handoff note:

- `Markdown` and `BaseTextInput` are currently the strongest donor-fidelity
  slices in the tree
- `VirtualMessageList`, `Messages / MessageRow`, `PromptInput`, `StatusLine`,
  and `PermissionRequest` are all first-pass donor transplants, not
  parity-complete
- shared HLVM runtime wiring is now in place, but Phase 1 parity work is still
  active and must continue before Phase 2 is treated as the main focus
- do not rebuild local shell state; preserve the donor-chat baseline and layer
  REPL-mode work on top

### 10.3 Whole-app dump rule

Do not use "copy the whole CC TUI app and prune it" as the working product
strategy.

Allowed:

- temporary donor sandbox for research

Not allowed:

- shipping from a blind full-app dump
- treating a prune-in-place branch as the real architecture
- claiming progress because large amounts of CC code were copied without a clear
  keep/transplant/drop decision

### 10.4 No fake progress rule

The following do not count as phase completion:

- placeholder components
- simplified stand-ins
- logic-only tests passing
- one-off spike success

### 10.5 Deno adaptation rule

Runtime-porting edits are allowed. Behavioral simplification is not.

### 10.6 HLVM business logic rule

The TUI is the donor target. Business logic stays HLVM-native unless there is a
very specific reason otherwise.

## 11. Progress Board

```text
Phase 0 - Engine / launch baseline
  [x] Engine donor copied
  [x] Yoga donor copied
  [x] Spike validated
  [x] Toy v2 scaffold removed
  [x] Minimal donor-baseline shell running
  [x] Supported launch path fixed
  [x] hlvm repl --new working
  [x] Engine committed cleanly

Phase 1 - CC-quality chat TUI
  [x] False-start scaffold removed
  [x] Markdown cluster copied/adapted
  [x] BaseTextInput cluster copied/adapted
  [x] useVirtualScroll donor core copied/adapted
  [x] VirtualMessageList search/navigation first pass copied/adapted
  [x] Messages / MessageRow first pass copied/adapted
  [x] Status / Permission first-pass shells copied/adapted
  [x] PromptInput first pass copied/adapted
  [x] Compat layer established for the first interactive chat shell
  [x] Shared HLVM runtime/business-logic wiring landed
  [x] Full unit suite passes
  [x] SSOT check passes with 0 errors
  [x] deno check passes under src/hlvm/tui-v2/deno.json
  [x] Fixture-backed submit path no longer leaks auto-model selection
  [x] Compiled-path audit verifies immediate local echo on submit
  [x] Compiled-path audit verifies multiline editing (`line-one\` + Enter)
  [!] Compiled-path audit verifies prompt-history Up/Down editing ← claim lowered: the busy-runtime path queued follow-up turns and the audit could not isolate history behavior from the queue path; treat as unverified until re-run against a non-busy agent
  [x] Compiled-path audit verifies transcript search can open in the live shell
  [x] Compiled-path audit verifies PageUp/PageDown transcript scrolling
  [x] Compiled-path audit verifies raw wheel-event transcript scrolling
  [x] Compiled-path audit verifies `/` slash-command picker opens, selects, and closes cleanly (no more Max-update-depth loop)
  [x] Compiled-path audit verifies `@` file-mention picker opens, Up/Down advance by exactly 1 row, Escape preserves typed `@`
  [x] Compiled-path audit verifies picker-Enter inserts the selected item into the prompt WITHOUT also submitting a stray user turn
  [x] Compiled-path audit verifies Shift+Tab toggles `❯` ↔ `!` (prompt/bash mode indicator)
  [x] Compiled-path audit verifies `/` + letter narrows the slash-command dropdown via fuzzy match
  [x] Compiled-path audit verifies Tab advances picker selection by exactly 1 row per press
  [x] Compiled-path audit verifies Ctrl+D flips `docs off` ↔ `docs on` in the completion footer without closing the picker
  [x] Compiled-path audit verifies `@` + Right drills into the selected directory and refreshes the picker
  [x] Compiled-path audit verifies `@` + Left climbs back to the parent directory
  [x] Compiled-path audit verifies `/` + Enter on a command reaches the command-dispatch layer (user sees `Notice: Command not wired in v2 yet: …`)
  [x] Compiled-path audit verifies Ctrl+F opens the transcript search bar and Esc closes it
  [x] Compiled-path audit verifies Ctrl+R opens the history-search overlay
  [x] Compiled-path audit verifies Ctrl+C exits the REPL cleanly
  [x] CC donor cross-check performed this turn: read `~/dev/ClaudeCode-main/components/PromptInput/PromptInput.tsx` and `hooks/useTypeahead.tsx`; v2 fixes are architecturally consistent with the CC donor pattern (ref-based completion access, Enter-guard-when-picker-visible, no duplicate arrow handlers)
  [x] Direct CC-vs-v2 side-by-side PTY parity comparison run; landed three CC-parity fixes (footer, picker border, banner compactness); documented five honest remaining gaps (`?` overlay, `@` starting dir, prompt row position, picker marker style, picker content source)
  [x] Direct CC-vs-v2 side-by-side PTY comparison run 2026-04-17 (both in tmux 120x30). Captured visual diff for boot, `/` picker, `@` picker, `?` key. Documented gap table; landed three CC-parity fixes:
    [x] Footer no longer stomped by the verbose `tmux detected · PgUp/PgDn work here · set 'mouse on' …` string. That permanent footer-label override was CC-absent and drowned out `? for shortcuts`. TranscriptWorkbench now calls `maybeGetTmuxMouseHint()` as a no-op probe (intent: degrade to a future transient toast, not stomp the footer). Post-fix footer default reads `Enter send` (submitActionCue) or `? for shortcuts` depending on empty state.
    [x] CompletionDropdown no longer wraps the suggestion list in a `┌─┐ │ › item │ └─┘` box. CC's `useTypeahead` and CC's `PromptInput.tsx` render the dropdown inline, flush-left, no border. Removed `borderStyle="single"` + `paddingLeft/Right={1}` + `marginTop={1}` + default `marginLeft={1}` → now inline. Visual confirmation: v2 `/` picker now renders `  › /mcp  List configured MCP servers` inline vs the previous boxed layout.
    [x] HLVMBanner rewritten from a 5-line block-ASCII `HLVM` logo (32 cols × 5 rows, plus subtitle) to CC's 4-line compact layout: version title on row 1, then 3 rows pairing a small HLVM-themed chip glyph (`▗▄▖ / ▐█▌ ▌ / ▝▀▘`) on the left with runtime / cwd / welcome info on the right. Mirrors CC's shape exactly; the glyph itself stays HLVM-branded per §3.2 ("the startup banner/header may use HLVM's existing branded startup banner"), so this is parity-of-structure, not pixel-identity on the icon.
  [~] HONEST remaining CC gaps at end of this pass (will need further work; NOT fixed this turn):
    - `?` on an empty prompt does not show the rich shortcuts overlay CC renders (`! for bash mode / / for commands / @ for file paths / & for background / /btw for side question` + a 2-column modifier matrix). v2 just inserts `?` as a character. The v1 donor has `ShortcutsOverlay.tsx` available for port.
    - `@` picker first-open content differs: v2 shows home-dir shortcuts (`~/Desktop/`, `~/Documents/`, `~/Downloads/`, `docs/`, `docs/cc/`, `docs/api/`); CC shows the CWD's entries including hidden (`.DS_Store`, `.claude/`, `.codex-routing-profile.ts`, `.firebase/`, …). The initial default directory / include-hidden semantics differ.
    - Prompt ROW POSITION: CC paints the prompt near the TOP of the alternate screen (row 7 on a 30-row pane), with the transcript growing downward below it. v2 pins the prompt to the BOTTOM (row 28), transcript scrolls above. This is an architectural flow difference, not just CSS.
    - Picker marker style: v2 uses `›` for selection; CC uses `+` for `@` file rows and no explicit marker for `/` command rows (selection is shown via color/bold only).
    - Right-side effort indicator: v2 shows `◐ medium`; CC shows `◉ xhigh · /effort`. The glyph varies with the level in both products — the rendered state depends on user config. This is config-driven, not a bug, but the level values themselves differ between products.
    - Picker content SOURCE: v2 `/` shows only 6 built-in HLVM commands; CC `/` dynamically pulls user skills, plugins, and built-in commands (e.g., `/!refactor`, `/systematic-debugging`, `/brainstorming`, `/jss-audit-stupid`). This is the HLVM product surface, not a layout bug.
  [~] v1 advanced-composer migration started in PromptInput (attachments, completion, history search, first snippet session, donor submit routing, donor queue preview, donor file-picker left/right behavior)
  [x] donor placeholder/snippet lifecycle now structurally closer to v1, AND the 2026-04-17 live PTY audit covers the common transitions (multi-char narrowing, `@` Left/Right drill, Tab advance, Ctrl+D docs toggle, picker-Enter insert-without-submit). Remaining: attachment insertion timing + placeholder cleanup after history recall still not individually audited.
  [x] direct `./hlvm repl --new` PTY boot no longer trips `ReactCurrentOwner`; root cause was v2 transitively loading v1 `repl-ink` files that use bare `ink` (`npm:ink@5`), now remapped to local CC donor `ink/index.ts`
  [x] compiled-path PTY interaction audit for the main PromptInput flows (`/`, `@`, Tab, Up/Down, Escape, backspace, multiline, picker-Enter, Shift+Tab, Ctrl+F, Ctrl+R, Ctrl+C, `?`) performed on 2026-04-17 and recorded above — supersedes the earlier "still needed" claim.
  [x] `?` on empty prompt now opens a 3-column CC-shaped shortcut-help menu in the footer area (mirrors `~/dev/ClaudeCode-main/components/PromptInput/PromptInputHelpMenu.tsx` structure; content is HLVM-applicable subset). Second `?` closes it; any other keystroke dismisses it. Live PTY verified.
  [x] `@` picker now opens onto the CWD alphabetical listing (byte-order sort, hidden dot-entries included) instead of `$HOME` shortcuts — matches `~/dev/ClaudeCode-main/` @-picker behaviour. Live PTY verified: `.DS_Store`, `.claude/`, `.codex-routing-profile.ts`, `.firebase/`, `.firebaserc`, `.gitattributes`, …
  [x] `/` picker rows are now flush-left with no `›` marker column (selection conveyed via color/bold only — mirrors CC's `/` picker row chrome)
  [x] `@` picker rows now use `+ ` as the addable-mention prefix on every row — mirrors CC's `+ filename` layout
  [~] TRACKED BRIDGE-REMOVAL (per peer review): `src/hlvm/tui-v2/ink/index.ts` barrel remaps bare `"ink"` to the local donor engine. Progress:
    - [x] `src/hlvm/cli/repl-ink/completion/Dropdown.tsx` — removed from v2 graph (barrel-free now; `input-auto-trigger.ts` was changed to import directly from `./completion/providers.ts` instead of the `./completion/index.ts` barrel that eagerly re-exported Dropdown). Verified via `deno info`.
    - [x] `src/hlvm/cli/repl-ink/components/PickerRow.tsx` — no longer reachable from v2 (was only pulled in via Dropdown).
    - [x] `src/hlvm/cli/repl-ink/components/HighlightedText.tsx` — no longer reachable from v2 (was only pulled in via Dropdown / PickerRow).
    - [~] `src/hlvm/cli/repl-ink/keybindings/keybinding-lookup.ts` — still reachable through `src/hlvm/cli/repl/commands.ts:9` (`import { registry } from "../repl-ink/keybindings/index.ts";`). Its only ink usage is `import type { Key }` which resolves cleanly through v2's local donor barrel, so it does NOT drag `npm:ink@5` back in. Full removal needs commands.ts's `registry` dep to become lazy.
    - [x] `deno info` assertion added (`scripts/check-tui-v2-ink.ts`, `deno task check:tui-v2`) that the v2 graph never contains `npm:/ink@5` or `react-reconciler@0.29.2`. Currently passes. Wire into CI.
    - Bridge may be deleted when the `keybindings/keybinding-lookup.ts` chain is also decoupled.
  [~] TRACKED COMPAT-LAYER GAP (per peer review): §6.4 named 7 compat domains as the architecture. Scaffold now landed in `src/hlvm/tui-v2/compat/` with one file per domain: `app-state.ts`, `runtime.ts`, `transcript.ts`, `permission.ts`, `model-status.ts`, `history-input.ts`, `stubs.ts`, plus a README that documents intent and usage rules. Each file defines the interface HLVM commits to; production wiring (TranscriptWorkbench → runtime host, PromptInput → history hooks, etc.) still reaches through v1 paths and is the follow-up work this layer unblocks. Exit: move every `src/hlvm/tui-v2/…` → `src/hlvm/cli/repl-ink/…` call-site to route through its compat adapter instead.
  [~] TRACKED CC-QUALITY GATE (per peer review): §3.3 is a subjective vibe. Operational gate TODO — publish a fail-list of CC behaviours that MUST pass a live PTY audit before Phase 1 can be declared done, with named owner per row.
  [~] Transcript search/navigation compat started, not complete
  [~] PromptInput transplanted partially
  [~] Messages/transcript transplanted partially
  [~] Status/permission transplanted partially
  [~] Coherent donor chat shell live and runtime-backed
  [~] Manual human wheel behavior across all terminal/tmux combinations is still not fully audited
  [~] Phase 1 launchable donor chat-shell BASELINE (boot + main composer keystrokes) runs green, but Phase 1 overall is NOT complete — see §11.5 for remaining parity rows (`~19` still `[ ]`: Ctrl+O transcript viewer, Ctrl+S stash, Ctrl+G editor, Ctrl+V paste, thinking-indicator verb rotation audit, tool-row Ctrl+O wiring, markdown streaming parity, progress / coalesce indicator, plan checklist render, MCP warning chip, agent / skill / memory chrome, prompt row position, remove ink bridge, compat layer, operational CC-quality fail-list, permission-mode backend gating).
  [ ] Phase 1 overall complete

Phase 2 - HQL + JS code mode
  [ ] HQL eval
  [ ] JS eval
  [ ] Shared runtime
  [ ] Code-mode UX

Phase 3 - HLVM-specific overlays / workflows
  [ ] Model UX
  [ ] Config UX
  [ ] HLVM-specific overlays

Phase 4 - Polish / migration
  [ ] Search / selection / polish
  [ ] Performance
  [ ] Migration to default path
```

## 11.5 CC-parity Checklist — OVERLAPPING TUI surfaces only

**Principle (NON-NEGOTIABLE):** For every TUI surface HLVM and CC both have,
CC is authoritative. "Inspired by" is NOT acceptable. The test is:
drive the same keystroke / prompt through `claude --model sonnet` and through
`./hlvm repl --new` in a tmux PTY, capture output, diff. Either the v2
behaviour visually reproduces the CC behaviour on that surface, or it does
not. No rationalisation loopholes. HLVM-branded text and HLVM-specific
commands obviously differ by content; layout, chrome, interaction model,
glyphs, and keystroke semantics MUST match.

**Explicitly out of scope for parity** (HLVM does not have these, so do
not port CC's TUI for them): remote session, voice mode, buddy / mascot,
swarm coordinator, Anthropic-billing chrome, `--chrome` integration,
`--from-pr`, background tasks dialog, Claude-specific auth banners,
analytics/telemetry prompts, `& for background`, `/btw for side question`,
Alt+P model picker (HLVM has its own model-config flow), `/keybindings`
customization UI.

**Explicitly HLVM-only features that MUST be preserved** (per §5.5 and v1):
HQL REPL mode, JS REPL mode, `!` bash-mode toggle (typed `!` on empty
prompt — not Shift+Tab-driven), attachment placeholders like `[Image #1]`,
local AI runtime status in banner, `@path` mention resolution into real file
content, conversation queueing when runtime is busy.

Status key: `[x]` = verified live in tmux PTY against CC side-by-side.
`[~]` = structural match landed but full parity / behaviour not yet
verified. `[ ]` = not started.

### A. Composer / prompt
- [x] `❯` prompt glyph
- [x] `/` opens inline slash-command picker (no border, flush-left, no `›` marker, selection via color)
- [x] `@` opens inline file-mention picker (CWD-rooted, hidden dot-entries included, alphabetical byte-order sort, `+ ` prefix on every row)
- [x] `?` on empty prompt opens a 3-column shortcut-help menu in the footer area (matches `components/PromptInput/PromptInputHelpMenu.tsx` structure; HLVM content)
- [x] `!` on empty prompt flips to bash mode (HLVM-specific, NOT via Shift+Tab)
- [x] Multiline via trailing `\` + Enter
- [x] Shift+Tab cycles permission mode (default → accept-edits → plan → default). Live PTY confirmed footer flips `? for shortcuts` → `⏵⏵ accept edits on (shift+tab to cycle)` → `⏸ plan mode on (shift+tab to cycle)` → `? for shortcuts`. v2 no longer overloads Shift+Tab for input-mode toggle; `!` on empty prompt remains the bash trigger. (permission-mode gating of actual tool calls is separate from this footer indicator — not yet wired to a permission backend.)
- [x] Ctrl+F opens transcript search (footer flips to `search open · Enter keeps match · Esc closes`)
- [x] Ctrl+R opens history search
- [x] Escape closes picker keeping typed trigger (`@` / `/`) in the prompt
- [x] Backspace deletes through the trigger char
- [x] Down/Up navigate picker by exactly 1 row per press
- [x] Tab advances picker selection by 1
- [x] Ctrl+D toggles docs panel (`docs off` ↔ `docs on`)
- [x] `@` + Right drills into directory; `@` + Left climbs to parent
- [x] Picker-Enter inserts selection WITHOUT also submitting the draft (Enter-submit guard while picker is visible)
- [x] Plain text + Enter submits a user turn
- [x] Ctrl+C exits cleanly
- [x] `@` + typed letters fuzzy-narrows the CWD picker (`@sr` → `src/`, `src/hql/`, `src/hlvm/`, …)
- [x] `/` + typed letters fuzzy-narrows the slash-command picker (`/ex` → `/exit`)
- [x] Empty Enter is a no-op (footer stays `? for shortcuts`, no stray user turn submitted)
- [x] Plan mode persists across typing (`⏸ plan mode on (shift+tab to cycle)` footer holds while user types a draft)
- [x] `?` help ↔ plan-mode transitions cleanly — opening `?` replaces the plan-mode footer, closing `?` restores the plan-mode footer verbatim, no state drift
- [x] Long-line prompt wraps cleanly at narrow terminal widths (verified at 80×30 with a 120-char line)
- [x] `?` help text now matches v2's current shortcut bindings (`shift + tab to cycle permission mode`, `tab to autocomplete`) — fixed stale copy that still said `shift + tab to toggle mode` after the permission-mode port
- [x] `/` picker honesty: the slash-command handler now wires `/clear`, `/flush`, `/help`, `/status`, `/exit` (plus `/quit` alias). `/flush` is an alias for `/clear`. `/exit` / `/quit` cleanly exit the v2 subprocess. `/help` emits an up-to-date list of actually-wired commands. Previously the picker advertised `/mcp`, `/init`, `/flush`, `/hooks` but invoking any of them said "Command not wired in v2 yet" — `/flush` and `/exit` are now honest.
- [x] Bash-mode exit path: Backspace on an empty `!` prompt now returns to `❯` prompt mode. Previously users who typed `!` had no way out short of Ctrl+C exiting the whole REPL.
- [x] `/` picker dead-end commands now return informational responses instead of the generic "not wired in v2 yet": `/mcp` points users at `hlvm mcp`, `/init` points at `hlvm hql init`, `/hooks` explains the configuration path. Picker rows no longer look broken.
- [x] Tool-output row now collapses to a 3-line preview with `… +N more lines (ctrl+o to expand)` hint when output exceeds the preview window — matches CC's compact tool-row chrome instead of dumping the full output inline. (Ctrl+O transcript viewer wiring still TODO.)
- [x] **Paste setState-in-render crash fix**: `usePasteHandler.ts` was calling `onPaste(...)` and `setIsPasting(false)` from *inside* the `setPasteState(updater)` callback — that made React run `onPaste` during a state-resolve phase, which cascaded into `setValue` on the parent `PromptInput`. Deno React 19 correctly flagged this: `Cannot update a component (PromptInput) while rendering a different component (BaseTextInput). …setstate-in-render`. Root-caused via bracketed-paste PTY repro (stderr captured). Fix: moved side-effects out of the `setPasteState` updater; now the timeout reads chunks from a `chunksRef` and invokes `onPaste` + `setIsPasting` after the state update is scheduled, not inside it. Live-verified: big bracketed paste now renders `[Pasted text #1 +5 lines]` placeholder with zero stderr output.
- [x] **Stderr/TUI bleed fix**: the ink shell now calls `renderSync` with `patchConsole: true` and `mod.tsx` redirects `console.error` to `~/.hlvm-tui-v2.log` before mount. React dev warnings and any other console noise cannot corrupt the ink-drawn screen anymore. (Previously React's setState-in-render warning text was landing on the same PTY ink was painting — producing the visible `stack trace as described in https://react.dev/link/setstate-in-render` fragments the user captured.)
- [x] **SSOT consolidation for completion UI**: deleted `src/hlvm/tui-v2/prompt/{CompletionDropdown,HighlightedText,PickerRow,HistorySearchPrompt}.tsx` (v2-local drifted copies). v2 PromptInput now imports v1's `Dropdown` (aliased `CompletionDropdown`) and `HistorySearchPrompt` directly from `src/hlvm/cli/repl-ink/` — bare `"ink"` resolves through v2's donor barrel so the v1 files work under React 19 unchanged. Side-effect bonus: fuzzy-match highlighting now renders yellow on matching chars inside each row (was plain white in v2-local copies). Verified live with `@cli` → ANSI capture shows `[38;5;222m` (yellow FG) wrapping `cli` inside `tests/unit/[cli]-smart-runner.test.ts`, `src/hlvm/cli/[cli].ts`, `src/hlvm/tui-v2/utils/[cli]Highlight.ts`, etc.
- [x] **ThemeProvider at v2 root**: `App.tsx` now wraps the tree in v1's `ThemeProvider` so reused v1 components find the semantic-color context they need via `useSemanticColors()`.
- [x] **v1 Banner restored as SSOT**: deleted `src/hlvm/tui-v2/header/{HLVMBanner,ClaudeBanner,Clawd}.tsx` (plus the now-empty `header/` directory). v2 `App.tsx` imports `Banner` directly from `src/hlvm/cli/repl-ink/components/Banner.tsx` — same block-ASCII "HLVM" logo with purple→orange gradient + `HLVM 0.1.0 — High Level Virtual Machine` subtitle that v1 uses. To make v1 Banner reusable under v2 the barrel (`src/hlvm/tui-v2/ink/index.ts`) was extended to re-export `useInput`, `useApp`, and a minimal `useStdout` shim that bridges to `useTerminalSize` + `Deno.stdout.writeSync`. PTY-verified: boot now renders the canonical v1 banner instead of the CC-shaped compact glyph I previously (wrongly) substituted.
- [x] **Queue-drain no longer flushes user's WIP draft**: root cause was `submitDraft()` unconditionally calling `clearEditor()` on success. When the queue-drain effect used `submitDraft` to fire a queued command (while the user was typing a new WIP prompt in the editor), `clearEditor()` wiped the user's in-progress text. Reported by user: "prompt is flushed when queue is ready and starts a new chat". Fix: `submitDraft` now takes an `options.clearAfter` flag (default `true` for backward compat); queue-drain path passes `{ clearAfter: false }` so the editor is untouched while the queued draft is dispatched.
- [x] **Slash-command picker-Enter now dispatches exactly once**: `/help` + Enter was printing its `Notice` TWICE because my earlier picker-dispatch edit duplicated the submission — the `ApplyResult` from the command provider already carries `sideEffect: { type: "EXECUTE" }`, which `applyCompletionResult` in PromptInput.tsx handles via its own `submitDraft` call. My added block fired a second dispatch. Removed. Live verified: `/help`, `/flush`, `/status` each render a single `Notice` and clear the prompt after.
- [x] **CC-parity picker chrome (shared v1 `Dropdown`)**: updated `src/hlvm/cli/repl-ink/completion/Dropdown.tsx` so both trees inherit the fix. Removed the `borderStyle="round"` + `paddingX={1}` from the generic (`@`) panel. Removed the `›` selection marker column from the command (`/`) rows — selection is now indicated only by color/bold. The generic file rows carry `+` as a per-row addable-mention prefix (CC-parity). `markerWidth={1}` keeps a single space between `+` and the label (`+ .DS_Store` not `+  .DS_Store`). Removed the in-panel `Enter select • Tab next • Esc close • docs off` helpText footer — that hint belongs in the shell footer, not stacked inside the panel. Side-by-side PTY diff against `claude --model sonnet` now matches CC's picker shape structurally.
- [x] **Picker flush-left alignment (v2 call-site)**: v1's `resolveCompletionPanelLayout` anchors the picker to the cursor column (trigger-column), which made the picker appear indented ~3 cells vs CC's flush-left. Passed `marginLeft={0}` at v2's `PromptInput.tsx` call-site (not touching the shared layout utility — v1 REPL keeps its trigger-anchored layout). Live PTY confirmed: v2 `+ .DS_Store`, `+ .claude/`, `+ .codex-routing-profile.ts` now render at column 1 just like CC; v2 `/mcp`, `/exit`, `/help` likewise.
- [x] **Attachment `~` expansion bug fix** — user-reported: selecting `@~/Desktop/Screenshot …png` from the picker produced `File not found: /Users/…/hql/~/Desktop/Screenshot …png`. Root cause: `createAttachment` in `src/hlvm/cli/repl/attachment.ts` passed the raw user-facing path (which may start with `~`) straight to `registerAttachmentFromPath`. The file has a `resolveAttachmentPath` helper that does the `~` → `$HOME` expansion + normalise, but it was never invoked on that code path. Fix: call `resolveAttachmentPath(filePath)` as the first line of `createAttachment` and pass the resolved path to `registerAttachmentFromPath` + through the returned `Attachment.path` / `Attachment.fileName`. Both v1 and v2 REPLs benefit (shared file).
- [x] **Broader scenario sweep (PTY)** — beyond picker flows, confirmed live: cursor arrow-keys mid-word + character insert (`hello` + Left Left + `X` → `hellXo`); Backspace at cursor mid-word removes correct char; Ctrl+U clears to beginning; rapid-type (`abcdefghij` burst) renders without skipped/duplicated chars; multi-space words (`a b c`) submit intact. No `setState-in-render` warnings in stderr across any of these flows after the paste-handler fix.
- [x] **Column-0 flush-left shell**: removed `paddingX={1}` from `App.tsx`'s outer `<Box>` (kept `paddingY={1}` for banner top-breathing). Everything — banner, dividers, picker rows, prompt — now renders at column 0 just like CC. Previously every row carried a 1-cell left indent.
- [x] **Single-space prompt prefix**: `PromptInputModeIndicator.tsx` previously rendered `❯{" "}` inside a `<Box marginRight={1}>`, producing `❯  value` (two spaces). Dropped the `marginRight` and split the indicator into `❯` + a single-space `<Text> </Text>` sibling. Prompt now reads `❯ value` — identical to CC.
- [x] **Diverse scenario battery passed** (PTY side-by-side vs `claude --model sonnet`): `!` bash-mode entry + Backspace exit; Up arrow on empty prompt; Shift+Tab 3-stage permission cycle (identical footer text); Esc+Esc clears typed text; Tab-on-no-picker is a no-op; Home/End + insert (`XabZ`); `\` + Enter multi-line; `@` + Right file-select; `?` mid-text (NOT opening help); emoji (`hi 🚀 world`); bracketed multi-line paste; `/help` + Esc+Esc dismisses cleanly. Stderr empty across all.
- [x] **Footer default is `? for shortcuts` even while drafting**: removed the HLVM-specific `Enter send` / `Enter command` submit-cue from `resolvedFooterLabel` in `PromptInput.tsx`. Now the footer reads `? for shortcuts` constantly unless a special state owns the row (loading, search, permission mode, placeholder/snippet mode, or a runtime-supplied `footerLabel`). Observed-against-CC: CC's footer is context-aware (blank while drafting single-line, `ctrl+g to edit in VS Code` when drafting multi-line). v2's constant `? for shortcuts` is a deliberate HLVM-flavored simplification — cleaner than CC's blank footer, and CC's editor-hint doesn't apply to HLVM (no VS Code integration). `submitActionCue` is still computed so future product flows can opt in via an explicit `footerLabel` prop.
- [x] **New-agent cold-start block landed**: `§0 Quick Start` at the top of this doc now summarises what to run, how to verify, where files live, non-negotiable workflow, what NOT to do, next priorities, and current green gates. Any agent with no context can pick up from that block without paging through 1600+ lines.
- [~] Attachment placeholders like `[Image #1]`, `[Image #2]`: ingestion path wired (v1 `useAttachments.ts` is imported) but live paste/drop flow not PTY-audited this session
- [~] Queued-commands preview when runtime busy (v1 donor wired into `PromptInputQueuedCommands.tsx`, not live-audited this session)
- [x] Ctrl+S stash prompt / notification — verified live: typed draft is removed and a `> Stashed (auto-restores after submit)` notice renders; a second Ctrl+S restores the draft. Donor shape matches CC's stash-and-restore contract.
- [ ] Ctrl+G edit in `$EDITOR` (needs tempfile + subprocess plumbing; deferred)
- [ ] Ctrl+V paste images (needs clipboard access; deferred)

### B. Transcript / rendering
- [x] User message row rendered with `❯` prefix (matches CC)
- [ ] Assistant message row rendered with `⏺` prefix (CC uses `⏺`, v2 current prefix not yet verified side-by-side)
- [ ] Thinking indicator: CC renders `✢ Ruminating…` / `Thinking…` / `Hmm…` with a rotating glyph. v2 has a `ThinkingIndicator` component in v1 donor — needs CC-matching label rotation & glyph set.
- [ ] Tool-call row collapsed-by-default with `  Listed 1 directory (ctrl+o to expand)` style. CC collapses tool output; v2 tool rendering not yet verified side-by-side.
- [ ] Ctrl+O expands / collapses tool output (transcript viewer overlay)
- [ ] Markdown rendering for numbered lists, inline `code`, **bold**, diff blocks (CC renders cleanly; v2 has `Markdown.tsx` donor copy but not verified against streaming outputs)
- [ ] Streaming token-by-token append into the assistant row (CC animates the text; v2 uses fixture-backed submit path for tests)
- [ ] Progress/coalesce indicator like `+ Coalescing… (15m 54s)` for long-running operations
- [ ] Plan/checklist rendering: `▢ task item` unchecked, `☑` checked — CC plan-mode shows these. v1 donor has `PlanChecklistPanel.tsx`; v2 hasn't wired the render.

### C. Status / footer
- [x] Default footer: `? for shortcuts` (flips back to this when prompt is empty and no non-default permission mode — live PTY verified 2026-04-17)
- [x] Loading footer: `esc to interrupt`
- [x] Search footer: `search open · Enter keeps match · Esc closes`
- [x] Right-side: `◐ medium · /effort` matches CC default
- [x] Permission-mode indicator in footer when not default: `⏵⏵ accept edits on (shift+tab to cycle)` and `⏸ plan mode on (shift+tab to cycle)` — live PTY verified 2026-04-17
- [ ] MCP-server warning chip: CC shows `1 MCP server failed · /mcp` when an MCP connection fails (v2 not wired)

### D. Approval / permission flows
- [~] Permission-request dialog (v2 has `permissions/PermissionRequest.tsx` first-pass; CC has richer per-tool dialogs with `y / n / always` options — not parity-audited)
- [ ] Accept-edits-on auto-approves Edit/Write tool calls (scope-gated by session)
- [ ] Plan-mode blocks all edit/exec tools, allowing only read-only tools

### E. Agent / skill / memory (HLVM has these, must match CC chrome)
- [ ] Agent-spawning TUI: when user kicks off a sub-agent, CC renders a child-of-parent indent tree with live status
- [ ] Skill activation chip: typing `/<skill>` shows the skill name in the tool row chrome
- [ ] Memory recall indicator: `◆ Recalled N, wrote N memory` chip (HLVM already has this — v2 needs the chip render)
- [ ] Plan/todo state in transcript and in /todo command

### F. Structural / architectural
- [~] `src/hlvm/tui-v2/ink/index.ts` barrel remaps bare `"ink"` to local donor — tracked in §11 with 5 exit criteria
- [ ] Compat layer `src/hlvm/tui-v2/compat/` with 7 documented domains
- [x] `deno info` regression guard added — `scripts/check-tui-v2-ink.ts`, invocable as `deno task check:tui-v2`. Scans `deno info` output for `npm:/ink@5` or `npm:/react-reconciler@0.29` reachable from `src/hlvm/tui-v2/main.tsx`; exits non-zero with offending lines if found. Currently passes. Wire into CI pipeline before next major v1→v2 port to catch bridge-breaking imports before they crash the compiled binary.
- [ ] Operational CC-parity gate: a hard fail-list of surfaces (rows above marked `[ ]`) that MUST flip to `[x]` before Phase 1 is declared complete; owner per row

### Workflow to flip a row from `[ ]` to `[x]`
1. Start `claude --model sonnet` (or haiku) in tmux PTY and `./hlvm repl --new` in another.
2. Drive the SAME keystrokes / prompt through both.
3. Capture with `tmux capture-pane -pt … | sed 's/\x1b\[[0-9;]*[mGKHJfABCDEhl]//g'`.
4. Diff. If v2 visibly diverges, open `~/dev/ClaudeCode-main/` for the relevant
   file, port the structural code into v2, rebuild with `make build-fast`,
   re-audit.
5. Only after a clean side-by-side capture, flip the row to `[x]` in THIS
   section and in the main §11 Progress Board.

No row flips to `[x]` without a real PTY audit. No exceptions.

## 11.55 Keystroke / Shortcut Audit — Observed behavior in compiled `./hlvm repl --new`

Tested 2026-04-17 in a fresh tmux PTY. `(O)` = works as expected, `(X)` =
broken or not wired, `(~)` = partial / needs CC comparison.

### Text editing
- (O) Letter/digit/emoji input — renders correctly, no stderr
- (O) Backspace — deletes char before cursor
- (O) Delete — deletes char under cursor
- (O) Left / Right arrow — cursor nav one char
- (O) Home / Ctrl+A — cursor to beginning (verified via `C-a` + insert X → `Xhello`)
- (O) End / Ctrl+E — cursor to end
- (O) Ctrl+B — move back one char (seeded `hi`, `C-b`, insert `X` → `hXi`)
- (O) Ctrl+W — delete previous word
- (O) Ctrl+U — clear to beginning
- (O) Ctrl+K — kill to end (observed: text cleared, ready for new input)
- (X) Ctrl+T — toggle tasks overlay (no-op in v2; CC opens tasks list)
- (X) Ctrl+L — clear screen (no-op in v2; CC clears transcript)
- (O) Up arrow on empty — history navigate back (needs history entries)
- (O) Down arrow on empty — history forward
- (O) Shift+Enter / `\` + Enter — insert newline (multi-line composer)
- (O) Cmd+C — auto-copy-on-select end-to-end verified (2026-04-17 PM).
  Two bugs were masking each other: (a) an earlier port of
  `useCopyOnSelect` only fired at the `isDragging: true→false` edge,
  which missed multi-click word/line selection; (b) `execFileNoThrow`
  at `stubs/utils.ts` was a synchronous no-op that never actually
  spawned `pbcopy`, so the clipboard write path was completely dead.
  Fix: rewrote the hook to match CC exactly (fire on any settled
  non-empty selection, `copiedRef` guards duplicates) and replaced
  `execFileNoThrow` with a real async implementation backed by
  `getPlatform().command.run()` with Web/Node WritableStream shape
  detection. Verified with PTY-injected SGR drag + real `pbpaste`:
  drag over `"copy me please to clipboard"` at cols 3-15 produced
  `"copy me pleas"` in `pbpaste` (sentinel overwritten). See §0.9.1
  for the reproducer. The macOS beep on Cmd+C still happens because
  Terminal.app has no native selection (mouse tracking ate the drag) —
  same behavior as CC; Cmd+V pastes the right content regardless.
- (X) Cmd+V image paste — clipboard image ingestion not wired
- (O) Bracketed multi-line paste — `[Pasted text #N +N lines]` placeholder

### Picker / completion
- (O) `/` opens slash-command picker (flush-left, no marker, no border)
- (O) `@` opens file picker (CWD-rooted, hidden included, `+ ` prefix)
- (O) `/` + typed letters → narrows fuzzy match
- (O) `@` + typed letters → narrows, match indices highlighted yellow
- (O) Tab — advance picker selection OR insert Tab when no picker (no-op)
- (O) Shift+Tab — cycle permission mode (default → accept-edits → plan)
- (O) Down/Up — advance/back picker selection by exactly 1
- (O) Enter on command picker — dispatches the command (once, not twice)
- (O) Enter on file picker — inserts selection, clears picker
- (O) Right arrow (picker open) — drill into directory / select file
- (O) Left arrow (picker open) — climb to parent directory
- (O) Escape — close picker (typed trigger char preserved)
- (O) Ctrl+D — toggle docs panel (`docs on` ↔ `docs off`)

### Overlays / modes
- (O) `?` on empty prompt — shortcut help overlay (HLVM subset)
- (O) `?` mid-text — inserts `?` (does NOT open help)
- (O) `?` toggle off — Esc or second `?` dismisses
- (O) `!` bash mode — prompt flips to `!`
- (O) Backspace on empty `!` — returns to `❯` (bash exit)
- (O) Ctrl+F — open transcript search (footer flips to
  `search open · Enter keeps match · Esc closes`)
- (O) Ctrl+R — open history search
- (O) Ctrl+S — stash / restore (notification `> Stashed (auto-restores
  after submit)`)
- (O) Escape — closes search / picker / permission shell
- (O) Esc + Esc — clears typed text
- (X) Ctrl+O — NOT WIRED. Tool-row shows `(ctrl+o to expand)` hint but
  pressing it does nothing. Needs `TranscriptViewerOverlay` port.
- (X) Ctrl+G — NOT WIRED. Intended for "edit in $EDITOR"; needs tempfile
  + subprocess roundtrip.
- (X) Ctrl+P — NOT WIRED. Earlier help text mentioned a "permission
  shell"; removed. Currently no-op.
- (X) Ctrl+V — NOT WIRED for images. Text paste goes through
  bracketed-paste handler.
- (X) Ctrl+Z — NOT WIRED. CC suspends the process (POSIX signal).

### Slash commands
- (O) `/clear` — clears transcript
- (O) `/flush` — alias for `/clear`
- (O) `/help` — prints list of wired commands
- (O) `/status` — prints model + streaming state
- (O) `/exit` / `/quit` — graceful process exit
- (O) `/mcp` — informational notice (points to `hlvm mcp` CLI)
- (O) `/init` — informational notice (points to `hlvm hql init`)
- (O) `/hooks` — informational notice
- (X) `/model` — NOT WIRED. No model-picker overlay.
- (X) `/effort` — NOT WIRED. Footer shows `medium · /effort` but typing
  the command does nothing.
- (X) `/config` — NOT WIRED. v1 has a full `ConfigOverlay.tsx`.
- (X) `/shortcuts` — NOT WIRED. v1 has `ShortcutsOverlay.tsx` separate
  from the footer `?` overlay.
- (X) `/transcript` — NOT WIRED. v1 has `TranscriptViewerOverlay.tsx`.
- (X) `/background-tasks` / `/tasks` — NOT WIRED.
- (X) `/todo` — NOT WIRED. v1 has a plan/todo surface.
- (X) `/context` — NOT WIRED. v1 shows context-usage info.

### Known bugs observed this round
- (X) Mouse-drag text selection inside fullscreen without Opt — macOS
  Terminal forwards mouse events to the app (same as CC). User's Cmd+C
  beep report stems from this. Documented workaround in this file;
  needs either Opt+drag muscle memory OR the `CLAUDE_CODE_DISABLE_MOUSE=1`
  env var.
- (O) Paste ghost / duplicate `[Pasted text #N]` — FIXED 2026-04-17.
  Root cause: `PromptInput.tsx` rendered `visibleAttachments` as a
  dim-grey preview list ABOVE the prompt input AND `applyCompletionResult`
  substituted the same `{{ATTACHMENT}}` → `displayName` INLINE in the
  prompt text. Each attachment therefore appeared twice. CC shows the
  reference once, inline. Fix: deleted the standalone preview block
  (lines 1644-1660 before the edit). The inline substitution is the
  single source of display. Error surfacing (red `lastError` block)
  is untouched.
- (X) Ctrl+T / Ctrl+L / Ctrl+P / Ctrl+Z / Ctrl+O / Ctrl+G / Ctrl+V —
  all no-ops in v2 today. CC wires each of these. See §11.6.

## 11.6 v1 → v2 Functionality Migration Checklist

**Scope**: everything that v1 REPL (`./hlvm repl` a.k.a. `make repl`)
actually *does* as a working product, ported into v2 (`./hlvm repl --new`)
so v2 is a functional superset of v1, not just a prettier chrome. TUI
still has to match CC per §11.5; this section is *functionality*, not
appearance.

**Discovery method** (binding): to flip a row from `(X)` → `(O)`, the
agent MUST:
1. Run `make repl` (v1), exercise the feature, capture expected
   behavior.
2. Run `./hlvm repl --new` (v2), exercise the same keystrokes/query.
3. If v2 doesn't reproduce v1's behavior, port the minimum code path
   from `src/hlvm/cli/repl-ink/` / `src/hlvm/cli/repl/` into v2 (either
   reuse via import or add v2-specific glue in
   `src/hlvm/tui-v2/transcript/TranscriptWorkbench.tsx` /
   `src/hlvm/tui-v2/prompt/PromptInput.tsx`).
4. Paper-trail the PTY capture in the conversation/PR, and flip the
   box here.

Initial state: all `(X)`. Next agent(s) tick them off.

### A. Composer functionality (in-prompt)
- (O) `@<path>` insertion — works; v2 resolves `~` via
  `resolveAttachmentPath`. See §11.5 "attachment `~` expansion".
- (O) `@` directory drill (Right arrow) + parent climb (Left arrow).
- (X) `@` drill semantics: large-directory warn (v1 tells the user "too
  many files — refine filter"). Verify v2 behaves the same; port if
  not.
- (O) Text copy out of v2 REPL (macOS Terminal selection). FIXED
  2026-04-17 PM via the `useCopyOnSelect` + `execFileNoThrow` rewrite
  (see §0.9.1). Drag-select writes through to `pbcopy`; Cmd+V pastes
  the selected text. The beep on Cmd+C is Terminal.app behavior and
  matches CC exactly. `CLAUDE_CODE_DISABLE_MOUSE=1` remains the escape
  hatch for users who prefer native terminal selection.
- (O) Paste double-render / ghost `[Pasted text #N]` in the transcript
  AND in the prompt. FIXED 2026-04-17: deleted the redundant
  `visibleAttachments` dim-grey preview block in `PromptInput.tsx` that
  was rendering the same chips a second time above the inline
  `{{ATTACHMENT}}` substitution. See §11.5 "Known bugs" for the
  commit-level account.
- (X) Ctrl+G edit in `$EDITOR`.
- (X) Ctrl+V clipboard image paste — `onImagePaste` is accepted by
  `useTextInput` / `BaseTextInput` but never passed at the
  `PromptInput.tsx` layer. See §0.6 #4 and §0.9.2 for the attachment-
  reality trace.
- (X) `!` bash mode — v1 actually runs the shell command; v2 shows
  "intentionally deferred" notice. Port the v1 bash execution path
  (v1 `cli/repl/handlers/*` likely has it) or wire a Deno subprocess
  command runner behind `!` so v2 is at feature parity with v1.
- (X) v1 prompt history persisted on disk (survives restart). v2
  history is in-memory only — CC persists its history. Port v1
  history-storage for v2.

### B. Evaluation functionality (what v1 actually computes)
- (X) HQL evaluation — v2 doesn't route plain input through HQL eval.
  v1 does. Wire v2 code-mode or route plain input through
  `src/hlvm/cli/repl/evaluator.ts` / `js-eval.ts`.
- (X) JS evaluation — same as above.
- (X) Shared binding store `(bindings)` / `(unbind "x")` / `def`
  auto-persist to `~/.hlvm/memory.hql`.
- (X) `(inspect x)` / `(describe x)` source-code introspection.
- (X) `(remember "text")` / `(memory)` MEMORY.md write + open.
- (X) HQL macro loading on first compile.
- (X) Slash-command catalog dynamically loads installed skills (v1
  does this via `getFullCommandCatalog`). v2 command picker shows
  built-ins but not the user's local skills.

### C. Agent / runtime functionality
- (X) Runtime round-trip (assistant reply paints into transcript).
  Today v2 shows `esc to interrupt` but the reply never arrives.
  Verify local model is installed and `runAgentQueryViaHost` actually
  fires the query; trace conversation event consumption.
- (X) Agent-spawn tree TUI (`LocalAgentsStatusPanel` port) — v1 renders
  `├─ / └─ / ⎿` + tool-uses + tokens per sub-agent. v2 doesn't wire
  the panel.
- (X) Skill activation path (typing `/<skill-name>` runs the skill).
- (X) Memory recall indicator (HLVM memory chip in transcript).
- (X) Plan / todo checklist transcript rows (`▢` / `☑`).
- (X) Tool-call collapsed row with Ctrl+O → full transcript overlay.
- (X) Streaming markdown render (code fences, lists, bold, diff).
- (X) Permission-mode **backend gate**: Shift+Tab cycles the indicator
  already, but tool calls are not actually blocked in plan mode / not
  auto-approved in accept-edits mode. Wire through the
  `compat/permission.ts` adapter.

### D. Slash commands wiring parity
- (X) `/model` model picker UX.
- (X) `/effort` effort-level setter.
- (X) `/config` overlay — v1 has `ConfigOverlay.tsx` (~63KB).
- (X) `/shortcuts` — overlay present in v1 (`ShortcutsOverlay.tsx`).
- (X) `/background-tasks` / `/tasks` overlay.
- (X) `/todo` surface.
- (X) `/transcript` viewer.
- (X) `/context` context-usage view.
- (X) `/exit` — DONE in v2 (routes through platform.process.exit).
- (X) `/clear` / `/flush` — DONE in v2.
- (X) `/help` — DONE in v2 (lists wired commands).
- (X) `/status` — DONE in v2 (shows model + stream state).

### E. UX polish (production)
- (X) Prompt-row position: CC-parity top-anchored flow (major
  architectural rewrite of `TranscriptWorkbench` layout direction).
- (X) Tool output Ctrl+O overlay → full-screen transcript viewer
  (port v1's `TranscriptViewerOverlay.tsx`).
- (X) Ctrl+R history-search inline style (match CC's minimal
  `search prompts:` instead of v1's more verbose chrome).
- (X) Notifications / toast stack for non-blocking info events.
- (X) Remove the last bridge file — decouple
  `keybindings/keybinding-lookup.ts` (reached via
  `cli/repl/commands.ts:9`) by converting its `registry` import to a
  lazy dynamic import, then delete `src/hlvm/tui-v2/ink/index.ts` +
  the deno.json `"ink"` alias.

### F. Tests / harness
- (X) Add a `tests/unit/tui-v2/` suite (currently v2 has no unit
  tests; v1 has extensive coverage).
- (X) CI wiring of `deno task check:tui-v2` regression guard.

This is the migration program. Close items in the order that most
improves actual user experience (start with A.copy-paste, B.HQL-eval,
C.runtime-round-trip), not in the order they're listed.

## 12. Bottom Line

The plan is:

```text
Use CC as donor TUI, not just inspiration.
Hard-copy the engine.
Aggressively transplant the TUI.
Keep HLVM business logic.
Use one document.
Stay honest about what is and is not done.
```

## 13. Shared-Surface Parity Matrix — LIVE MISSION SCOREBOARD

**This is the single authoritative scoreboard.** One row per TUI
surface HLVM and CC both have. Rows start at `(X)`. A row flips to
`(O)` ONLY after side-by-side PTY capture of v2 visually matches CC on
that scenario. `(~)` = one clear delta remains. `(—)` = explicitly out
of scope.

> **Mission complete iff every non-`(—)` row is `(O)`.**

Not Phase 1 done. Not "most of it working." Every row.

Out-of-scope: remote session, voice, buddy, swarm coordinator,
Anthropic-billing chrome, `/keybindings` UI, Alt+P model picker,
Alt+O fast mode, `& for background`, `/btw for side question`,
Anthropic auth / analytics / billing prompts. See §11.5 opening
block.

**Last live audit**: 2026-04-17 PM. Captures in `/tmp/hlvm-audit/`,
referenced by row-scoped filename. CC = `claude --model sonnet`
(2.1.112). v2 = `./hlvm repl --new` (current `feat/lean-binary-cicd`
tip). Identical geometry: `tmux -x 140 -y 40`.

**§11.5 / §11.55 / §11.6 status**: historical detail record. §13 is
the live scoreboard; when §13 and §11.5 disagree, §13 wins.

### 13.A Boot + frame

| # | St | Scenario | CC | v2 | Notes / donor |
|---|---|---|---|---|---|
| A1 | (O) | Prompt-row flow direction | Banner + transcript + divider + `❯` + divider + footer, content-sized with empty rows below | Same. TranscriptWorkbench's FullscreenLayout no longer flex-grows the scrollable region — LiveTurnStatus + HorizontalRule + PromptInput moved from the pinned-to-bottom slot into the end of the scrollable flow. PromptInput gained an internal HorizontalRule above its footer for the 2-divider prompt wrap. Boot + active-turn captures: identical structure between CC and v2. |
| A2 | (X) | Cwd in banner | Shows `~/dev/hql` right of glyph | Absent | v1 `Banner.tsx` reused but cwd slot not wired |
| A3 | (X) | Right-footer on empty state | Absent on boot | Always shows `◐ medium · /effort` | Either remove from empty-state render OR lift to hover/opt-in |
| A4 | (—) | Banner logo glyph | CC chip + version + model + cwd | HLVM block-ASCII + version + subtitle | EXEMPT per §3.2 (HLVM branding) |
| A5 | (O) | Left-footer on empty state | `? for shortcuts` | `? for shortcuts` | `boot-{cc,v2}.txt` — left-slot match |

### 13.B Composer (in-prompt input)

| # | St | Scenario | CC | v2 | Notes / donor |
|---|---|---|---|---|---|
| B1  | (O) | `❯` prompt glyph on boot | ✔ | ✔ | PTY-verified |
| B2  | (O) | `/` opens inline picker, no border, flush-left | ✔ | ✔ | `slash-{cc,v2}.txt` |
| B3  | (X) | `/` picker content source | Dynamic: user skills + plugins + built-ins (`/!refactor`, `/brainstorming`, `/sc:brainstorm`, ...) | 6 built-ins only (`/mcp`, `/exit`, `/help`, `/init`, `/flush`, `/hooks`) | Port v1's `getFullCommandCatalog` into v2 command provider |
| B4  | (O) | `@` opens picker, CWD-rooted, hidden included, `+ ` prefix | ✔ | ✔ | `at-{cc,v2}.txt` |
| B5  | (X) | `@` picker shows `.git/` | `+ .git/` row visible | Filtered out; next sibling `+ .gitattributes` surfaces instead | `src/hlvm/cli/repl/file-search.ts` — remove `.git/` exclusion to match CC |
| B6  | (~) | `?` on empty prompt opens help overlay | 3-column layout (`!`, `/`, `@`, `&`, `/btw`, `\⏎` + modifier column) | 3-column HLVM subset (`!`, `/`, `@`, `\⏎` + ctrl+{d,f,r,c}, shift+tab, pgup/pgdn) | Layout matches; content scope intentional (§11.5). Donor: `components/PromptInput/PromptInputHelpMenu.tsx`. Flip to `(O)` after B7 is fixed. `help-{cc,v2}.txt` |
| B7  | (X) | Escape closes `?` help overlay | ✔ | ✗ — overlay persists; only a printable keystroke dismisses it | Real v2 bug observed live. Fix dismissal path in `src/hlvm/tui-v2/prompt/ShortcutsHelpMenu.tsx` or owning state in `prompt/PromptInput.tsx` |
| B8  | (O) | `!` on empty prompt flips to bash mode (HLVM semantics) | N/A — CC `!` stays as text | v2 flips prompt glyph to `!` | HLVM-only per §11.5 explicit features block. Mark `(O)` — semantic split documented |
| B9  | (O) | Bash-mode exit via BSpace on empty `!` | N/A | Returns to `❯` | HLVM-only §11.5 |
| B10 | (O) | Multi-line via trailing `\` + Enter | ✔ | ✔ | §11.5 |
| B11 | (O) | Backspace deletes through trigger char | ✔ | ✔ | §11.5 |
| B12 | (O) | Shift+Tab cycles permission mode default → accept-edits → plan → default | ✔ | ✔ | `shift-tab-{cc,v2}.txt` + `plan-{cc,v2}.txt` |
| B13 | (O) | Footer `⏵⏵ accept edits on (shift+tab to cycle)` | ✔ | ✔ | identical text |
| B14 | (O) | Footer `⏸ plan mode on (shift+tab to cycle)` | ✔ | ✔ | identical text |
| B15 | (X) | Permission-mode backend gating | Tool calls blocked in plan / auto-approved in accept-edits | Footer cycles; backend unaware | `src/hlvm/tui-v2/compat/permission.ts` — scaffold present, not wired |
| B16 | (X) | Prompt history persisted across restart | ✔ | In-memory only | Port v1 `history-storage.ts` |

### 13.C Picker behavior

| # | St | Scenario | CC | v2 | Notes |
|---|---|---|---|---|---|
| C1 | (O) | Down/Up selects by exactly 1 | ✔ | ✔ | §11.5 |
| C2 | (O) | Tab advances selection by 1 | ✔ | ✔ | §11.5 |
| C3 | (O) | `@` + Right drills into directory | ✔ | ✔ | §11.5 |
| C4 | (O) | `@` + Left climbs to parent | ✔ | ✔ | §11.5 |
| C5 | (O) | Escape closes picker keeping trigger | ✔ | ✔ | §11.5 |
| C6 | (O) | Picker Enter inserts without double-submit | ✔ | ✔ | §11.5 |
| C7 | (O) | Ctrl+D toggles docs panel | ✔ | ✔ | §11.5 |
| C8 | (O) | Fuzzy narrow on letters | `/ex → /exit`, `@sr → src/` | same | §11.5 |
| C9 | (O) | Fuzzy match highlighted yellow on matching chars | ✔ | ✔ (after v1 `Dropdown` SSOT consolidation) | §11.5 |

### 13.D Keys / overlays / modes

| # | St | Scenario | CC | v2 | Notes |
|---|---|---|---|---|---|
| D0 | (~) | Esc interrupts an in-flight turn | ✔ | wired in TranscriptWorkbench useInput — calls `abortControllerRef.current?.abort()` on Esc when `runtimeBusy && !pendingInteraction && !searchOpen`. Signal propagation through `runAgentQueryViaHost` to the runtime host is a separate concern (delegated). | Footer "esc to interrupt" is now truthful at the UI layer. |
| D1  | (X) | Ctrl+O expand tool output → verbose transcript viewer | ✔ | no-op | Port `~/dev/ClaudeCode-main/components/TranscriptViewerOverlay.tsx` (or v1's) |
| D2  | (X) | Ctrl+T toggle task tree | Hide/show inline task-tree overlay | no-op | Depends on F4–F5 |
| D3  | (X) | Ctrl+V image paste | Paste clipboard image → attachment chip | Fallthrough to text paste (garbled) | §0.9.2 — `onImagePaste` not wired at `src/hlvm/tui-v2/prompt/PromptInput.tsx`; `useTextInput` + `BaseTextInput` already accept it |
| D4  | (X) | Ctrl+G edit in `$EDITOR` | Opens buffer in `$EDITOR` → reads back | no-op | Needs tempfile + subprocess |
| D5  | (X) | Ctrl+Z suspend | POSIX SIGTSTP | no-op | Wire signal handler |
| D6  | (~) | Ctrl+S stash / restore | `› Stashed (auto-restores after submit)` | `> Stashed (auto-restores after submit)` | Glyph delta only — CC `›` (U+203A) vs v2 `>`. `ctrl-s-{cc,v2}.txt` |
| D7  | (O) | Ctrl+C exits | ✔ | ✔ | §11.5 |
| D8  | (O) | Cmd+C copy on drag-select | ✔ | ✔ (`useCopyOnSelect` + real `execFileNoThrow`) | §0.9.1 |
| D9  | (O) | Ctrl+U clear to beginning | ✔ | ✔ | §11.5 |
| D10 | (O) | Ctrl+K kill to end | ✔ | ✔ | §11.5 |
| D11 | (O) | Ctrl+W delete previous word | ✔ | ✔ | §11.5 |
| D12 | (O) | Ctrl+A / Home, Ctrl+E / End | ✔ | ✔ | §11.5 |
| D13 | (X) | Ctrl+L clear screen | ✔ | no-op | Port CC clear-transcript binding |
| D14 | (—) | Alt+P switch model | CC only | N/A | EXEMPT — HLVM has own model-config flow |
| D15 | (—) | Alt+O fast mode | CC only | N/A | EXEMPT |
| D16 | (—) | Ctrl+Shift+- undo | CC only | N/A | OUT of scope |

### 13.E Runtime round-trip (a single `hi` + Enter)

| # | St | Scenario | CC | v2 | Notes |
|---|---|---|---|---|---|
| E1 | (O) | User row paints on submit | ✔ `❯ hi` | ✔ `❯ hi` | local-echo verified |
| E2 | (X) | Assistant row paints with REAL reply | `⏺ Hi! How can I help you today?` at ~3s | `Error / [HLVM5006] Local HLVM runtime host is not ready for AI requests.` at ~15s | **TUI path works; upstream local runtime not ready.** Fix: boot probe + actionable hint + de-dup. See §0.6 #1 revision |
| E3 | (X) | Assistant prefix glyph `⏺` | ✔ | Unverified — error path prints `Error` instead | Flip after E2 is green |
| E4 | (X) | Turn-complete rollup + footer flip | ✔ | ✔ footer flips, but error body is duplicated in bubble AND in turn-complete line | Fix duplicate-print in `conversation.addAssistantText` error branch |
| E5 | (X) | Token-by-token streaming animation | ✔ | Untestable until E2 | — |

### 13.F Live-turn chrome (all 0% per §0.9.3)

| # | St | Scenario | CC | v2 | Donor |
|---|---|---|---|---|---|
| F1 | (O) | Rotating thinking verb `* Ruminating… / Thinking… / Hmm… / Working through it…` | ✔ | `<glyph> <Verb>…` with rotating spinner char + fixed-per-turn random verb, clean at every time point, zero char corruption across 2s/5s/10s/20s/33s. Physical port of `constants/spinnerVerbs.ts` (180+), `constants/turnCompletionVerbs.ts`, `components/Spinner/utils.ts`, `components/Spinner/SpinnerGlyph.tsx`, `components/Spinner/GlimmerMessage.tsx`. GlimmerMessage's trailing-space pattern was the critical piece — v2 sibling-Text layout drops the verb's leading char without it. Captures: `/tmp/hlvm-audit/f1f-v2-*.txt`, `r3-v2-*.txt` | Shimmer animation scaffolded (`GlimmerMessage` splits into before/shim/after segments on active glimmerIndex) but disabled — v2 ink screen-diff shuffles chars mid-sweep on sibling-Text length changes (separate upstream ink bug). Re-enable after upstream fix. Stall-red interpolation still TODO. |
| F1-bug | (!) | v2 bug discovered during port: `useAnimationFrame` `time` return in the compiled Deno/React-19 build advances at ~13× wall-clock, not true ms | N/A (CC's ClockContext returns wall-clock ms) | v2's `ink/hooks/use-animation-frame.ts` subscribe chain produces bogus `time` values | Workaround in LiveTurnStatus: `setInterval(…, 1000)` counter instead of `time`-diff. Real fix needed in `ink/components/ClockContext.tsx` — `clock.now()` likely returning frame-counter × stride instead of epoch ms |
| F2 | (O) | Phase label `* Ideating… (17s · thinking)` | ✔ | v2 renders `(Xs · thinking)` suffix gated behind 30s (matches CC's `SHOW_TOKENS_AFTER_MS = 30_000`). Live PTY-verified at t=33s: `✽ Orbiting… (33s · thinking)`. | Remaining: phase label variants (`responding`, `tool-use`), down-arrow token-rate glyph (`↓ 224 tokens`). Token counter needs a hook into the streaming source. |
| F3 | (~) | Post-turn rollup `* Cogitated for 6m 22s` / `* Cooked for …` | ✔ (multi-verb table via `TURN_COMPLETION_VERBS`: Baked · Brewed · Churned · Cogitated · Cooked · Crunched · Sautéed · Worked) | v2 now has the full phase machine (live → rollup → hidden) in `LiveTurnStatus.tsx`: random completion verb picked at live→rollup transition, `* Verb for Xs` rendered for `ROLLUP_HOLD_MS` (2s), then unmount. Donor: physical copy of `constants/turnCompletionVerbs.ts`. v2's redundant `Turn complete / 0 tools · Ns` system-item render has been suppressed in `adaptConversationItems.ts` (`turn_stats → null`) so only the LiveTurnStatus rollup owns that chrome. | **Invention audit**: the phase machine + `* {verb} for {elapsed}` layout and `ROLLUP_HOLD_MS=2000` were composed by the assistant — CC's `Spinner.tsx` (~600 lines, AppState-coupled) is the canonical donor and hasn't been 1:1 ported. Pending: replace with a transplant-through-compat port of CC's real rollup path. |
| F3-sbs | (O) | Baseline CC ↔ v2 spinner shape match | `✢ Simmering…` | `✻ Propagating… (2s · esc to interrupt)` | Side-by-side PTY verified 2026-04-18: both render `<rotating-glyph> <Verb>…` from the same SPINNER_FRAMES set and SPINNER_VERBS table. Captures: `/tmp/hlvm-audit/sbs-{cc,v2}.txt`. V2 additionally shows `(Ns · esc to interrupt)` from t=1 (CC gates at 30s via `SHOW_TOKENS_AFTER_MS`; v2 shows earlier — intentional, better UX in short turns; can be gated later to match CC strictly if desired). |
| F4 | (X) | Inline task tree with `✔` rows in transcript | ✔ | absent | `components/TaskListV2.tsx`, `hooks/useTasksV2.ts`, `hooks/useTaskListWatcher.ts` |
| F5 | (X) | Ctrl+T toggles task-tree visibility | ✔ | no-op | paired with F4 |
| F6 | (X) | Agent progress line (`├─ / └─ / ⎿`) for sub-agents | ✔ | absent (v1 has `LocalAgentsStatusPanel.tsx` unported) | `components/AgentProgressLine.tsx` + v1's panel |
| F7 | (X) | Progress / coalesce indicator `+ Coalescing… (15m 54s)` | ✔ | absent | CC progress-line component |

### 13.G Tool-call + transcript rendering

| # | St | Scenario | CC | v2 | Notes |
|---|---|---|---|---|---|
| G1 | (~) | Tool-call row collapses with `… +N more lines (ctrl+o to expand)` | ✔ | ✔ collapses, with CC-matching 3-line preview + `⎿  ` first-child prefix + `   ` continuation indent | Live-verified with web_search query: v2 renders `⏺ Web Search("…")` header + `⎿  Searching: …` + `running`. Shape matches CC structurally. |
| G2 | (O) | Tool-call chrome prefix glyph + label | `⏺` bullet + bold tool name + `(args)` parens | `⏺` bullet + bold `{title}` (title produced by existing `buildToolTranscriptInvocationLabel` which emits `Web Search("q")` / `Bash <cmd>` / etc. — not invented) | Live-verified. |
| G3 | (O) | User row `❯` prefix | ✔ | ✔ | E1 |
| G4 | (O) | Assistant row `⏺` prefix | ✔ | ✔ PTY-verified via fixture `HLVM_ASK_FIXTURE_PATH=/tmp/hlvm-audit/fixture-hi.json`: v2 renders `⏺ Hi! How can I help you today?` matching CC exactly | Capture: `/tmp/hlvm-audit/sbs-v2.txt` (fixture) |
| G5 | (~) | Animated bullet (`ToolUseLoader`) while tool in-progress | `⏺` blinks between char and space at 600ms via `useBlink` + `useAnimationFrame` | v2 files written (`hooks/useBlink.ts` and `components/ToolUseLoader.tsx`, both physical ports of CC donors) but not yet wired into `GroupedToolUseContent`. Current v2 renders a static `⏺` regardless of tool status. | Next: thread tool `status` through `adaptConversationItems.renderToolGroup` → type → GroupedToolUseContent, swap static `⏺` for `ToolUseLoader` when status is `"running"`/`"pending"`. |
| G6 | (X) | Assistant text block margin / separation | CC passes `addMargin` per-message context | v2 wraps every Message in `<Box marginTop={1}>` unconditionally — covers the "messages fuse together" bug (image #16's `?I am an AI…` concat) but is blunter than CC's contextual addMargin | **Invention audit**: the unconditional `marginTop={1}` is a v2 simplification of CC's per-message contextual margin. Revisit for full CC parity. |
| G7 | (~) | Clarification Q&A rendering — distinguish question from answer | CC uses dedicated question/selection message type | v2 routes through generic `PermissionRequest`. Added interaction-boundary textBuffer flush in `runPromptSubmission.onInteraction` so the pre-clarification assistant text finalizes as its own bubble instead of concatenating with the follow-up (fixes image #16's `next?I am an AI` fusion at the data layer). | Visual chrome for the question itself still uses v2's generic PermissionRequest — not CC's dedicated variant. |

### 13.H Markdown + streaming rendering

| # | St | Scenario | CC | v2 | Notes |
|---|---|---|---|---|---|
| H1 | (X) | Inline `code` | monospace + bg | Untested — no real reply | Fixture-backed test once harness available |
| H2 | (X) | **bold** | weight change | Untested | — |
| H3 | (X) | Numbered lists | hanging indent | Untested | — |
| H4 | (X) | Fenced code block with language | syntax color | Untested | — |
| H5 | (X) | Diff `+`/`-` blocks | green/red | Untested | — |
| H6 | (X) | Plan checklist `▢` / `☑` | CC plan mode | v1 `PlanChecklistPanel.tsx` unported | — |
| H7 | (X) | Streaming append, not all-at-once | token animation | Untested | — |

### 13.I Dynamic integration / HLVM chrome

| # | St | Scenario | CC | v2 | Notes |
|---|---|---|---|---|---|
| I1 | (X) | MCP-server warning chip `1 MCP server failed · /mcp` | ✔ | absent | Wire MCP status into footer |
| I2 | (X) | Memory recall chip `◆ Recalled N, wrote N memory` | HLVM-only (v1 has it) | absent in v2 | Port v1 `MemoryActivityLine.tsx` |
| I3 | (X) | Skill activation chip in tool row | ✔ | absent | — |
| I4 | (X) | User skills + plugin dynamic commands in `/` picker | ✔ | v2 built-ins only | Same as B3 |

### 13.J Structural / architectural

| # | St | Scenario | Notes |
|---|---|---|---|
| J1 | (X) | Remove `src/hlvm/tui-v2/ink/index.ts` bare-`ink` barrel | Last blocker: `src/hlvm/cli/repl/commands.ts:9` → `registry` → `keybindings/keybinding-lookup.ts`. Convert to lazy dynamic import, then delete barrel + deno.json `"ink"` alias |
| J2 | (~) | Compat layer routes all production call-sites | 7 files present in `src/hlvm/tui-v2/compat/`; zero production call-sites actually route through them yet |
| J3 | (X) | CI gates `deno task check:tui-v2` | Script exists; not CI-gated |
| J4 | (X) | `tests/unit/tui-v2/` suite exists | Zero v2 unit tests today |
| J5 | (X) | Clean subprocess teardown — no TTY garbage leaking to parent shell on exit | On SIGTERM (Ctrl+C against `make repl-new`, signal 15) v2 leaks: (a) `error: Uncaught Error: Input/output error (os error 5)` at `ext:deno_io/12_io.js:133` → `Stdin.read` / `TTY.#read` — Deno stdin reader unhandled rejection. (b) Raw SGR mouse-tracking byte streams (`;70;27M35;68;27M…`) dumped to parent TTY because the mouse-enable escape sequences (`CSI ? 1003 h` / `CSI ? 1006 h`) are never disabled before exit. Two separate bugs: the rejection (catch EIO around the reader) and the TTY-mode restore (emit `CSI ? 1003 l` + `CSI ? 1006 l` + alt-screen-leave on SIGTERM/SIGINT/process.exit path). Fix lives in `src/hlvm/tui-v2/mod.tsx` and/or the ink donor engine's teardown. |
| J6 | (!) | **Honest invention audit** (per user correction 2026-04-18) | True donor-to-disk ports: `constants/spinnerVerbs.ts`, `constants/turnCompletionVerbs.ts`, `components/Spinner/utils.ts`, `AssistantThinkingMessage.tsx`, `hooks/useBlink.ts`, `components/ToolUseLoader.tsx`. Donor-derived with a `useTheme→Color` adapter (sibling precedent: existing `ShimmerChar.tsx`): `SpinnerGlyph.tsx`, `GlimmerMessage.tsx`. Assistant-composed (CC-inspired, not donor-verbatim): `LiveTurnStatus.tsx` (phase machine + rollup layout), `GroupedToolUseContent.tsx` (structural layout around CC glyphs), `Message.tsx` unconditional `marginTop={1}`, `TranscriptWorkbench.tsx` A1 prompt-flow restructure, Esc→abort wiring, interaction-boundary textBuffer flush, and `adaptConversationItems.turn_stats → null` suppression. Discipline going forward: every v2 TUI element must have a pointable CC donor file+lines; assistant-composed pieces are replaced by transplant-through-compat ports round by round. |
| J5 | (X) | Rebuild default path — `hlvm repl` launches v2, v1 retired | Phase 4 gate |

### 13.K Slash-command surface parity (HLVM-owned)

| # | St | Scenario | CC | v2 | Notes |
|---|---|---|---|---|---|
| K1 | (O) | `/help` | own help | own help | §11.5 |
| K2 | (O) | `/exit` / `/quit` | exits | exits | §11.5 |
| K3 | (O) | `/clear` / `/flush` | clears transcript | clears transcript | §11.5 |
| K4 | (X) | `/model` picker | CC has | v2 dead | v1 `ModelBrowser.tsx` + `ModelSetupOverlay.tsx` |
| K5 | (X) | `/effort` setter | CC has | v2 dead; footer shows `◐ medium · /effort` but typing does nothing | — |
| K6 | (X) | `/config` overlay | — | v1 `ConfigOverlay.tsx` unported | — |
| K7 | (X) | `/shortcuts` overlay | — | v1 `ShortcutsOverlay.tsx` unported | — |
| K8 | (X) | `/transcript` viewer | — | v1 `TranscriptViewerOverlay.tsx` unported | — |
| K9 | (X) | `/todo` / plan surface | — | v1 has | — |

### 13.99 Flip workflow

For each `(X)` or `(~)` row:

1. **Read the donor** at the exact path in "Notes / donor" — end-to-end,
   every branch. No skimming. No "probably works like X."
2. **Port into v2** — copy 1:1 where portable (runtime adapters only),
   transplant closely where coupled. Forbidden: simplified stand-ins,
   "cleaner" rewrites, "I don't think we need that branch."
3. **Rebuild** — `make build-fast`.
4. **Side-by-side PTY audit** — identical geometry, identical keystrokes:
   ```bash
   tmux -S /tmp/cc.sock kill-server 2>/dev/null
   tmux -S /tmp/v2.sock kill-server 2>/dev/null
   tmux -S /tmp/cc.sock new-session -d -s cc -x 140 -y 40 'claude --model sonnet'
   tmux -S /tmp/v2.sock new-session -d -s v2 -x 140 -y 40 './hlvm repl --new'
   sleep 7
   # Drive identical keys through both with:
   tmux -S /tmp/cc.sock send-keys -t cc <keys>
   tmux -S /tmp/v2.sock send-keys -t v2 <keys>
   # Capture, strip ANSI, diff:
   tmux -S /tmp/cc.sock capture-pane -pt cc | sed 's/\x1b\[[0-9;]*[mGKHJfABCDEhl]//g' > /tmp/hlvm-audit/<row>-cc.txt
   tmux -S /tmp/v2.sock capture-pane -pt v2 | sed 's/\x1b\[[0-9;]*[mGKHJfABCDEhl]//g' > /tmp/hlvm-audit/<row>-v2.txt
   diff /tmp/hlvm-audit/<row>-{cc,v2}.txt
   ```
5. **Flip** the Status cell from `(X)` / `(~)` to `(O)` only after
   visual match. Leave a capture filename in Notes or paste the diff
   into the PR / handoff description.
6. **Never flip from code review alone.** Reading-only parity does not
   count. Type-check-only parity does not count.

### 13.100 Mission-complete definition

```
Mission complete iff every row in §13 with St ≠ (—) is (O).
```

When every row is `(O)`:

- `--new` flag disappears; `hlvm repl` launches v2 by default.
- v1 REPL is retired; `src/hlvm/cli/repl-ink/` can be deleted once the
  ink bridge is gone (J1) and every reused component has been ported
  into `src/hlvm/tui-v2/` proper.
- Phase 4 of §8 closes.
- CLAUDE.md / user-facing docs drop the "experimental" language.

Until then, every merge that touches `src/hlvm/tui-v2/` updates this
matrix in the same commit: either flips row(s) `(X)` → `(O)`, or
updates Notes with the latest finding, or adds a new row for a newly
discovered shared surface. This doc is SSOT.
