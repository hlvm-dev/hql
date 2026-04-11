# Potion System — Vision & Design

## One Sentence

"Show me once, do it forever, share it with everyone."

## What It Is

Potions are ESM modules that capture and replay desktop state. The user sets up
their workspace once, HLVM observes it via CU Level 3 (native AX grounding),
the agent generates a replayable ESM module, and the user executes it with one
keypress from Hotbar — or shares it so anyone can install and replay the same
setup.

## Why It Matters

Every existing automation tool requires the user to **program** the automation:

```text
Shortcuts/Automator:   drag blocks, configure each step
Keyboard Maestro:      record macro, edit triggers manually
Shell scripts:         write code
Docker/VM:             configure images, write Dockerfiles
```

Potions invert this: the user **shows** the desired state, and the system
captures it. No programming. No configuration. Just "save what I see."

This is a new interaction pattern. Nobody ships "observe my desktop and make it
reproducible" as a product today.

## The Automation Layer Stack

Potions sit at the highest automation layer — the desktop surface where humans
actually work:

```text
Docker/VM:         OS and runtime level
Homebrew/npm:      package level
Shell scripts:     command level
Shortcuts:         single-app automation level
───────────────────────────────────────────
Potions:           desktop level — the thing the human sees and uses
```

Each layer below is complementary, not competing. A potion can call Docker,
run shell commands, install packages — it orchestrates everything beneath it.

## Full Pipeline

