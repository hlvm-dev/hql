# HLVM REPL TUI v2 - Source of Truth

**Status:** Donor-engine baseline active; Phase 1 donor chat shell is
runtime-backed and launchable, the root shell now runs through donor-style
fullscreen/tmux ownership logic, compiled PTY audits have previously confirmed
multiline input, immediate local echo, queued/busy typing, and in-app
PageUp/PageDown scrolling, and tmux-with-mouse-off now surfaces the donor-style
hint instead of failing silently; v1 investigation confirmed that old-REPL
attachment/reference/history UX should be ported into v2 as app-layer donor
logic rather than by attempting a v1 engine swap, and that migration has now
started inside `PromptInput` (attachments, `@` / `/` completion, history search,
first snippet/placeholder session, donor submit routing, donor file-picker
left/right navigation, and donor queue preview), but this newest prompt slice is
not yet compiled-path parity-verified inside the Codex audit environment and the
direct Codex PTY audit path still trips the local `ReactCurrentOwner` split
**Created:** 2026-04-16 **Last updated:** 2026-04-17 **Doc policy:** This is the
only planning/vision/handoff doc for REPL TUI v2. Any agent working on
`src/hlvm/tui-v2/` must update this file after real verification.

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

## 6. Current live-shell status

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
  [ ] this turn's newest prompt/completion changes have NOT been re-verified in a compiled PTY from inside Codex; direct `./hlvm repl --new` auditing in this tool still hits the local ReactCurrentOwner reconciler split
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
  [x] Compiled-path audit verifies multiline editing
  [x] Compiled-path audit verifies history up/down editing
  [x] Compiled-path audit verifies transcript search can open in the live shell
  [x] Compiled-path audit verifies PageUp/PageDown transcript scrolling
  [x] Compiled-path audit verifies raw wheel-event transcript scrolling
  [~] v1 advanced-composer migration started in PromptInput (attachments, completion, history search, first snippet session, donor submit routing, donor queue preview, donor file-picker left/right behavior)
  [~] donor placeholder/snippet lifecycle is now structurally closer to v1, but compiled-path parity for the newest transitions still needs a live PTY audit
  [~] direct Codex PTY audit of the rebuilt binary still trips the local ReactCurrentOwner split, so newest prompt/completion behavior is source-checked + rebuilt but not re-verified live inside Codex
  [ ] compiled-path audit still needed for the newest PromptInput completion/snippet/file-picker changes
  [~] Transcript search/navigation compat started, not complete
  [~] PromptInput transplanted partially
  [~] Messages/transcript transplanted partially
  [~] Status/permission transplanted partially
  [~] Coherent donor chat shell live and runtime-backed
  [~] Manual human wheel behavior across all terminal/tmux combinations is still not fully audited
  [x] Phase 1 launchable donor chat-shell baseline complete

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
