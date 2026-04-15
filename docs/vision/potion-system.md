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

The potion system is the killer feature. Everything below is an application
of it. Same ESM format, same Hotbar trigger, same sharing ecosystem.

```text
╔══════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║   APPLICATION 1: WORKSPACE SETUP                                        ║
║   "save this as my morning-work potion"                                 ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝

  User's morning WITHOUT potion:
    Open Safari. Type developer.apple.com. New tab. Type jira.company.com.
    New tab. Type youtube.com/playlist. Drag Safari to monitor 1.
    Open Xcode. Wait 20 seconds. Drag to monitor 2.
    Open Terminal. Drag to monitor 3. Type "claude". New tab. Type "claude".
    New tab. Type "claude". New tab. Type "claude".
    Total: 3-5 minutes of mechanical clicking. Every. Single. Morning.

  User's morning WITH potion:
    Ctrl+1.
    Done. 20 seconds.

  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  ONE-TIME SETUP:                                                   │
  │                                                                     │
  │  User (to HLVM): "save this as my morning-work potion"             │
  │       │                                                            │
  │       ▼                                                            │
  │  Agent: cu_observe display 1, 2, 3                                 │
  │       → Safari on display 1 with 3 tabs (reads URLs via AX)       │
  │       → Xcode on display 2 fullscreen                              │
  │       → Terminal on display 3 with 4 tabs                          │
  │       │                                                            │
  │       ▼                                                            │
  │  Agent: write_file → ~/hlvm-modules/morning-work.mjs              │
  │  Agent: "Done. Pinned to Hotbar slot 1."                           │
  │                                                                     │
  │  DAILY USE:                                                        │
  │                                                                     │
  │  User presses Ctrl+1                                               │
  │       │                                                            │
  │       ▼                                                            │
  │  Hotbar → POST /module/run → ctx.cu.executePlan([...])             │
  │       │                                                            │
  │       ▼                                                            │
  │  HLVM.app native executor:                                         │
  │    open Safari → AX wait ready → navigate 3 URLs                   │
  │    → position display 1 fullscreen                                 │
  │    open Xcode → AX wait ready (15-20s, zero LLM cost)             │
  │    → position display 2 fullscreen                                 │
  │    open Terminal → AX wait ready → launch 4 claude sessions        │
  │    → position display 3 fullscreen                                 │
  │       │                                                            │
  │       ▼                                                            │
  │  Notification: "morning-work ready"                                │
  │  Zero LLM calls. ~20 seconds. One keypress.                        │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘


╔══════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║   APPLICATION 2: PROJECT CONTEXT SWITCH                                 ║
║   Ctrl+1 = project A, Ctrl+2 = project B                               ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝

  WITHOUT potion:
    Close 6 windows. Open different repo in Xcode. Open different JIRA
    board. Open different Slack channel. Open different browser tabs.
    Open different terminal sessions. Remember which windows go where.
    Do this 5-10 times per day. Lose 30+ minutes daily.

  WITH potion:
    Ctrl+2. Everything switches. 10 seconds.

  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  User is working on Project A. Gets pulled into Project B.         │
  │                                                                     │
  │  User presses Ctrl+2 (Hotbar slot 2 = "project-b" potion)         │
  │       │                                                            │
  │       ▼                                                            │
  │  Potion runs:                                                      │
  │    1. ctx.cu.executePlan: hide/minimize all current windows         │
  │    2. Open Safari → navigate to project-b JIRA board               │
  │    3. Open Xcode → open ~/dev/project-b/project-b.xcodeproj       │
  │    4. Open Terminal → cd ~/dev/project-b                            │
  │    5. Open Slack → switch to #project-b channel                    │
  │    6. Position all windows across displays                          │
  │       │                                                            │
  │       ▼                                                            │
  │  Full project-b workspace in 10 seconds.                           │
  │  Press Ctrl+1 to switch back to project A.                         │
  │                                                                     │
  │  Shareable: team shares project potions so everyone has the        │
  │  same workspace layout for the same project.                        │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘


╔══════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║   APPLICATION 3: SCREENSHOT → BUG REPORT                                ║
║   Select area → Ctrl+3 → formatted bug report in JIRA                  ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝

  WITHOUT potion:
    Take screenshot. Open JIRA. Click "Create Issue." Type title.
    Type description. Attach screenshot. Add system info manually.
    Add reproduction steps from memory. Submit. 5-10 minutes.

  WITH potion:
    Cmd+Shift+4 (screenshot area). Ctrl+3. Done. 15 seconds.

  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  User sees a bug on screen. Takes a screenshot (Cmd+Shift+4).     │
  │  Screenshot is on clipboard.                                       │
  │                                                                     │
  │  User presses Ctrl+3 (Hotbar = "bug-report" potion)               │
  │       │                                                            │
  │       ▼                                                            │
  │  Potion runs:                                                      │
  │    1. ctx.clipboard.read() → screenshot image                      │
  │    2. ctx.ai.ask("Describe this bug from the screenshot")          │
  │       → AI sees the image, generates title + description           │
  │    3. ctx.shell("sw_vers") → macOS version                         │
  │    4. ctx.shell("system_profiler SPHardwareDataType")              │
  │       → hardware info                                              │
  │    5. Read frontmost app info (what app had the bug)               │
  │    6. Compose formatted bug report:                                │
  │       │                                                            │
  │       │  **Title:** Button alignment broken in dark mode           │
  │       │  **App:** Safari 18.2                                      │
  │       │  **OS:** macOS 15.4 (Apple M4 Max)                         │
  │       │  **Steps:** Visible in screenshot — dark mode toggle       │
  │       │  **Expected:** Buttons aligned with nav bar                │
  │       │  **Actual:** Buttons overlap by 8px                        │
  │       │  **Screenshot:** [attached]                                │
  │       │                                                            │
  │    7. ctx.clipboard.write(formatted_report)                        │
  │    8. ctx.cu.executePlan:                                          │
  │       → open browser to JIRA create-issue page                    │
  │       → paste into description field                               │
  │       → attach screenshot                                          │
  │       │                                                            │
  │       ▼                                                            │
  │  Bug report created with screenshot, system info, AI description.  │
  │  User just took a screenshot and pressed one key.                  │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘


╔══════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║   APPLICATION 4: "EXPLAIN THIS" — Universal Understanding               ║
║   Select anything → Ctrl+4 → explanation appears                        ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝

  WITHOUT potion:
    See confusing error/code/legal text. Copy it. Open ChatGPT/Claude.
    Paste it. Type "explain this." Read answer. Switch back. 2 minutes.

  WITH potion:
    Select text. Ctrl+4. Explanation pasted right below. 3 seconds.

  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  User is reading code in Xcode and sees:                           │
  │    "fatal error: unexpectedly found nil while unwrapping           │
  │     an Optional value"                                              │
  │                                                                     │
  │  User selects the error text. Presses Ctrl+4.                      │
  │       │                                                            │
  │       ▼                                                            │
  │  Potion runs:                                                      │
  │    1. ctx.clipboard.read() → the selected error text               │
  │    2. ctx.ai.ask("Explain this clearly and suggest a fix:\n" +     │
  │       selected_text)                                                │
  │       → AI generates plain-language explanation + fix              │
  │    3. ctx.clipboard.write(explanation)                              │
  │    4. ctx.cu.pressKeys(["cmd+v"]) → pastes into focused app       │
  │       │                                                            │
  │       ▼                                                            │
  │  Explanation appears right where the user is working.              │
  │  No app switching. No context loss.                                │
  │                                                                     │
  │  Works on:                                                          │
  │    • Error messages in terminal                                    │
  │    • Code in any editor                                            │
  │    • Legal text in a PDF                                           │
  │    • Medical report in an email                                    │
  │    • Foreign language text anywhere                                │
  │    • Stack traces in browser console                               │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘


╔══════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║   APPLICATION 5: END-OF-DAY STANDUP GENERATOR                           ║
║   Ctrl+5 at 5pm → standup written and posted                           ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝

  WITHOUT potion:
    Open terminal. git log --since yesterday across 3 repos. Read through.
    Open Slack. Try to remember what else you did. Type it up.
    Forget half of it. Send anyway. Every day. 10 minutes.

  WITH potion:
    Ctrl+5. Standup posted to Slack. 5 seconds.

  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  User presses Ctrl+5 (Hotbar = "standup" potion)                   │
  │       │                                                            │
  │       ▼                                                            │
  │  Potion runs:                                                      │
  │    1. ctx.shell("git -C ~/dev/project-a log --since=yesterday      │
  │       --oneline --author=$(git config user.email)")                 │
  │    2. ctx.shell("git -C ~/dev/project-b log --since=yesterday      │
  │       --oneline --author=$(git config user.email)")                 │
  │    3. ctx.shell("git -C ~/dev/project-c log --since=yesterday      │
  │       --oneline --author=$(git config user.email)")                 │
  │    4. Read today's calendar events via ctx.shell("icalBuddy")      │
  │    5. ctx.ai.ask("Write a concise daily standup from:\n" +         │
  │       git_logs + calendar_events)                                   │
  │       │                                                            │
  │       │  **Yesterday:**                                            │
  │       │  - Fixed auth token refresh bug (project-a, 3 commits)    │
  │       │  - Added CU grounding pipeline (project-b, 5 commits)     │
  │       │  - Reviewed PR #142 with design team                       │
  │       │                                                            │
  │       │  **Today:**                                                │
  │       │  - Continue CU reliability testing                         │
  │       │  - 2pm: Sprint planning meeting                            │
  │       │                                                            │
  │    6. ctx.cu.executePlan:                                          │
  │       → open Slack → find #standup channel                        │
  │       → paste formatted standup → send                             │
  │       │                                                            │
  │       ▼                                                            │
  │  Standup posted. Accurate. Complete. Zero effort.                  │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘


╔══════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║   APPLICATION 6: RECEIPT → EXPENSE REPORT                               ║
║   Screenshot receipt → Ctrl+6 → expense spreadsheet updated            ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝

  WITHOUT potion:
    Photo receipt. Open expense tracker. Type vendor name. Type amount.
    Type date. Select category. Attach image. Repeat for every receipt.
    Accountants and freelancers spend hours on this monthly.

  WITH potion:
    Screenshot. Ctrl+6. Data extracted and appended.

  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  User has a receipt (email, PDF, or physical → photo on screen).   │
  │  Takes screenshot (Cmd+Shift+4).                                   │
  │                                                                     │
  │  User presses Ctrl+6 (Hotbar = "expense" potion)                   │
  │       │                                                            │
  │       ▼                                                            │
  │  Potion runs:                                                      │
  │    1. ctx.clipboard.read() → receipt screenshot                    │
  │    2. ctx.ai.ask("Extract from this receipt:                       │
  │       vendor, amount, date, category. Return as JSON.")            │
  │       → { vendor: "Starbucks", amount: 5.40,                      │
  │           date: "2026-04-11", category: "meals" }                  │
  │    3. ctx.shell: append row to ~/expenses/2026-04.csv              │
  │       or: POST to expense API (Expensify, Xero, etc.)             │
  │    4. ctx.notify("Added: Starbucks $5.40 → meals")                │
  │       │                                                            │
  │       ▼                                                            │
  │  Expense logged. Receipt archived. User did nothing but            │
  │  screenshot and press one key.                                     │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘


╔══════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║   APPLICATION 7: TRANSLATE IN PLACE                                     ║
║   Select text → Ctrl+7 → translated, replaced in place                 ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝

  WITHOUT potion:
    Copy text. Open Google Translate. Paste. Select target language.
    Copy result. Switch back. Paste over original. 1-2 minutes.

  WITH potion:
    Select. Ctrl+7. Replaced. 2 seconds.

  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  User is writing an email in Korean. Needs one paragraph           │
  │  in English for a colleague.                                       │
  │                                                                     │
  │  User selects the Korean paragraph. Presses Ctrl+7.                │
  │       │                                                            │
  │       ▼                                                            │
  │  Potion runs:                                                      │
  │    1. ctx.clipboard.read() → Korean text                           │
  │    2. ctx.ai.ask("Translate to English, preserve tone:\n" + text)  │
  │       → English translation                                       │
  │    3. ctx.clipboard.write(translation)                             │
  │    4. ctx.cu.pressKeys(["cmd+v"])                                  │
  │       → replaces selected text with translation                   │
  │       │                                                            │
  │       ▼                                                            │
  │  Korean paragraph is now English. In place. In the email app.      │
  │  No app switching. No copy-paste dance.                            │
  │                                                                     │
  │  Works bidirectionally. Any language pair.                          │
  │  Works in any app with a text field.                               │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘


╔══════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║   APPLICATION 8: ERROR → FIX                                            ║
║   Select error → Ctrl+8 → suggested fix pasted                         ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝

  WITHOUT potion:
    Copy error. Open browser. Search Stack Overflow. Read 5 answers.
    Try one. Doesn't work. Try another. 15-30 minutes.

  WITH potion:
    Select error. Ctrl+8. Fix suggestion appears. 5 seconds.

  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  User sees in terminal:                                            │
  │    "error[E0502]: cannot borrow `x` as mutable because it is      │
  │     also borrowed as immutable"                                    │
  │                                                                     │
  │  User selects the error. Presses Ctrl+8.                           │
  │       │                                                            │
  │       ▼                                                            │
  │  Potion runs:                                                      │
  │    1. ctx.clipboard.read() → error message                         │
  │    2. ctx.shell("cat " + detect_source_file_from_error)            │
  │       → reads the relevant source code                             │
  │    3. ctx.ai.ask("Given this error and code, suggest a fix:\n" +   │
  │       error + "\n\nCode:\n" + source_code)                         │
  │       → AI generates explanation + concrete fix                    │
  │    4. ctx.clipboard.write(fix_suggestion)                          │
  │    5. ctx.cu.pressKeys(["cmd+v"]) → pastes fix                    │
  │       │                                                            │
  │       ▼                                                            │
  │  Fix suggestion with explanation pasted into terminal/editor.      │
  │  User reads it, applies if correct. 5 seconds total.              │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘


╔══════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║   APPLICATION 9: MEETING AUTO-PREP                                      ║
║   Calendar-triggered → workspace ready when you sit down                ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝

  WITHOUT potion:
    Check calendar. Open Zoom link. Hunt for the meeting doc.
    Open relevant PR or JIRA ticket. Arrange windows. Join late
    because you were still setting up. Every meeting.

  WITH potion:
    Sit down. Everything's already open.

  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  Potion is scheduled (or triggered 2 min before meeting).          │
  │                                                                     │
  │  Potion runs automatically:                                        │
  │    1. ctx.shell("icalBuddy -n eventsFrom:now to:'+5 min'")        │
  │       → "Sprint Planning — zoom.us/j/123 — see PR #142"           │
  │    2. Parse meeting description for links                          │
  │    3. ctx.cu.executePlan:                                          │
  │       → open Safari → navigate to PR #142                         │
  │       → open Zoom → join meeting link                              │
  │       → open JIRA sprint board                                    │
  │       → arrange: Zoom left half, PR right half, JIRA display 2    │
  │       │                                                            │
  │       ▼                                                            │
  │  User walks to desk. Zoom is joined. PR is open.                  │
  │  JIRA board is on the second monitor. Ready to talk.              │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘


╔══════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║   APPLICATION 10: ONBOARDING — New Hire Setup                           ║
║   Day 1: click one button → entire dev environment ready               ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝

  WITHOUT potion:
    Follow a 47-step wiki page. Install Homebrew. Install Node.
    Install Xcode CLI tools. Clone 5 repos. Set up SSH keys.
    Configure environment variables. Install VS Code extensions.
    Set up Docker. Import database. Run migrations.
    Takes half a day. Something always fails. Ask a teammate for help.

  WITH potion:
    Install HLVM. Open Launchpad. Click "company-dev-setup." Go get coffee.

  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  New hire on Day 1. Fresh Mac. Opens HLVM Launchpad.               │
  │                                                                     │
  │  Searches "company-dev-setup". Clicks Install. Clicks Run.         │
  │       │                                                            │
  │       ▼                                                            │
  │  Potion runs:                                                      │
  │    1. Prerequisite check:                                          │
  │       Homebrew? No → ctx.shell(install homebrew)                   │
  │       Git? No → ctx.shell("brew install git")                      │
  │       Node? No → ctx.shell("brew install node")                    │
  │       Xcode CLI? No → ctx.shell("xcode-select --install")         │
  │       Docker? No → ctx.cu: open Docker website → download → install│
  │                                                                     │
  │    2. Repo setup:                                                  │
  │       ctx.shell("git clone git@github.com:company/frontend.git")   │
  │       ctx.shell("git clone git@github.com:company/backend.git")    │
  │       ctx.shell("git clone git@github.com:company/infra.git")      │
  │       ctx.shell("cd frontend && npm install")                      │
  │       ctx.shell("cd backend && pip install -r requirements.txt")   │
  │                                                                     │
  │    3. Environment:                                                 │
  │       Copy .env.example → .env for each repo                      │
  │       ctx.shell("docker compose up -d") → database                │
  │       ctx.shell("cd backend && python manage.py migrate")         │
  │                                                                     │
  │    4. IDE setup:                                                   │
  │       ctx.cu: open VS Code → install extensions from list          │
  │       Configure settings.json with team defaults                   │
  │                                                                     │
  │    5. Workspace layout:                                            │
  │       ctx.cu.executePlan: position VS Code, browser (localhost),   │
  │       terminal across available displays                           │
  │       │                                                            │
  │       ▼                                                            │
  │  New hire comes back from coffee. Everything is running.           │
  │  Browser shows the app at localhost:3000.                          │
  │  VS Code has the repos open. Terminal has servers running.         │
  │  Day 1 productivity: immediate.                                    │
  │                                                                     │
  │  The potion is maintained by the team. Updated when the stack      │
  │  changes. Every new hire gets the same experience.                 │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
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

## System-Wide REPL — nREPL for the Desktop

The potion system has a deeper foundation that makes it uniquely powerful:
HLVM runs as a **persistent background daemon** with a live REPL engine.

### What This Means

```text
Traditional REPL:     open terminal → start repl → type code → see result
                      works in ONE window, dies when you close it