```text
╔══════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║   POTION SYSTEM — End-to-End Pipeline                                   ║
║                                                                          ║
║   "Show me once, do it forever, share it with everyone."                ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝


PHASE A: CAPTURE
════════════════════════════════════════════════════════════════════════════

  The user has already set up their ideal workspace manually.
  Three monitors. Safari with dev docs, JIRA, YouTube music.
  Xcode on monitor 2. Terminal with 4 Claude Code sessions on monitor 3.
  Everything positioned exactly how they want it.

  User opens HLVM (Ctrl+Z or Chat window):

    "save this as my morning-work potion"

       │
       ▼
  ┌─ Agent ReAct Loop (existing orchestrator) ────────────────────────┐
  │                                                                    │
  │  The agent uses its existing tools to observe and generate.       │
  │  No new agent architecture needed — just tool calls.              │
  │                                                                    │
  │  ┌─ Turn 1: Observe ────────────────────────────────────────────┐ │
  │  │                                                              │ │
  │  │  Agent calls: cu_observe (display_id: 1)                     │ │
  │  │                                                              │ │
  │  │     │                                                        │ │
  │  │     ▼                                                        │ │
  │  │  HLVM.app /cu/observe (Level 3 — native AX backend)         │ │
  │  │     │                                                        │ │
  │  │     ├── Screenshot of display 1                              │ │
  │  │     ├── AX tree enumeration:                                 │ │
  │  │     │     • Safari (com.apple.Safari)                        │ │
  │  │     │       - window "Apple Developer" bounds:[0,0,2560,1440]│ │
  │  │     │       - tab bar: 3 tabs                                │ │
  │  │     │       - address bar value: "developer.apple.com"       │ │
  │  │     │     • window positions, display assignment             │ │
  │  │     │                                                        │ │
  │  │     └── Returns structured observation:                      │ │
  │  │           observation_id, targets[], windows[],               │ │
  │  │           frontmost_app, display info                        │ │
  │  │                                                              │ │
  │  └──────────────────────────────────────────────────────────────┘ │
  │                                                                    │
  │  ┌─ Turn 2-3: Observe other displays ───────────────────────────┐ │
  │  │                                                              │ │
  │  │  Agent calls: cu_observe (display_id: 2)                     │ │
  │  │    → Xcode window, project state, bounds                     │ │
  │  │                                                              │ │
  │  │  Agent calls: cu_observe (display_id: 3)                     │ │
  │  │    → Terminal windows, pane layout, bounds                   │ │
  │  │                                                              │ │
  │  └──────────────────────────────────────────────────────────────┘ │
  │                                                                    │
  │  ┌─ Turn 4 (optional): Read deep app state ────────────────────┐ │
  │  │                                                              │ │
  │  │  Agent reads browser tab URLs via AX (address bar values)   │ │
  │  │  Agent reads Terminal session count                          │ │
  │  │  Agent notes which apps are on which displays               │ │
  │  │                                                              │ │
  │  └──────────────────────────────────────────────────────────────┘ │
  │                                                                    │
  │  ┌─ Turn 5: Generate potion ────────────────────────────────────┐ │
  │  │                                                              │ │
  │  │  Agent synthesizes all observations into an ESM module.      │ │
  │  │  Encodes SEMANTIC INTENT, not pixel coordinates:             │ │
  │  │                                                              │ │
  │  │    "open Safari" (not "click pixel 400,300")                 │ │
  │  │    "navigate to developer.apple.com" (not "type into AX:42")│ │
  │  │    "position on display 1, fullscreen" (not "bounds 0,0,    │ │
  │  │     2560,1440")                                              │ │
  │  │                                                              │ │
  │  │  Agent calls: write_file                                     │ │
  │  │    → ~/hlvm-modules/morning-work.mjs                        │ │
  │  │                                                              │ │
  │  └──────────────────────────────────────────────────────────────┘ │
  │                                                                    │
  │  Agent: "Saved morning-work potion. Pin it to Hotbar?"            │
  │                                                                    │
  └────────────────────────────────────────────────────────────────────┘
       │
       ▼
  User drags module from Launchpad → Hotbar slot 1
  (or agent does it: "yes, pin it to slot 1")


PHASE B: REPLAY
════════════════════════════════════════════════════════════════════════════

  Next morning. User presses Ctrl+1 (Hotbar).

  ┌─ GUI (HLVM.app, Swift) ────────────────────────────────────────────┐
  │                                                                     │
  │  Hotbar reads slot 1 binding:                                      │
  │    { module: "morning-work", action: "run" }                       │
  │                                                                     │
  │  POST http://127.0.0.1:11435/module/run                            │
  │    Authorization: Bearer <token>                                   │
  │    { url: "~/hlvm-modules/morning-work.mjs", action: "run" }      │
  │                                                                     │
  └────────────────────────────┬────────────────────────────────────────┘
                               │
                               ▼
  ┌─ Server (Deno, serve.ts) ──────────────────────────────────────────┐
  │                                                                     │
  │  /module/run handler:                                              │
  │    │                                                               │
  │    ├── import("~/hlvm-modules/morning-work.mjs")                   │
  │    │     → cached after first import                               │
  │    │                                                               │
  │    ├── Inject ModuleContext:                                        │
  │    │     { ai, shell, clipboard, fs, fetch, notify, cu }           │
  │    │                          ▲                                     │
  │    │                          │                                     │
  │    │                     NEW: ctx.cu gives modules                  │
  │    │                     access to CU execute_plan                  │
  │    │                                                               │
  │    └── module.run(ctx)                                             │
  │         │                                                          │
  │         ▼                                                          │
  │    ctx.cu.executePlan([...steps...])                                │
  │         │                                                          │
  │         │  No LLM calls. Pure function → native executor.          │
  │         │                                                          │
  │         ▼                                                          │
  │    Bridge → HLVM.app POST /cu/execute-plan                         │
  │                                                                     │
  └────────────────────────────┬────────────────────────────────────────┘
                               │
                               ▼
  ┌─ HLVM.app Native Executor ─────────────────────────────────────────┐
  │                                                                     │
  │  Receives step array. Executes locally, sequentially.              │
  │  No LLM involved. Deterministic.                                   │
  │                                                                     │
  │  ┌─ Step 1: open Safari ─────────────────────────────────────────┐ │
  │  │  NSWorkspace.open(bundleIdentifier: "com.apple.Safari")       │ │
  │  │  AX event subscription: wait for Safari window to appear      │ │
  │  │  ... Safari launches (1-3 seconds) ...                        │ │
  │  │  AX fires: window created → check responsive → ✓ ready       │ │
  │  │                                                               │ │
  │  │  Cost: zero. Local AX wait, no screenshots, no LLM.          │ │
  │  └───────────────────────────────────────────────────────────────┘ │
  │                                                                     │
  │  ┌─ Step 2: navigate tabs ──────────────────────────────────────┐ │
  │  │  AX: find address bar target → type URL → press Enter        │ │
  │  │  Cmd+T → new tab → type URL → Enter                          │ │
  │  │  Cmd+T → new tab → type URL → Enter                          │ │
  │  │  ✓ 3 tabs open                                                │ │
  │  └───────────────────────────────────────────────────────────────┘ │
  │                                                                     │
  │  ┌─ Step 3: position Safari on display 1 ───────────────────────┐ │
  │  │  Layout adapter:                                              │ │
  │  │    Potion says: display 1, fullscreen                         │ │
  │  │    Executor checks: user has display 1? → yes                 │ │
  │  │    Executor reads: display 1 bounds = [0,0,2560,1440]        │ │
  │  │    AX: setPosition(0,0) + setSize(2560,1440) on Safari window│ │
  │  │  ✓ placed                                                     │ │
  │  └───────────────────────────────────────────────────────────────┘ │
  │                                                                     │
  │  ┌─ Step 4: open Xcode ─────────────────────────────────────────┐ │
  │  │  NSWorkspace.open("com.apple.dt.Xcode")                      │ │
  │  │  AX wait: Xcode window ready                                  │ │
  │  │  ... Xcode takes 15-20 seconds to launch ...                  │ │
  │  │  Local wait. Zero cost. No polling screenshots.               │ │
  │  │  AX fires: main window responsive → ✓ ready                  │ │
  │  └───────────────────────────────────────────────────────────────┘ │
  │                                                                     │
  │  ┌─ Step 5: position Xcode on display 2 ────────────────────────┐ │
  │  │  Layout adapter: display 2, fullscreen → resolve bounds      │ │
  │  │  AX: setPosition + setSize                                    │ │
  │  │  ✓ placed                                                     │ │
  │  └───────────────────────────────────────────────────────────────┘ │
  │                                                                     │
  │  ┌─ Step 6: open Terminal + position on display 3 ──────────────┐ │
  │  │  NSWorkspace.open("com.apple.Terminal")                       │ │
  │  │  AX wait → ready                                              │ │
  │  │  Layout adapter: display 3, fullscreen                        │ │
  │  │  ✓ placed                                                     │ │
  │  └───────────────────────────────────────────────────────────────┘ │
  │                                                                     │
  │  ┌─ Blocked? (if any step fails) ───────────────────────────────┐ │
  │  │  Local recovery first:                                        │ │
  │  │    → refresh AX snapshot                                      │ │
  │  │    → refocus target app                                       │ │
  │  │    → short settle wait                                        │ │
  │  │    → re-resolve selector                                      │ │
  │  │    → retry once                                               │ │
  │  │                                                               │ │
  │  │  Still blocked? → return to caller with:                      │ │
  │  │    { completed: 4/6, blocked_at: 5, screenshot, reason }     │ │
  │  │    Potion code can decide: skip, retry, or abort              │ │
  │  └───────────────────────────────────────────────────────────────┘ │
  │                                                                     │
  │  Return: { completed: 6/6, screenshot: <final desktop state> }     │
  │                                                                     │
  └────────────────────────────┬────────────────────────────────────────┘
                               │
                               ▼
  ┌─ Back in module.run(ctx) ──────────────────────────────────────────┐
  │                                                                     │
  │  // Native plan done. Now shell commands for CC sessions.          │
  │  for (let i = 0; i < 4; i++) {                                     │
  │    await ctx.shell(                                                │
  │      'osascript -e \'tell app "Terminal" to do script "claude"\''  │
  │    );                                                              │
  │  }                                                                 │
  │                                                                     │
  │  return { result: "Workspace ready", success: true };              │
  │                                                                     │
  └────────────────────────────┬────────────────────────────────────────┘
                               │
                               ▼
  ┌─ GUI ──────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  Notification: "morning-work complete"                             │
  │  Hotbar slot 1 indicator: ✓                                        │
  │                                                                     │
  │  Total time: ~20-30 seconds (mostly Xcode launch wait)            │
  │  LLM calls: ZERO                                                  │
  │  Token cost: ZERO                                                  │
  │  User effort: one keypress                                         │
  │                                                                     │
  └────────────────────────────────────────────────────────────────────┘


PHASE C: SHARE
════════════════════════════════════════════════════════════════════════════

  The potion is an ESM file. Standard JavaScript module. Share it anywhere.

  ┌─ Distribution Channels ────────────────────────────────────────────┐
  │                                                                     │
  │  LOCAL                                                             │
  │    ~/hlvm-modules/morning-work.mjs                                 │
  │                                                                     │
  │  HLVM REGISTRY (Launchpad App Store)                               │
  │    https://modules.hlvm.dev/morning-work.mjs                       │
  │    → Browse in Launchpad → click Install → pin to Hotbar           │
  │                                                                     │
  │  NPM                                                               │
  │    npm publish hlvm-potion-morning-work                            │
  │    → import via https://esm.sh/hlvm-potion-morning-work            │
  │                                                                     │
  │  ANY URL                                                           │
  │    https://gist.github.com/user/morning-work.mjs                   │
  │    → paste URL into Spotlight → install                            │
  │                                                                     │
  └────────────────────────────────────────────────────────────────────┘

  ┌─ What happens when someone else installs it ───────────────────────┐
  │                                                                     │
  │  New user has 2 monitors (author had 3) and no Xcode.              │
  │                                                                     │
  │  Potion runs:                                                      │
  │    │                                                               │
  │    ├── Prerequisite check:                                         │
  │    │     Xcode missing → engine installs via App Store or brew     │
  │    │     Safari present ✓                                          │
  │    │     Terminal present ✓                                        │
  │    │                                                               │
  │    ├── Layout adaptation:                                          │
  │    │     Potion says: 3 displays                                   │
  │    │     User has: 2 displays                                      │
  │    │     Adapter: display 1 → display 1                            │
  │    │              display 2 → display 2                            │
  │    │              display 3 → display 2 (split or stacked)        │
  │    │                                                               │
  │    └── Execution proceeds with adapted layout                     │
  │         Same apps, same URLs, adapted positioning                  │
  │                                                                     │
  └────────────────────────────────────────────────────────────────────┘


HOW POTIONS FIT THE HLVM VISION
════════════════════════════════════════════════════════════════════════════

  Potions are where all three access patterns converge:

  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                  │
  │  DELEGATE (Chat/Agent)                                          │
  │    "save this as my morning-work potion"                        │
  │    → Agent observes desktop via CU                              │
  │    → Agent generates ESM module                                 │
  │    → One-time AI-powered capture                                │
  │         │                                                       │
  │         ▼                                                       │
  │  ACT (Hotbar / Launchpad)                                       │
  │    Ctrl+1 → replay potion instantly                             │
  │    → Native execution, zero LLM cost                           │
  │    → Daily use, one keypress                                    │
  │         │                                                       │
  │         ▼                                                       │
  │  THINK (Spotlight REPL)                                         │
  │    (run "morning-work")                                         │
  │    → Same execution, different surface                          │
  │    → Or: edit the potion live in REPL                           │
  │                                                                  │
  │  Three surfaces, one potion, one runtime.                       │
  │                                                                  │
  └──────────────────────────────────────────────────────────────────┘
```

## Potion Module Format

```javascript
export const meta = {
  name: "morning-work",
  icon: "briefcase",
  description: "Daily development workspace: Safari + Xcode + Terminal",
  requires: {
    apps: ["com.apple.Safari", "com.apple.dt.Xcode"],
    optional: ["com.spotify.client"],
  },
  actions: {
    run: { label: "Set Up", shortDescription: "Full workspace setup" },
  },
};

export async function run(ctx) {
  // Prerequisite resolver: check and install missing apps
  const missing = await ctx.cu.checkApps(meta.requires.apps);
  if (missing.length > 0) {
    await ctx.cu.installApps(missing);
  }

  await ctx.cu.executePlan([
    // Safari with 3 tabs
    { op: "open_app", bundle_id: "com.apple.Safari" },
    { op: "wait_for_ready", timeout_ms: 10000 },
    { op: "press_keys", keys: ["cmd+l"] },
    { op: "type_text", text: "https://developer.apple.com" },
    { op: "press_keys", keys: ["enter"] },
    { op: "press_keys", keys: ["cmd+t"] },
    { op: "type_text", text: "https://jira.company.com" },
    { op: "press_keys", keys: ["enter"] },
    { op: "press_keys", keys: ["cmd+t"] },
    { op: "type_text", text: "https://music.youtube.com" },
    { op: "press_keys", keys: ["enter"] },

    // Xcode
    { op: "open_app", bundle_id: "com.apple.dt.Xcode" },
    { op: "wait_for_ready", timeout_ms: 30000 },

    // Terminal
    { op: "open_app", bundle_id: "com.apple.Terminal" },
    { op: "wait_for_ready", timeout_ms: 5000 },

    // Position across monitors (semantic layout, not pixel bounds)
    { op: "move_window", bundle_id: "com.apple.Safari",
      display: 1, layout: "fullscreen" },
    { op: "move_window", bundle_id: "com.apple.dt.Xcode",
      display: 2, layout: "fullscreen" },
    { op: "move_window", bundle_id: "com.apple.Terminal",
      display: 3, layout: "fullscreen" },
  ]);

  // Launch 4 Claude Code sessions in Terminal
  for (let i = 0; i < 4; i++) {
    await ctx.shell(
      'osascript -e \'tell app "Terminal" to do script "claude"\''
    );
  }
}
```