nREPL (Clojure):      editor connects to running JVM → eval in context
                      works in ONE editor, tied to one project

HLVM REPL:            daemon always running → eval from ANYWHERE on desktop
                      keyboard cursor in any app = REPL input
                      result pastes back to that same cursor
```

The `hlvm serve` process (localhost:11435) is always alive in the background.
It holds persistent state: REPL bindings, module cache, memory, AI runtime,
globalThis. That state never dies (until app restart). Any surface — Spotlight,
Hotbar, Chat, or a potion — can evaluate code against that shared runtime.

### How It Connects to Potions

Potions are ESM modules that run inside this daemon. When a potion calls
`ctx.ai.ask()` or `ctx.shell()`, it's executing against the live runtime.
When it calls `ctx.cu.pressKeys(["cmd+v"])`, it's pasting into whatever
app has keyboard focus.

The combination:

```text
Live daemon runtime     +  keyboard focus anywhere  =  nREPL for the OS
(persistent state,         (paste result to cursor)
 AI, shell, CU, memory)
```

### Pipeline

```text
╔══════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║   SYSTEM-WIDE REPL — Evaluate Anywhere                                  ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝

  User is in ANY app. Xcode. Slack. Browser. Terminal. Doesn't matter.

  ┌─ Path A: Spotlight Eval ───────────────────────────────────────────┐
  │                                                                     │
  │  User presses global hotkey (Ctrl+Z)                               │
  │  Spotlight panel appears floating above all windows                │
  │       │                                                            │
  │       ▼                                                            │
  │  User types HQL expression:                                        │
  │    (-> (clipboard) json-parse (get "users") (map :name))           │
  │       │                                                            │
  │       ▼                                                            │
  │  POST :11435/api/chat { mode: "eval" }                             │
  │       │                                                            │
  │       ▼                                                            │
  │  Server: HQL transpiler → JS eval → REPL context (persistent)     │
  │       │                                                            │
  │       ▼                                                            │
  │  Result shown inline: ["Alice", "Charlie", "Eve"]                  │
  │  User copies result or pipes into next expression                  │
  │  Spotlight dismisses. User is back in their original app.          │
  │                                                                     │
  │  The REPL state persists. Next eval can reference previous results.│
  │  (defn my-filter ...) survives across sessions.                    │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘

  ┌─ Path B: Hotbar Eval (potion as inline REPL) ─────────────────────┐
  │                                                                     │
  │  User is in Slack. Wants to evaluate code and paste the result.    │
  │                                                                     │
  │  User presses Ctrl+5 (Hotbar = "eval-clipboard" potion)            │
  │       │                                                            │
  │       ▼                                                            │
  │  Potion runs:                                                      │
  │    1. ctx.clipboard.read() → selected code or expression           │
  │    2. ctx.eval(clipboard_content)                                  │
  │       → evaluates HQL/JS in the persistent REPL context            │
  │       → has access to globalThis.ai, all defn's, module cache     │
  │    3. ctx.clipboard.write(result)                                  │
  │    4. ctx.cu.pressKeys(["cmd+v"])                                  │
  │       → result pastes at keyboard cursor in Slack                  │
  │       │                                                            │
  │       ▼                                                            │
  │  The evaluated result appears in Slack (or Xcode, or browser,     │
  │  or any app). The REPL ran in the background daemon.              │
  │  The user never left their app.                                    │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘

  ┌─ Path C: AI Functions Anywhere ────────────────────────────────────┐
  │                                                                     │
  │  User selects messy JSON in VS Code. Presses Ctrl+6.              │
  │       │                                                            │
  │       ▼                                                            │
  │  Potion runs:                                                      │
  │    1. ctx.clipboard.read() → messy JSON string                     │
  │    2. ctx.eval('(-> (clipboard) json-parse json-pretty)')          │
  │       → HQL: read clipboard → parse → pretty-print                │
  │    3. ctx.clipboard.write(pretty_json)                             │
  │    4. ctx.cu.pressKeys(["cmd+v"]) → replaces selection             │
  │       │                                                            │
  │       ▼                                                            │
  │  Messy JSON is now pretty-printed in VS Code.                     │
  │  HQL pipeline ran in the daemon. Result pasted in place.          │
  │                                                                     │
  │  Or with AI:                                                       │
  │                                                                     │
  │  User selects English text in Mail. Presses Ctrl+7.               │
  │       │                                                            │
  │       ▼                                                            │
  │  Potion runs:                                                      │
  │    1. ctx.clipboard.read() → English text                          │
  │    2. ctx.eval('(ask "translate to Korean:\n" (clipboard))')       │
  │       → HQL ask function → calls AI → Korean translation          │
  │    3. ctx.clipboard.write(korean_text)                             │
  │    4. ctx.cu.pressKeys(["cmd+v"]) → replaces selection             │
  │       │                                                            │
  │       ▼                                                            │
  │  English text is now Korean. In Mail. AI ran in the daemon.       │
  │  User never opened a chat window or AI tool.                      │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