## Key Design Decisions

### Semantic intent, not pixel coordinates

Potions encode **what** to do, not **how** at the pixel level:

```text
Semantic (portable):     { op: "open_app", bundle_id: "com.apple.Safari" }
                         { op: "move_window", display: 1, layout: "fullscreen" }

Pixel (brittle):         { op: "click", x: 400, y: 300 }
                         { op: "move_window", bounds: { x: 0, y: 0, w: 2560, h: 1440 } }
```

Semantic potions work across machines with different displays, resolutions,
and app versions. The native executor resolves intent to concrete AX actions
at runtime.

### Prerequisite resolver

When a shared potion references an app the user doesn't have, the replay
engine handles it:

```text
macOS app missing  →  open App Store page or brew install --cask
CLI tool missing   →  brew install
Display fewer      →  reflow layout to available monitors
Login required     →  prompt user, then continue
```

The potion author doesn't write installation logic. The engine is smart;
the potion stays a simple state declaration.

### Layout adaptation

Potions specify layout intent, not hardcoded bounds:

```text
Author: 3 monitors     User: 2 monitors
display 1 → Safari     display 1 → Safari      (same)
display 2 → Xcode      display 2 → Xcode       (same)
display 3 → Terminal   display 2 → Terminal     (reflowed: split or stacked)
```