### What Makes This Different

```text
Jupyter:         REPL in a browser tab, tied to one kernel/project
nREPL:           REPL in an editor, tied to one JVM/project
Terminal REPL:   REPL in one window, dies when closed
VS Code console: REPL in one editor, limited to that editor

HLVM daemon:     REPL that is ALWAYS alive, accessible from ANY app,
                 with persistent state, AI functions, shell access,
                 CU desktop control, and the ability to paste results
                 into whatever has keyboard focus
```

The daemon + potions + keyboard focus = every app on the desktop gains
a programmable, AI-powered REPL backend. The user doesn't need to
switch to a REPL. The REPL comes to them.

### The Compound Effect

This is where workspace potions, text expansion potions, and the system-wide
REPL combine into something greater than the parts:

```text
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│  HLVM.app (menu bar, always running)                            │
│    │                                                            │
│    ├── hlvm serve daemon (localhost:11435, always alive)         │
│    │     │                                                      │
│    │     ├── Persistent REPL state (defn's, bindings, history)  │
│    │     ├── AI runtime (local Gemma + cloud providers)         │
│    │     ├── Memory (SQLite FTS5, facts, entities)              │
│    │     ├── Module cache (imported potions)                    │
│    │     ├── CU bridge (Level 3 native AX grounding)           │
│    │     └── MCP servers (external tool integrations)           │
│    │                                                            │
│    ├── Spotlight (Ctrl+Z) → eval HQL/JS, see result inline     │
│    ├── Hotbar (Ctrl+1..0) → fire potions, paste into any app   │
│    ├── Chat (window) → full agent ReAct loop                   │
│    └── Launchpad → browse/install/share potions                │
│                                                                  │
│  The daemon is the brain. The surfaces are the hands.           │
│  Potions are the muscle memory.                                 │
│  The keyboard cursor is the universal output target.            │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

Every app on the desktop becomes AI-augmented. Not because every app
has AI built in, but because the daemon is always there, one keypress
away, ready to evaluate, generate, transform, and paste.

## REPL + Potions: Compound Capabilities

The persistent daemon REPL transforms potions from isolated scripts into a
**living system** where actions build on each other over time.

### 1. Accumulating Context Across Potions

```text
╔══════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║   SHARED STATE — Potions talk to each other through the daemon           ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝

  9:00 AM  User presses Ctrl+1 (workspace setup)
           → Daemon records: project-a active, 3 repos, JIRA board open

  10:30 AM User presses Ctrl+3 (bug report)
           → Daemon already knows: project-a, current branch, recent commits
           → Bug report auto-fills project context without user typing it

  5:00 PM  User presses Ctrl+5 (standup)
           → Daemon knows: worked on project-a all day, filed 2 bugs,
             switched to project-b at 2pm, attended Sprint Planning
           → Standup is complete and accurate — built from the day's state

  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  Without shared state:  each potion starts from zero               │
  │  With shared state:     each potion inherits the day's context     │
  │                                                                     │
  │  The daemon accumulates knowledge passively.                       │
  │  Potions get smarter the more you use them.                        │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