### Zero LLM cost during replay

```text
Capture:  uses AI (ReAct loop, LLM reasoning, observation)  — one-time cost
Replay:   pure code (ESM → native executor)                  — zero cost forever
```

## Dependencies (Build Order)

```text
1. cu_execute_plan + /cu/execute-plan     gate — the native batch executor
2. /cu/move-window endpoint              small — AX window positioning
3. /module/run server handler            medium — module execution runtime
4. ctx.cu in ModuleContext               small — expose CU to modules
5. Prerequisite resolver                 small — app check/install layer
6. Layout adaptation layer              medium — semantic → concrete bounds
7. Capture prompt engineering            small — teach agent the pattern
```

## Killer Applications

The capture-and-replay pattern is general purpose. Workspace setup is just
the first and most obvious use:

```text
Workspace setup       "save this as my morning-work potion"
QA testing            "click through signup on 3 browsers, screenshot each"
Onboarding            new hire clicks one button → entire dev env sets up
Demo prep             presenter clicks one button → exact demo environment
Accessibility audit   walk app UI → read every AX element → report gaps
Desktop migration     capture old Mac → replay on new Mac
Monitoring dashboard  open Grafana/Datadog/Slack in exact layout every morning
Remote help           create potion for the thing someone always asks you to do
```

## Text Expansion Potions — Universal Prompt Snippets

Beyond desktop automation, potions have a second killer mode: **text expansion
that works anywhere.**

### The Problem

Power users type the same instructions over and over:

```text
"take a hard look at what you did - KISS and DRY and leave only best code
 - no repetition allowed"

"test this, fix any failures, then commit with a clear message"

"refactor this function - extract helpers, remove duplication, keep the
 same public API"
```

These get typed into Claude Code, Codex, Grok, ChatGPT, Cursor, Xcode,
Slack — anywhere with a text field. They're 80-100% reusable. They're
essentially functions that take arguments.

### The Solution

A text expansion potion copies its output to the clipboard and pastes it
into whatever has keyboard focus. It works in **any app on the desktop** —
not just HLVM.

```text
╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║   TEXT EXPANSION POTION — Pipeline                                  ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝

  User is typing in Claude Code (or Cursor, or Slack, or anything).
  They want their standard code review prompt.

  User presses Ctrl+3 (Hotbar shortcut for "review" potion)
       │
       ▼
  ┌─ GUI ─────────────────────────────────────────────────────────────┐
  │  Hotbar slot 3 → { module: "review-prompt", action: "run" }      │
  │  POST :11435/module/run                                          │
  └──────────────────────────┬────────────────────────────────────────┘
                              │
                              ▼
  ┌─ Server ──────────────────────────────────────────────────────────┐
  │  import("~/hlvm-modules/review-prompt.mjs")                      │
  │  module.run(ctx)                                                  │
  │    │                                                              │
  │    ├── ctx.clipboard.read()   ← read what user selected/copied   │
  │    ├── Expand template with context                               │
  │    ├── ctx.clipboard.write(expanded)                              │
  │    └── ctx.cu.pressKeys(["cmd+v"])  ← paste into focused app     │
  │                                                                    │
  └────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
  Text appears at keyboard cursor in whatever app was focused.
  Claude Code, Cursor, Xcode, Slack, browser — doesn't matter.
  Total time: <100ms. One keypress.
```