### 2. User-Defined Functions Across All Potions

```text
  User types in Spotlight once:
    (defn my-review [code]
      (ask "Review this code. KISS/DRY only. No repetition:\n" code))

  Now EVERY potion can call (my-review ...).
  The review potion, the refactor potion, the commit potion — all use it.
  Change the function once → all potions update. Live. No reinstall.

  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  Spotlight REPL     →  define functions                            │
  │  Potion modules     →  use those functions                         │
  │  Daemon runtime     →  holds them alive forever                    │
  │                                                                     │
  │  Users build personal libraries of AI functions                    │
  │  that work across all potions and all apps.                        │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

### 3. Chained Potions as Pipelines

```text
╔══════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║   PIPELINE MODE — Each keypress advances a multi-step transformation    ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝

  User has messy code in VS Code.

  Step 1: Select code → Ctrl+4 (explain)
          → AI reads code, generates explanation
          → Explanation pastes below the code
          → Daemon stores: { lastInput: code, lastOutput: explanation }

  Step 2: Ctrl+6 (improve)
          → Potion reads daemon state: knows the code AND the explanation
          → AI generates improved version, informed by the explanation
          → Improved code pastes, replacing the original
          → Daemon stores: { improved: true, diff: ... }

  Step 3: Ctrl+9 (commit)
          → Potion reads daemon state: knows what changed and why
          → AI generates commit message from the improvement context
          → Message pastes into terminal

  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  Three keypresses. No copy-paste between them.                     │
  │  Each potion reads the previous one's output from daemon state.    │
  │  The user builds up complex transformations one shortcut at a time.│
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

### 4. Ambient Intelligence

```text
  The daemon remembers everything it processes. After a week of use:

  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  From workspace potions:  knows which projects you work on         │
  │  From bug report potions: knows your recurring bugs                │
  │  From standup potions:    knows your work patterns                 │
  │  From translate potions:  knows your language pairs                │
  │  From clipboard:          knows what you copy frequently           │
  │  From error→fix potions:  knows your common mistakes               │
  │                                                                     │
  │  A potion can ask:                                                 │
  │    (memory-search "that auth bug from Tuesday")                    │
  │    → returns real context from the daemon's accumulated knowledge  │
  │                                                                     │
  │  The system learns your work without explicit teaching.            │
  │  Not a separate "training" step — just side effects of daily use. │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```


## More Killer Applications

These applications leverage the compound capabilities — shared daemon state,
CU desktop control, AI, and the potion format working together.

```text
╔══════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║   APPLICATION 11: "DO WHAT I JUST DID, FOR ALL OF THESE"                ║
║   One manual demo → batch automation                                    ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝

  WITHOUT potion:
    Fill one form field on a website. Copy value from spreadsheet.
    Paste into form. Click next field. Copy next value. Paste.
    Repeat 50 times. 45 minutes of mechanical clicking.

  WITH potion:
    Fill ONE field manually. Say "do that for the other 50 rows."

  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  User has a spreadsheet with 50 vendor names + addresses.          │
  │  Needs to enter each one into a web form.                          │
  │                                                                     │
  │  User fills the first one manually while CU observes:              │
  │    1. CU watches: user clicked text field "Company Name"           │
  │    2. CU watches: user typed "Acme Corp"                           │
  │    3. CU watches: user tabbed to "Address" field                   │
  │    4. CU watches: user typed "123 Main St"                         │
  │    5. CU watches: user clicked "Submit"                            │
  │                                                                     │
  │  User (to HLVM): "do that for the other 49 from my spreadsheet"   │
  │       │                                                            │
  │       ▼                                                            │
  │  Agent:                                                            │
  │    1. Reads the spreadsheet (ctx.shell or CU → Numbers/Excel)      │
  │    2. Generates a potion that replays the pattern with each row:   │
  │       for each row:                                                │
  │         → cu_execute_plan: click "Company Name" → type row.name   │
  │         → tab → type row.address → click Submit                   │
  │         → wait_for_ready (form resets)                             │
  │    3. Executes — 50 submissions in 3 minutes                       │
  │                                                                     │
  │  The user demonstrated once. CU learned the pattern.              │
  │  The agent generalized it. The native executor batched it.         │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘


╔══════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║   APPLICATION 12: SMART CLIPBOARD HISTORY                                ║
║   Everything you copy, AI-tagged, semantically searchable               ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝

  WITHOUT potion:
    "I copied a URL from Slack yesterday... was it in #engineering?
    Or was it an email? Let me search through 4 apps for 10 minutes."

  WITH potion:
    Ctrl+Z → "that API endpoint from yesterday" → found instantly.

  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  Background: daemon listens to clipboard changes (opt-in).         │
  │                                                                     │
  │  Every Cmd+C goes through the daemon:                              │
  │    1. Content captured: text, image, or URL                        │
  │    2. AI tags it: { type: "url", topic: "API", source: "Slack",   │
  │       timestamp: "2026-04-13 14:32", preview: "https://api..." }  │
  │    3. Stored in daemon memory (SQLite FTS5)                        │
  │                                                                     │
  │  Later, user needs that URL:                                       │
  │                                                                     │
  │  User presses Ctrl+Z (Spotlight):                                  │
  │    "that API endpoint from yesterday"                              │
  │       │                                                            │
  │       ▼                                                            │
  │  Daemon: semantic search over clipboard history                    │
  │    → finds: "https://api.company.com/v2/users"                    │
  │    → shows: source app, timestamp, surrounding context             │
  │       │                                                            │
  │       ▼                                                            │
  │  User clicks result → copied to clipboard → paste anywhere        │
  │                                                                     │
  │  Not string matching. Semantic search.                             │
  │  "that thing I copied from the design doc" works.                  │
  │  "the SQL query from Slack" works.                                 │
  │  "credentials from the email" works (but marked sensitive).        │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘


╔══════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║   APPLICATION 13: SCREENSHOT → WORKING CODE                             ║
║   Screenshot any UI → SwiftUI/HTML/CSS pasted into editor               ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝

  WITHOUT potion:
    See a beautiful UI on Dribbble. Try to recreate it manually.
    Guess the colors, spacing, fonts. 2-4 hours of trial and error.

  WITH potion:
    Screenshot it. Ctrl+8. Code appears in your editor. 10 seconds.

  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  User sees a login screen design on Dribbble they want to copy.    │
  │  Takes screenshot (Cmd+Shift+4).                                   │
  │                                                                     │
  │  User switches to Xcode. Presses Ctrl+8 (Hotbar = "ui-to-code")   │
  │       │                                                            │
  │       ▼                                                            │
  │  Potion runs:                                                      │
  │    1. ctx.clipboard.read() → screenshot image                      │
  │    2. Detect target: user is in Xcode → generate SwiftUI           │
  │       (if VS Code → generate React/HTML, if Figma → generate CSS) │
  │    3. ctx.ai.ask("Generate SwiftUI that reproduces this UI:\n" +   │
  │       screenshot, { vision: true })                                │
  │       → AI sees the design, generates matching code                │
  │    4. ctx.clipboard.write(swiftui_code)                            │
  │    5. ctx.cu.pressKeys(["cmd+v"]) → pastes into Xcode             │
  │       │                                                            │
  │       ▼                                                            │
  │  SwiftUI code appears in Xcode. Preview shows a close match.      │
  │  User tweaks colors/spacing. 10 minutes instead of 4 hours.       │
  │                                                                     │
  │  Works for:                                                        │
  │    • Dribbble/Behance designs → production code                   │
  │    • Competitor app screenshots → your implementation              │
  │    • Whiteboard wireframes → working prototypes                   │
  │    • Client mockups (PDF/image) → functional UI                   │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘


╔══════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║   APPLICATION 14: DAILY BRIEFING                                        ║
║   First keypress of the day → "here's what needs your attention"        ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝

  WITHOUT potion:
    Open Mail — scan 40 emails. Open Slack — scroll through 12 channels.
    Open GitHub — check notifications. Open Calendar — see today's meetings.
    Takes 20-30 minutes just to know what's happening. Every morning.

  WITH potion:
    Ctrl+Z → "briefing" or auto-triggered on first Hotbar press of the day.

  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  User opens laptop. Presses Ctrl+Z. Types "briefing."             │
  │  (Or: daemon detects first interaction of the day → auto-runs.)    │
  │       │                                                            │
  │       ▼                                                            │
  │  Potion runs:                                                      │
  │    1. ctx.shell("icalBuddy -n eventsToday")                        │
  │       → 3 meetings, Sprint Planning at 2pm                        │
  │    2. ctx.cu.executePlan:                                          │
  │       → open Mail → AX: read subject lines of unread (no clicks)  │
  │       → 8 unread: 2 urgent, 4 FYI, 2 spam                         │
  │    3. ctx.cu.executePlan:                                          │
  │       → open Slack → AX: read unread badge counts per channel     │
  │       → #incidents: 3 unread, #engineering: 12, #general: 5       │
  │    4. ctx.shell("gh api notifications --jq '.[].subject.title'")  │
  │       → 2 PR reviews requested, 1 issue assigned                  │
  │    5. ctx.ai.ask("Summarize into 5-line morning briefing:\n" +     │
  │       calendar + emails + slack + github)                          │
  │       │                                                            │
  │       │  TODAY:                                                    │
  │       │  ⚠ #incidents has 3 unread — check first                  │
  │       │  📬 2 urgent emails: deploy approval + client escalation  │
  │       │  📋 2 PRs need your review (auth-refactor, api-v3)        │
  │       │  📅 Sprint Planning at 2pm — prep: review sprint backlog  │
  │       │  💬 12 unread in #engineering — mostly discussion          │
  │       │                                                            │
  │       ▼                                                            │
  │  Shown in Spotlight inline. User reads 5 lines. Knows the day.    │
  │  No app-hopping. No scrolling through noise. 15 seconds.          │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘


╔══════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║   APPLICATION 15: FORM AUTO-FILL FROM MEMORY                            ║
║   Daemon remembers your answers → fills forms for you                   ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝

  WITHOUT potion:
    Fill out job application #47. Type your name again. Your address again.
    Your phone number. Your LinkedIn. Your portfolio. Paste resume.
    The same 15 fields, the 47th time. 10 minutes of mechanical entry.

  WITH potion:
    Open the form. Ctrl+9. All known fields filled. Review and submit.

  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  User opens a web form (job application, client intake, etc.).     │
  │  Presses Ctrl+9 (Hotbar = "auto-fill" potion).                    │
  │       │                                                            │
  │       ▼                                                            │
  │  Potion runs:                                                      │
  │    1. ctx.cu.observe() → reads all form fields via AX              │
  │       → [{ role: "textField", label: "Full Name" },                │
  │          { role: "textField", label: "Email" },                    │
  │          { role: "textField", label: "Phone" },                    │
  │          { role: "textArea", label: "Cover Letter" }, ...]         │
  │                                                                     │
  │    2. Match labels against daemon memory:                          │
  │       "Full Name" → memory has "Seoksun Jang" (from last form)    │
  │       "Email" → memory has "seoksun@..." (from last form)         │
  │       "Phone" → memory has "+82..." (from last form)              │
  │       "Cover Letter" → no exact match, but has previous version   │
  │                                                                     │
  │    3. ctx.cu.executePlan:                                          │
  │       → click "Full Name" → type stored value                     │
  │       → click "Email" → type stored value                         │
  │       → click "Phone" → type stored value                         │
  │       → click "Cover Letter" → paste previous version             │
  │                                                                     │
  │    4. Unknown fields left empty for user to fill manually          │
  │       → daemon learns new answers for next time                   │
  │       │                                                            │
  │       ▼                                                            │
  │  12 of 15 fields auto-filled. User fills 3 unique ones.           │
  │  Next time this form appears: 14 of 15 auto-filled.               │
  │  The potion gets better with every use.                            │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘


╔══════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║   APPLICATION 16: CROSS-APP DATA SYNC                                   ║
║   "When I update this cell, update the same field in the CRM"           ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝

  WITHOUT potion:
    Update price in spreadsheet. Copy it. Open CRM. Find the record.
    Edit field. Paste. Save. Copy next value from spreadsheet.
    Open CRM. Find next record. Repeat 30 times. Build Zapier integration
    that costs $50/month and breaks when the form changes.

  WITH potion:
    Update spreadsheet. Ctrl+0. CRM synced.

  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  User updates prices in a Numbers spreadsheet.                     │
  │  Presses Ctrl+0 (Hotbar = "sync-to-crm" potion).                  │
  │       │                                                            │
  │       ▼                                                            │
  │  Potion runs:                                                      │
  │    1. ctx.cu.observe() → reads the spreadsheet via AX              │
  │       → extracts visible rows: product names + new prices          │
  │                                                                     │
  │    2. For each changed row:                                        │
  │       ctx.cu.executePlan:                                          │
  │         → switch to browser (CRM tab)                              │
  │         → search for product name                                  │
  │         → click into price field                                   │
  │         → clear + type new price                                   │
  │         → click Save                                               │
  │         → switch back to Numbers                                   │
  │                                                                     │
  │    3. ctx.notify("Synced 12 prices to CRM")                        │
  │       │                                                            │
  │       ▼                                                            │
  │  Spreadsheet → CRM sync done. No API integration. No Zapier.      │
  │  CU navigates the CRM the same way a human would.                 │
  │  Works with ANY web app — no connectors needed.                    │
  │                                                                     │
  │  The poor man's Zapier that works with every desktop app.          │
  │  No API required. No monthly fee. Just CU + a potion.             │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘


╔══════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║   APPLICATION 17: FOCUS MODE                                            ║
║   One keypress → distraction-free + auto-restore                        ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝

  WITHOUT potion:
    Manually close Slack. Close Mail. Close Messages. Turn on DND in
    System Settings. Remember what was open. 2 hours later: manually
    re-open everything, turn off DND. Forget which tabs were open.

  WITH potion:
    Ctrl+7. Everything disappears. Timer starts. When done: everything back.

  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  User needs to focus for 2 hours. Presses Ctrl+7.                  │
  │       │                                                            │
  │       ▼                                                            │
  │  Potion runs:                                                      │
  │    1. ctx.cu.observe() → snapshot all open windows + positions     │
  │       → saved to daemon state (for later restore)                  │
  │                                                                     │
  │    2. ctx.cu.executePlan:                                          │
  │       → hide Slack, Mail, Messages, Discord                        │
  │       → keep only Xcode + Terminal visible                         │
  │                                                                     │
  │    3. ctx.shell("shortcuts run 'Focus'") → macOS Focus mode on    │
  │                                                                     │
  │    4. Start 2-hour timer in daemon state                           │
  │                                                                     │
  │    ... 2 hours pass ...                                            │
  │                                                                     │
  │    5. Timer fires → potion auto-runs restore:                      │
  │       → unhide all previously hidden apps                          │
  │       → restore window positions from snapshot                     │
  │       → turn off Focus mode                                        │
  │       → ctx.notify("Focus session done. 2h 0m. Restoring.")       │
  │       │                                                            │
  │       ▼                                                            │
  │  Everything is exactly as it was before focus mode.                │
  │  User didn't manually hide or restore anything.                    │
  │  Daemon state held the snapshot across 2 hours.                    │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘


╔══════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║   APPLICATION 18: CODE REVIEW PREP                                      ║
║   One keypress → diff + JIRA + Slack context → review briefing          ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝

  WITHOUT potion:
    Click PR link. Read the diff. Open JIRA ticket mentioned in PR
    description. Read ticket context. Open Slack — find discussion thread
    about this feature. Tab-hop between 4 apps while trying to understand
    the change. 15-20 minutes of context gathering before writing one
    review comment.

  WITH potion:
    Copy PR URL. Ctrl+6. Briefing document with all context appears.

  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  User copies a PR URL. Presses Ctrl+6 (Hotbar = "review-prep").    │
  │       │                                                            │
  │       ▼                                                            │
  │  Potion runs:                                                      │
  │    1. ctx.clipboard.read() → PR URL                                │
  │    2. ctx.shell("gh pr view 142 --json ...")                       │
  │       → title, description, diff stats, linked issues              │
  │    3. ctx.shell("gh pr diff 142")                                  │
  │       → full diff                                                  │
  │    4. Parse JIRA ticket from PR description                        │
  │       → ctx.cu.executePlan: open JIRA ticket → AX read content    │
  │    5. Parse Slack channel from PR description                      │
  │       → ctx.cu.executePlan: open Slack → find thread → AX read    │
  │    6. ctx.ai.ask("Generate a review briefing from:\n" +            │
  │       diff + jira_context + slack_discussion)                      │
  │       │                                                            │
  │       │  REVIEW BRIEFING: PR #142 — Auth token refresh             │
  │       │                                                            │
  │       │  Context: JIRA-456 — users getting logged out randomly     │
  │       │  Root cause: refresh token race condition (Slack thread:   │
  │       │  Alice found it on 4/10, Bob confirmed with prod logs)     │
  │       │                                                            │
  │       │  Changes: 3 files, 47 additions                            │
  │       │  - token-service.ts: added mutex around refresh            │
  │       │  - auth-middleware.ts: retry on 401 before redirect        │
  │       │  - token-service.test.ts: 4 new tests for race scenario   │
  │       │                                                            │
  │       │  Watch for: thread-safety of the mutex implementation     │
  │       │  Missing: no test for concurrent refresh from 2 tabs      │
  │       │                                                            │
  │       ▼                                                            │
  │  User has full context before reading a single line of code.       │
  │  Knows what to look for. Review quality goes up. Time goes down.   │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘


╔══════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║   APPLICATION 19: CROSS-APP UNDO                                        ║
║   "Undo what I just did" — across multiple apps                         ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝

  WITHOUT potion:
    Potion opened 5 apps, positioned windows, navigated tabs.
    Something's wrong — you want to go back to how it was before.
    Manually close each app. Try to remember original window positions.
    Give up and just start over.

  WITH potion:
    Ctrl+Z → "undo last potion" → everything reverts.

  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  The daemon tracks every potion's actions as a reversible log:     │
  │                                                                     │
  │  Action log for "morning-work" (Ctrl+1, 9:00 AM):                 │
  │    [1] opened Safari (was: not running)                            │
  │    [2] navigated to developer.apple.com (was: no tabs)             │
  │    [3] moved Safari to display 1 (was: not on screen)              │
  │    [4] opened Xcode (was: not running)                             │
  │    [5] moved Xcode to display 2 (was: not on screen)               │
  │    [6] opened Terminal (was: not running)                           │
  │                                                                     │
  │  User: Ctrl+Z → "undo last potion"                                │
  │       │                                                            │
  │       ▼                                                            │
  │  Daemon reverses the log:                                          │
  │    [6] close Terminal                                               │
  │    [5] (Xcode was not on screen — hide)                            │
  │    [4] close Xcode                                                 │
  │    [3] (Safari was not on screen — hide)                           │
  │    [2] (no previous tabs — close tabs)                             │
  │    [1] close Safari                                                │
  │       │                                                            │
  │       ▼                                                            │
  │  Desktop is back to pre-potion state.                              │
  │  Cross-app undo. Doesn't exist anywhere else.                     │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘


╔══════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║   APPLICATION 20: EMAIL TRIAGE                                          ║
║   One keypress → 40 unread emails → 5-line prioritized summary         ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝

  WITHOUT potion:
    Open Mail. Scroll through 40 unread emails. Read each subject.
    Try to assess priority. Miss the urgent one buried at #23.
    Spend 20 minutes just figuring out what needs attention.

  WITH potion:
    Ctrl+Z → "triage email" → prioritized summary in 10 seconds.

  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  User presses Ctrl+Z. Types "triage email."                        │
  │       │                                                            │
  │       ▼                                                            │
  │  Potion runs:                                                      │
  │    1. ctx.cu.executePlan:                                          │
  │       → open Mail → AX: read all unread message subjects + senders│
  │       → read first 2 lines of each via AX (no clicking needed)    │
  │       → 40 unread emails captured                                  │
  │                                                                     │
  │    2. ctx.ai.ask("Categorize and prioritize these emails:\n" +     │
  │       email_subjects_and_previews)                                 │
  │       │                                                            │
  │       │  🔴 URGENT (2):                                            │
  │       │    - Deploy approval needed (from: CTO, 8:02 AM)          │
  │       │    - Client escalation: API 500s (from: support, 7:45 AM) │
  │       │                                                            │
  │       │  📋 ACTION NEEDED (3):                                     │
  │       │    - PR review: auth-refactor (from: Alice)                │
  │       │    - Invoice approval Q2 (from: finance)                   │
  │       │    - Team offsite RSVP by Friday (from: HR)                │
  │       │                                                            │
  │       │  📨 FYI (8):                                               │
  │       │    - Sprint retrospective notes, CI pipeline updates, ...  │
  │       │                                                            │
  │       │  🗑 SKIP (27):                                              │
  │       │    - Newsletters, marketing, automated alerts              │
  │       │                                                            │
  │       ▼                                                            │
  │  User reads 10 lines. Knows exactly which 2 emails to open first. │
  │  The other 38 can wait. 10 seconds instead of 20 minutes.         │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```