### Example Potions

```javascript
// ~/hlvm-modules/review-prompt.mjs
export const meta = {
  name: "review-prompt",
  icon: "magnifying-glass",
  description: "Standard code review instruction",
  actions: { run: { label: "Paste", shortDescription: "Review prompt" } },
};

export async function run(ctx) {
  const text = `Take a hard look at what you did. KISS and DRY — leave \
only the best code. No repetition allowed. Verify all tests pass. \
Fix any issues before committing.`;
  await ctx.clipboard.write(text);
  await ctx.cu.pressKeys(["cmd+v"]);
}
```

```javascript
// ~/hlvm-modules/refactor-prompt.mjs — parameterized version
export const meta = {
  name: "refactor-prompt",
  icon: "wrench",
  description: "Refactor instruction with context from clipboard",
  actions: { run: { label: "Paste", shortDescription: "Refactor prompt" } },
};

export async function run(ctx) {
  // Read whatever code the user selected/copied
  const selected = await ctx.clipboard.read();
  const text = `Refactor the following code:
- Extract helpers for any repeated logic
- Remove duplication (DRY)
- Keep the same public API
- Simplify where possible (KISS)
- Run tests after changes

\`\`\`
${selected}
\`\`\``;
  await ctx.clipboard.write(text);
  await ctx.cu.pressKeys(["cmd+v"]);
}
```

```javascript
// ~/hlvm-modules/smart-commit.mjs — AI-enhanced expansion
export const meta = {
  name: "smart-commit",
  icon: "checkmark",
  description: "Generate commit message from staged changes",
  actions: { run: { label: "Paste", shortDescription: "Commit msg" } },
};

export async function run(ctx) {
  const diff = await ctx.shell("git diff --staged");
  // Use HLVM's AI to generate the commit message
  const msg = await ctx.ai.ask(`Write a concise commit message for:\n${diff}`);
  await ctx.clipboard.write(msg);
  await ctx.cu.pressKeys(["cmd+v"]);
}
```

### Why This Is Different From TextExpander / Alfred Snippets

```text
TextExpander:    static text replacement, no code, no AI, no context
Alfred snippets: static text, keyword trigger, no programmatic logic
Raycast snippets: static text + simple variables (date, clipboard)

HLVM potions:    full ESM runtime — read clipboard, run shell commands,
                 call AI, read files, generate dynamic content,
                 paste result into any focused app
```

The difference: potions are **programs**, not templates. They can read your
git diff, ask AI to summarize it, and paste the result. A TextExpander
snippet can insert today's date.

### Where This Goes

```text
Level 1: Static text expansion          "paste my standard review prompt"
Level 2: Context-aware expansion         "read clipboard, wrap in template"
Level 3: AI-powered expansion            "read git diff, generate commit msg"
Level 4: Multi-step orchestration        "read error, search docs, paste fix"
```

All four levels use the same potion format, same Hotbar trigger, same
paste-into-focused-app mechanism. The complexity is in the module code,
not the infrastructure.

### The Insight

Text expansion potions turn Hotbar into a **universal command palette for
every app on the desktop**. Not just HLVM's own UI — every app. Claude Code
gets your standard prompts. Xcode gets your code templates. Slack gets your
standup format. All from the same 10 Hotbar slots, all one keypress each.

The potion ecosystem then lets users share their best prompts and workflows:

```text
@hlvm/prompt-code-review      ← community's best code review prompt
@hlvm/prompt-refactor          ← parameterized refactor instruction
@hlvm/commit-msg-generator     ← AI commit messages from staged diff
@hlvm/standup-generator        ← yesterday's git log → formatted standup
```

Install from Launchpad. Pin to Hotbar. Use in any app. One keypress.

## Risks

1. **Cross-machine replay reliability** — potions must encode semantic intent,
   not machine-specific handles; the layout adapter must handle display
   diversity gracefully
2. **App-specific edge cases** — Electron apps, games, DRM-protected software
   may not expose good AX targets; potions for those apps will need
   coordinate fallbacks
3. **macOS permissions friction** — Accessibility + Screen Recording
   permissions are user friction at install time
4. **Module ecosystem cold start** — Launchpad needs seed content; first
   potions should be built-in (@hlvm/* tier 1)
5. **Layout adaptation UX** — mapping 3-monitor layouts to 1-monitor requires
   thoughtful defaults (stack? split? prioritize?)