## The Complete Stack

Everything in this document is built from the same small set of primitives:

```text
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│  PRIMITIVES (what exists or is planned):                             │
│                                                                      │
│    ctx.cu.executePlan()  — batch native desktop actions              │
│    ctx.cu.observe()      — read desktop state via AX                 │
│    ctx.cu.pressKeys()    — keyboard input to any app                 │
│    ctx.clipboard         — read/write system clipboard               │
│    ctx.shell()           — run any command                           │
│    ctx.ai.ask()          — call AI (local or cloud)                  │
│    ctx.eval()            — evaluate HQL/JS in daemon REPL            │
│    ctx.notify()          — show notification                         │
│    ctx.memory            — read/write daemon persistent memory       │
│                                                                      │
│  INFRASTRUCTURE:                                                     │
│                                                                      │
│    Daemon (hlvm serve)   — always alive, holds state                 │
│    Hotbar (Ctrl+1..0)    — 10 instant-fire slots                     │
│    Spotlight (Ctrl+Z)    — inline eval + search                      │
│    Launchpad             — browse/install/share modules              │
│    ESM format            — standard JS modules, npm-publishable      │
│                                                                      │
│  20 APPLICATIONS from 9 primitives + 5 infrastructure pieces.        │
│  No new primitives needed per application.                           │
│  The system is the killer feature. Applications are just code.       │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

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
6. **Clipboard privacy** — smart clipboard history must handle credentials,
   passwords, and sensitive data; opt-in only, with content classification
   that never stores items tagged as sensitive
7. **Cross-app undo reliability** — reversing desktop actions is best-effort;
   some actions (sent messages, submitted forms) are irreversible by nature;
   undo log must clearly mark which steps can be reversed
8. **Form auto-fill security** — storing personal data in daemon memory
   requires encryption at rest and clear user consent; must never auto-fill
   password fields
