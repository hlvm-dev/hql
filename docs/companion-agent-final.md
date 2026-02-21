# HLVM Companion Agent — Final Specification

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## BEFORE vs AFTER

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### BEFORE: Passive Chatbot

```
 9:00  User opens HLVM
 9:01  User types: "explain auth.ts"
 9:02  Agent responds with explanation
 9:02  Agent goes to sleep
       ...
       (silence for 2 hours)
       ...
11:00  User types: "fix the bug in auth.ts"
11:01  Agent responds
11:01  Agent goes to sleep

The agent is a vending machine.
Put coin in → get snack out → machine does nothing.
```

### AFTER: Active Personal AI

```
 9:00  User opens laptop. HLVM is running in menu bar.
       Companion: "Morning. You left off in auth.ts yesterday —
                   the refresh token logic was half done."

 9:15  User is coding auth.ts. Saves 3 times in a row.
       Companion: (silence. user is in flow. don't interrupt.)

 9:22  User saves. Something breaks — test file was importing
       a function user just renamed.
       Companion: "That rename broke auth.test.ts line 47 —
                   still importing the old name. Fix it?"
       User: "yeah"
       Companion: [fixes it]
       Companion: "Done. Tests pass."

 9:45  User switches to Chrome. Reading JWT refresh token docs.
       Companion: (silence. user is learning. let them read.)

 9:52  User comes back to VSCode.
       Companion: "The docs recommend rotating refresh tokens
                   on each use. Your impl reuses them — want me
                   to update it?"
       User: "not now, later"
       Companion: "Got it."

10:30  User hasn't typed anything for 5 minutes.
       Companion: "Stuck? I can see you're in the middleware
                   chain — want me to trace the request flow?"
       User: "actually yeah, how does the request get to auth?"
       Companion: [explains the full flow from router → middleware → auth]

11:00  User switches to Figma. Looking at dashboard design.
       Companion: "Nice design. Ready to scaffold it when you are."

11:20  User comes back to code.
       Companion: (silence. user knows the offer stands.)

12:00  User hasn't saved anything in 30 minutes. Lunch break.
       Companion: (silence. user is away. respect that.)

13:15  User comes back. Starts coding again.
       Companion: "Welcome back. You have 3 uncommitted files
                   from this morning. Want me to commit them?"
       User: "yes"
       Companion: [creates commit with good message]

15:00  User is writing a long function. Pastes code from somewhere.
       Companion: "That snippet has a potential null reference
                   on line 12. Also, you already have a similar
                   util in src/utils/parse.ts — want to use that
                   instead?"

17:00  End of day.
       Companion: "Good day. You shipped the auth refresh logic
                   and started the dashboard. 4 commits, 12 files
                   changed. See you tomorrow."

The agent is a friend who sits beside you.
Watches. Helps when useful. Shuts up when not.
Has your back.
```


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## THE COMPLETE SYSTEM

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


```
┌─ USER'S COMPUTER ────────────────────────────────────────────────────┐
│                                                                      │
│  User doing anything:                                                │
│  coding, browsing, designing, writing, whatever                      │
│                                                                      │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐            │
│  │ VSCode │ │ Chrome │ │ Figma  │ │Terminal│ │  Mail  │  ...        │
│  └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘            │
│      │          │          │          │          │                   │
│      ▼          ▼          ▼          ▼          ▼                   │
│  ════════════════════════════════════════════════════════════════    │
│   LAYER 1: OBSERVATION SOURCES                                      │
│   "The Eyes"                                                        │
│   Each source is event-driven. Fires only when something happens.   │
│  ════════════════════════════════════════════════════════════════    │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                                                              │   │
│  │  SOURCE A: File System                                       │   │
│  │  ══════════════════                                          │   │
│  │  How:   Platform.watch(workspaceDir)                         │   │
│  │         wraps Deno.watchFs() with dedup + ignore patterns    │   │
│  │  When:  file created, modified, or deleted                   │   │
│  │  What:  { type: "fs", action, path, timestamp }             │   │
│  │  Scope: active workspace directory only                      │   │
│  │  Ignores: .git/, node_modules/, dist/, build/               │   │
│  │  Cross-platform:                                             │   │
│  │    macOS  → FSEvents  (kernel, zero CPU)                     │   │
│  │    Linux  → inotify   (kernel, zero CPU)                     │   │
│  │    Windows→ ReadDirectoryChangesW (kernel, zero CPU)         │   │
│  │  Note: macOS FSEvents emits duplicates → Platform.watch()    │   │
│  │        deduplicates internally                               │   │
│  │                                                              │   │
│  │  SOURCE B: GUI Context Push                                  │   │
│  │  ══════════════════════════                                  │   │
│  │  How:   GUI calls POST /api/companion/observe                │   │
│  │  When:  active app changes, window title changes,            │   │
│  │         user triggers screenshot hotkey                      │   │
│  │  What:  { type: "app", name, title, timestamp }             │   │
│  │         { type: "screenshot", image, timestamp }             │   │
│  │  Cross-platform (GUI side, thin):                            │   │
│  │    macOS  → NSWorkspace.didActivateApplicationNotification   │   │
│  │    Linux  → D-Bus / xdotool active window event             │   │
│  │    Windows→ SetWinEventHook EVENT_SYSTEM_FOREGROUND          │   │
│  │  Note: GUI pushes TO hlvm. hlvm never polls.                 │   │
│  │  Note: Only the app name + title. Not content. Not URLs.     │   │
│  │        Unless user explicitly consented to more.             │   │
│  │                                                              │   │
│  │  SOURCE C: Git State                                         │   │
│  │  ═══════════════════                                         │   │
│  │  How:   Platform.watch() on .git/HEAD and .git/refs/        │   │
│  │  When:  branch switch, new commit, merge                    │   │
│  │  What:  { type: "git", action, branch, timestamp }          │   │
│  │  Note:  Piggybacks on file watcher. No separate mechanism.  │   │
│  │                                                              │   │
│  │  SOURCE D: User Messages                                    │   │
│  │  ══════════════════════                                      │   │
│  │  How:   existing POST /api/companion/respond                 │   │
│  │  When:  user types in companion chat, taps action button     │   │
│  │  What:  { type: "user", message, timestamp }                │   │
│  │         { type: "user_action", action: "Yes", timestamp }   │   │
│  │  Note:  Same as today's chat, just flows into companion.    │   │
│  │                                                              │   │
│  │  SOURCE E: Idle Transition                                   │   │
│  │  ═════════════════════════                                   │   │
│  │  How:   internal — monitors gap between events              │   │
│  │  When:  no events from ANY source for N seconds (→ idle)    │   │
│  │         first event after idle period (→ active)            │   │
│  │  What:  { type: "idle",   since: timestamp }                │   │
│  │         { type: "active", after: duration }                 │   │
│  │  Note:  Only fires on TRANSITION. Not periodic.             │   │
│  │         "User went idle" and "user came back" — two events. │   │
│  │                                                              │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│      All sources emit into ──▶                                       │
│                                                                      │
│  ════════════════════════════════════════════════════════════════    │
│   LAYER 2: OBSERVATION STREAM                                       │
│   "The Nerve"                                                       │
│  ════════════════════════════════════════════════════════════════    │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                                                              │   │
│  │  ObservationStream: AsyncIterable<Observation[]>             │   │
│  │                                                              │   │
│  │  Implementation:                                             │   │
│  │  ┌────────────┐                                              │   │
│  │  │ Source A ───┤                                             │   │
│  │  │ Source B ───┼──▶ merge() ──▶ debounce(3s) ──▶ yield []  │   │
│  │  │ Source C ───┤                                             │   │
│  │  │ Source D ───┤    merges all     batches rapid   yields    │   │
│  │  │ Source E ───┘    into one       events into     one batch │   │
│  │  └────────────┘     stream         one array       per quiet │   │
│  │                                                    period    │   │
│  │  Behavior:                                                   │   │
│  │                                                              │   │
│  │   Events:  ──A──A──A──────────B────C──C──────────────────── │   │
│  │   Time:    0  1  2  3  4  5  6  7  8  9 10 11 12  ...      │   │
│  │                     ▲              ▲        ▲               │   │
│  │                     │              │        │               │   │
│  │   Yields:     [A,A,A]         [B]      [C,C]               │   │
│  │               batch 1        batch 2   batch 3              │   │
│  │                                                              │   │
│  │  If no events arrive → stream yields nothing → no LLM call  │   │
│  │  Zero CPU. Zero cost. Zero waste.                            │   │
│  │                                                              │   │
│  │  Technical: uses Deno's async generator pattern              │   │
│  │  async function* debounce<T>(ms, source) { ... }            │   │
│  │                                                              │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│      Batched observations flow into ──▶                              │
│                                                                      │
│  ════════════════════════════════════════════════════════════════    │
│   LAYER 3: CONSENT GATE                                             │
│   "The Boundary"                                                    │
│  ════════════════════════════════════════════════════════════════    │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                                                              │   │
│  │  Before ANY observation reaches the LLM, it passes through  │   │
│  │  the consent gate.                                           │   │
│  │                                                              │   │
│  │  User's settings (persisted in ~/.hlvm/companion.json):      │   │
│  │  {                                                           │   │
│  │    "awareness": {                                            │   │
│  │      "fileSystem": true,      // file saves, creates        │   │
│  │      "gitState": true,        // commits, branches          │   │
│  │      "activeApp": true,       // which app is focused       │   │
│  │      "windowTitle": false,    // title bar content          │   │
│  │      "screenshot": false,     // screen capture             │   │
│  │      "calendar": false        // schedule access            │   │
│  │    },                                                        │   │
│  │    "processing": "local",     // "local" | "cloud"          │   │
│  │    "enabled": true,           // master on/off              │   │
│  │    "debounceMs": 3000,        // debounce window            │   │
│  │    "companionModel": "llama3.1:8b"  // which model          │   │
│  │  }                                                           │   │
│  │                                                              │   │
│  │  Gate logic:                                                 │   │
│  │    enabled === false?           → drop ALL events            │   │
│  │    event.type === "fs"          → check fileSystem setting   │   │
│  │    event.type === "app"         → check activeApp setting    │   │
│  │    event.app in BLOCKED_APPS?   → drop ALWAYS                │   │
│  │                                                              │   │
│  │  BLOCKED_APPS (hardcoded, user cannot override):             │   │
│  │    1Password, LastPass, Bitwarden, KeePass (password mgrs)  │   │
│  │    Banking apps (detected by known bundle IDs)              │   │
│  │    Private/Incognito browser windows                        │   │
│  │                                                              │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│      Consented observations flow into ──▶                            │
│                                                                      │
│  ════════════════════════════════════════════════════════════════    │
│   LAYER 4: COMPANION CONTEXT                                        │
│   "The Memory"                                                      │
│  ════════════════════════════════════════════════════════════════    │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                                                              │   │
│  │  CompanionContext                                            │   │
│  │  Unified memory for both companion AND interactive agent.    │   │
│  │                                                              │   │
│  │  ┌────────────────────────────────────────────────────┐     │   │
│  │  │ System Prompt                                      │     │   │
│  │  │ (personality, capabilities, guidelines — see §6)   │     │   │
│  │  ├────────────────────────────────────────────────────┤     │   │
│  │  │ Compacted History (older)                          │     │   │
│  │  │ "9:00-10:00: user worked on auth module,           │     │   │
│  │  │  saved 12 times, read JWT docs, fixed 1 bug"       │     │   │
│  │  ├────────────────────────────────────────────────────┤     │   │
│  │  │ Recent Observations (raw, last ~30)                │     │   │
│  │  │ [10:51] fs: modify auth.ts                         │     │   │
│  │  │ [10:52] fs: modify auth.test.ts                    │     │   │
│  │  │ [10:55] app: Chrome — "JWT refresh token"          │     │   │
│  │  │ [10:58] idle: 180s                                 │     │   │
│  │  ├────────────────────────────────────────────────────┤     │   │
│  │  │ Conversation (both companion + user + interactive) │     │   │
│  │  │ companion: "that rename broke auth.test.ts"        │     │   │
│  │  │ user: "yeah fix it"                                │     │   │
│  │  │ companion: [edit_file auth.test.ts] "Done."        │     │   │
│  │  │ user: "explain the auth flow"  (interactive chat)  │     │   │
│  │  │ agent: "the request flows through..."              │     │   │
│  │  ├────────────────────────────────────────────────────┤     │   │
│  │  │ Tools (full registry)                              │     │   │
│  │  │ read_file, write_file, edit_file, search_code,     │     │   │
│  │  │ shell_exec, web_fetch, git_*, ...                  │     │   │
│  │  └────────────────────────────────────────────────────┘     │   │
│  │                                                              │   │
│  │  Compaction strategy:                                        │   │
│  │  - Recent observations: keep raw (last ~30 events)          │   │
│  │  - Older observations: LLM-summarized into 1-2 sentences    │   │
│  │  - Conversation: standard context window management          │   │
│  │  - Persisted: ~/.hlvm/companion-memory/<workspace>.jsonl    │   │
│  │                                                              │   │
│  │  WHY UNIFIED (not split brain):                              │   │
│  │  If companion fixes a bug, and user later asks "what         │   │
│  │  changed in auth.ts?" — the interactive agent KNOWS.         │   │
│  │  One context. Two input channels. No confusion.              │   │
│  │                                                              │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│      Context assembled ──▶                                           │
│                                                                      │
│  ════════════════════════════════════════════════════════════════    │
│   LAYER 5: LLM CALL                                                 │
│   "The Brain"                                                       │
│  ════════════════════════════════════════════════════════════════    │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                                                              │   │
│  │  The LLM receives the full context and decides EVERYTHING.   │   │
│  │  We impose ZERO logic on what it should do.                  │   │
│  │                                                              │   │
│  │  Input:                                                      │   │
│  │    system:   COMPANION_SYSTEM_PROMPT                         │   │
│  │    messages: [compacted history + recent obs + conversation] │   │
│  │    tools:    [full tool registry]                            │   │
│  │                                                              │   │
│  │  The LLM can return:                                         │   │
│  │                                                              │   │
│  │    ┌─────────────────────────────────────────────────┐      │   │
│  │    │  SILENCE         "I have nothing useful to say"  │      │   │
│  │    │                  → empty response or "[silent]"  │      │   │
│  │    │                  → loop continues, no GUI push   │      │   │
│  │    │                  → THIS IS THE MOST COMMON       │      │   │
│  │    ├─────────────────────────────────────────────────┤      │   │
│  │    │  TEXT             "Nice refactor!"               │      │   │
│  │    │                  "Stuck? Want help?"             │      │   │
│  │    │                  "Morning! You left off in..."   │      │   │
│  │    │                  → push to GUI via SSE           │      │   │
│  │    ├─────────────────────────────────────────────────┤      │   │
│  │    │  TEXT + ACTIONS   "That broke a test. Fix it?"   │      │   │
│  │    │                  → push to GUI with buttons      │      │   │
│  │    │                  → wait for user response        │      │   │
│  │    ├─────────────────────────────────────────────────┤      │   │
│  │    │  TOOL CALLS       read_file("auth.ts")          │      │   │
│  │    │                  search_code("refresh token")   │      │   │
│  │    │                  edit_file("auth.ts", ...)      │      │   │
│  │    │                  shell_exec("deno test")        │      │   │
│  │    │                  → permission check (see §7)    │      │   │
│  │    │                  → execute → result to context  │      │   │
│  │    └─────────────────────────────────────────────────┘      │   │
│  │                                                              │   │
│  │  TWO-MODEL STRATEGY:                                         │   │
│  │                                                              │   │
│  │  ┌────────────────────┐    ┌────────────────────┐           │   │
│  │  │  Companion Model   │    │  Action Model      │           │   │
│  │  │                    │    │                     │           │   │
│  │  │  Always running.   │    │  On-demand only.    │           │   │
│  │  │  Processes obs.    │    │  Complex actions.   │           │   │
│  │  │  Decides to speak. │    │  Multi-file edits.  │           │   │
│  │  │  Light tool calls. │    │  Bug diagnosis.     │           │   │
│  │  │                    │    │                     │           │   │
│  │  │  Local Ollama      │    │  Sonnet / Opus /    │           │   │
│  │  │  or Haiku-class    │    │  GPT-4             │           │   │
│  │  │                    │    │                     │           │   │
│  │  │  Cost: ~$0/hr      │    │  Cost: per-task     │           │   │
│  │  │  Latency: <2s      │    │  Latency: 5-30s     │           │   │
│  │  └────────┬───────────┘    └────────▲───────────┘           │   │
│  │           │                         │                        │   │
│  │           │  "user wants auth fix"  │                        │   │
│  │           └─────────────────────────┘                        │   │
│  │              escalation: companion summarizes task,           │   │
│  │              action model receives task description +         │   │
│  │              runs full ReAct loop (existing orchestrator)     │   │
│  │                                                              │   │
│  │  CONCURRENT ACCESS — COMPANION YIELDS:                       │   │
│  │                                                              │   │
│  │  User sends interactive message?                             │   │
│  │    → companion pauses LLM calls                              │   │
│  │    → observations still collected in buffer                  │   │
│  │    → interactive agent takes priority on LLM                 │   │
│  │    → when interactive done, companion resumes                │   │
│  │                                                              │   │
│  │  This prevents:                                              │   │
│  │    - Ollama request queue contention                         │   │
│  │    - Companion interrupting active conversation              │   │
│  │    - Conflicting file edits                                  │   │
│  │                                                              │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│      LLM output flows into ──▶                                       │
│                                                                      │
│  ════════════════════════════════════════════════════════════════    │
│   LAYER 6: PERMISSION                                               │
│   "The Leash"                                                       │
│  ════════════════════════════════════════════════════════════════    │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                                                              │   │
│  │  Companion-initiated actions have STRICTER permissions       │   │
│  │  than user-initiated actions. Because the user didn't ask.   │   │
│  │                                                              │   │
│  │  ┌────────────┬──────────────────┬────────────────────┐     │   │
│  │  │ Tool Level │ Interactive Agent│ Companion Agent    │     │   │
│  │  ├────────────┼──────────────────┼────────────────────┤     │   │
│  │  │ L0 (read)  │ auto             │ auto               │     │   │
│  │  │ read_file  │                  │ (can read freely)  │     │   │
│  │  │ search     │                  │                    │     │   │
│  │  │ list_files │                  │                    │     │   │
│  │  ├────────────┼──────────────────┼────────────────────┤     │   │
│  │  │ L1 (write) │ ask once → auto  │ ALWAYS ASK         │     │   │
│  │  │ edit_file  │                  │ every single time  │     │   │
│  │  │ write_file │                  │ no auto-approve    │     │   │
│  │  ├────────────┼──────────────────┼────────────────────┤     │   │
│  │  │ L2 (shell) │ always ask       │ ALWAYS ASK         │     │   │
│  │  │ shell_exec │                  │                    │     │   │
│  │  │ git ops    │                  │                    │     │   │
│  │  └────────────┴──────────────────┴────────────────────┘     │   │
│  │                                                              │   │
│  │  WHY STRICTER:                                               │   │
│  │  User told the interactive agent "fix auth.ts" — implicit   │   │
│  │  consent to write. Companion decided on its own to fix      │   │
│  │  auth.ts — no consent. Must ask.                            │   │
│  │                                                              │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│      Output flows into ──▶                                           │
│                                                                      │
│  ════════════════════════════════════════════════════════════════    │
│   LAYER 7: TRANSPORT                                                │
│   "The Voice"                                                       │
│  ════════════════════════════════════════════════════════════════    │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                                                              │   │
│  │  SSE: GET /api/companion/stream                              │   │
│  │                                                              │   │
│  │  Event types:                                                │   │
│  │                                                              │   │
│  │  event: message                                              │   │
│  │  data: {                                                     │   │
│  │    "type": "message",                                        │   │
│  │    "text": "Nice refactor!"                                  │   │
│  │  }                                                           │   │
│  │                                                              │   │
│  │  event: suggestion                                           │   │
│  │  data: {                                                     │   │
│  │    "type": "suggestion",                                     │   │
│  │    "text": "That broke a test. Fix it?",                     │   │
│  │    "actions": ["Yes", "Not now"]                             │   │
│  │  }                                                           │   │
│  │                                                              │   │
│  │  event: permission                                           │   │
│  │  data: {                                                     │   │
│  │    "type": "permission",                                     │   │
│  │    "text": "I'd like to edit auth.ts to fix the import",    │   │
│  │    "tool": "edit_file",                                      │   │
│  │    "args": { "path": "auth.ts", ... },                      │   │
│  │    "actions": ["Allow", "Deny"]                              │   │
│  │  }                                                           │   │
│  │                                                              │   │
│  │  event: action_result                                        │   │
│  │  data: {                                                     │   │
│  │    "type": "action_result",                                  │   │
│  │    "text": "Done. Fixed import in auth.test.ts. Tests pass." │   │
│  │  }                                                           │   │
│  │                                                              │   │
│  │  event: status                                               │   │
│  │  data: {                                                     │   │
│  │    "type": "status",                                         │   │
│  │    "observing": true,                                        │   │
│  │    "workspace": "~/dev/appA",                                │   │
│  │    "model": "llama3.1:8b"                                    │   │
│  │  }                                                           │   │
│  │                                                              │   │
│  │  User responses come back via:                               │   │
│  │  POST /api/companion/respond                                 │   │
│  │  { "action": "Yes" }                                         │   │
│  │  { "message": "actually, use a different approach" }         │   │
│  │                                                              │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                            │
                            │ SSE
                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│  GUI  (~/dev/HLVM — SwiftUI on macOS, thin on any platform)         │
│  "The Face"                                                          │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │                                                            │     │
│  │  RESPONSIBILITIES (and NOTHING more):                      │     │
│  │                                                            │     │
│  │  1. PUSH observations TO hlvm serve                        │     │
│  │     NSWorkspace.didActivateApplicationNotification          │     │
│  │       → POST /api/companion/observe { app, title }         │     │
│  │     This is DATA FORWARDING, not logic.                    │     │
│  │                                                            │     │
│  │  2. SUBSCRIBE to SSE FROM hlvm serve                       │     │
│  │     GET /api/companion/stream                              │     │
│  │       → render bubbles, buttons, results                   │     │
│  │                                                            │     │
│  │  3. FORWARD user responses back                            │     │
│  │     User taps button or types reply                        │     │
│  │       → POST /api/companion/respond { action | message }   │     │
│  │                                                            │     │
│  │  4. SHOW awareness indicator                               │     │
│  │     Menu bar: 👁 when observing, nothing when paused       │     │
│  │                                                            │     │
│  │  5. SETTINGS UI                                            │     │
│  │     Toggle awareness categories, model, processing mode    │     │
│  │     Reads/writes via GET/PATCH /api/companion/settings     │     │
│  │                                                            │     │
│  │  NO decision logic. NO AI. NO observation processing.      │     │
│  │  Replace with Tauri/Electron/terminal and nothing breaks.  │     │
│  │                                                            │     │
│  └────────────────────────────────────────────────────────────┘     │
│                                                                      │
│  What user sees:                                                     │
│                                                                      │
│  ┌─────────────────────────────────────────┐                        │
│  │ 🤖 Companion                            │                        │
│  │                                         │                        │
│  │ That rename broke auth.test.ts line 47  │                        │
│  │ — still importing the old name.         │                        │
│  │ Fix it?                                 │                        │
│  │                                         │                        │
│  │  [ Yes ]  [ Not now ]                   │                        │
│  └─────────────────────────────────────────┘                        │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 6. SYSTEM PROMPT

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This is the most important part. It defines who the companion IS.

```
You are the user's personal AI companion. You live on their computer.
You can see what they're doing through observation events that arrive
in the conversation.

You have tools. You can read files, write files, search code, run
commands, browse the web, and more.

YOU DECIDE what to do. No one tells you when to speak or what to say.
Based on what you observe, you can:
  - Stay silent (this is fine and often the best choice)
  - Say something casual ("nice refactor!", "morning!")
  - Offer help ("that might break X — want me to check?")
  - Ask a question ("what are you building?")
  - Take action with tools (after getting permission for writes)
  - Anything else that feels natural

GUIDELINES:
  - Be a friend, not a tool. Not a servant. Not Clippy.
  - Read the room. If the user is in flow (rapid edits), stay quiet.
  - Quality over frequency. One good insight beats ten obvious ones.
  - Be concise. One sentence is usually enough.
  - When you help, be competent. Use your tools properly.
  - Remember context across the session. Don't repeat yourself.
  - Respect "not now" — if user declines, back off on that topic.
  - You have personality. Be warm, encouraging, occasionally witty.
  - You are not limited to coding. Help with anything.
```


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 7. COMPANION LOOP — EXACT IMPLEMENTATION

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

```typescript
// src/hlvm/companion/loop.ts

import { CompanionContext } from "./context.ts";
import { debounce, merge } from "./observe.ts";
import { COMPANION_SYSTEM_PROMPT } from "./prompt.ts";

interface CompanionConfig {
  llm: LLMFunction;                    // companion model (cheap/fast)
  actionLLM: LLMFunction;             // action model (powerful)
  tools: Tool[];                       // full tool registry
  sse: SSEChannel;                     // push to GUI
  settings: CompanionSettings;         // user's consent settings
  onInteractiveStart: () => void;      // signal: user started chatting
  onInteractiveEnd: () => void;        // signal: user stopped chatting
}

export async function startCompanionLoop(
  observationStream: AsyncIterable<Observation>,
  config: CompanionConfig,
): Promise<void> {
  const context = await CompanionContext.load(config.settings.workspace);
  let paused = false;

  // Companion yields when user is in interactive chat
  config.onInteractiveStart = () => { paused = true; };
  config.onInteractiveEnd = () => { paused = false; };

  for await (const batch of debounce(config.settings.debounceMs, observationStream)) {

    // Apply consent gate
    const allowed = batch.filter(e => isConsented(e, config.settings));
    if (allowed.length === 0) continue;

    // Add to context
    context.addObservations(allowed);
    context.compact();

    // Yield to interactive agent
    if (paused) continue;  // observations saved, LLM call skipped

    // Call companion LLM
    const response = await config.llm.chat({
      system: COMPANION_SYSTEM_PROMPT,
      messages: context.getMessages(),
      tools: config.tools,
    });

    // SILENCE — most common outcome
    if (!response || response.text?.includes("[silent]")) {
      continue;
    }

    // TEXT — push to GUI
    if (response.text && !response.toolCalls?.length) {
      config.sse.emit("companion", {
        type: "message",
        text: response.text,
      });
      context.addAssistantResponse(response);
    }

    // TOOL CALLS — execute with permission
    if (response.toolCalls?.length) {
      for (const call of response.toolCalls) {
        const tool = getTool(call.name);

        if (tool.safetyLevel === "L0") {
          // Read-only: just do it
          const result = await executeTool(call);
          context.addToolResult(call, result);
        } else {
          // Write/shell: ask user via GUI
          config.sse.emit("companion", {
            type: "permission",
            text: response.text,
            tool: call.name,
            args: call.args,
            actions: ["Allow", "Deny"],
          });
          // User response arrives via POST /api/companion/respond
          // which feeds back into the observation stream as a user event
          // Next iteration of this loop will see it
        }
      }
      context.addAssistantResponse(response);
    }

    // ESCALATION — complex task needs big model
    if (response.metadata?.escalate) {
      const taskDescription = response.metadata.escalate;
      // Hand off to existing ReAct loop with action model
      const result = await runAgentQuery({
        query: taskDescription,
        model: config.actionLLM,
        // ... existing agent-runner params
      });
      context.addActionResult(result);
      config.sse.emit("companion", {
        type: "action_result",
        text: result.text,
      });
    }

    await context.save();
  }
}
```


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 8. OBSERVATION STREAM — EXACT IMPLEMENTATION

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

```typescript
// src/hlvm/companion/observe.ts

// --- Observation type ---

interface Observation {
  type: "fs" | "app" | "git" | "user" | "idle" | "active" | "screenshot";
  timestamp: number;
  data: Record<string, unknown>;
}

// --- Individual sources ---

async function* watchFileSystem(dir: string): AsyncIterable<Observation> {
  const watcher = getPlatform().watch(dir, {
    recursive: true,
    ignore: [".git", "node_modules", "dist", ".DS_Store"],
  });
  const seen = new Map<string, number>();  // dedup FSEvents duplicates

  for await (const event of watcher) {
    const key = `${event.kind}:${event.paths[0]}`;
    const now = Date.now();
    if (seen.get(key) && now - seen.get(key)! < 100) continue;  // dedup
    seen.set(key, now);

    yield {
      type: "fs",
      timestamp: now,
      data: { action: event.kind, path: event.paths[0] },
    };
  }
}

async function* watchGit(dir: string): AsyncIterable<Observation> {
  const gitDir = `${dir}/.git`;
  const watcher = getPlatform().watch(gitDir, {
    recursive: false,
    include: ["HEAD", "refs"],
  });

  for await (const event of watcher) {
    yield {
      type: "git",
      timestamp: Date.now(),
      data: { action: event.kind, file: event.paths[0] },
    };
  }
}

function createGUIObservationChannel(): {
  push: (obs: Observation) => void;
  stream: AsyncIterable<Observation>;
} {
  // Backed by HTTP endpoint POST /api/companion/observe
  // GUI pushes here, stream yields
  const queue: Observation[] = [];
  let resolve: (() => void) | null = null;

  return {
    push(obs) {
      queue.push(obs);
      resolve?.();
    },
    stream: {
      async *[Symbol.asyncIterator]() {
        while (true) {
          if (queue.length > 0) {
            yield queue.shift()!;
          } else {
            await new Promise<void>(r => { resolve = r; });
          }
        }
      },
    },
  };
}

function* watchIdleTransitions(
  source: AsyncIterable<Observation>,
  thresholdMs: number = 300_000,  // 5 min
): AsyncIterable<Observation> {
  // Wraps another stream. Emits "idle" when no events for threshold.
  // Emits "active" when first event after idle.
  // Implementation: setTimeout reset on each event.
}

// --- Merge + Debounce ---

async function* merge<T>(
  ...sources: AsyncIterable<T>[]
): AsyncIterable<T> {
  // Merges multiple async iterables into one, yielding as they come.
  // Uses Promise.race on all sources' next() calls.
}

async function* debounce<T>(
  ms: number,
  source: AsyncIterable<T>,
): AsyncIterable<T[]> {
  // Collects events. When `ms` passes with no new event, yields batch.
  //
  // Event:  ──A──B──C──────────D──E──────────
  // Time:   0  1  2  3  4  5  6  7  8  9  10
  //                     ▲              ▲
  //               yield [A,B,C]   yield [D,E]
  //
  let batch: T[] = [];
  let timer: number | null = null;
  let resolveTimer: (() => void) | null = null;

  for await (const item of source) {
    batch.push(item);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => resolveTimer?.(), ms);
    // ... yield batch when timer fires
  }
}

// --- Factory ---

export function createObservationStream(
  workspaceDir: string,
  guiChannel: { stream: AsyncIterable<Observation> },
  settings: CompanionSettings,
): AsyncIterable<Observation[]> {
  const sources = [guiChannel.stream];

  if (settings.awareness.fileSystem) {
    sources.push(watchFileSystem(workspaceDir));
  }
  if (settings.awareness.gitState) {
    sources.push(watchGit(workspaceDir));
  }

  const merged = merge(...sources);
  const withIdle = watchIdleTransitions(merged);
  return debounce(settings.debounceMs, withIdle);
}
```


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 9. FILE STRUCTURE

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

```
src/hlvm/
├── companion/                    ← NEW MODULE
│   ├── mod.ts                    ← exports startCompanion(), stopCompanion()
│   ├── loop.ts                   ← the for-await companion loop
│   ├── observe.ts                ← ObservationStream, merge, debounce, sources
│   ├── context.ts                ← CompanionContext: memory, history, compaction
│   ├── prompt.ts                 ← COMPANION_SYSTEM_PROMPT
│   └── types.ts                  ← Observation, CompanionSettings, SSE event types
│
├── agent/                        ← EXISTING, minimal changes
│   ├── orchestrator.ts           ← reused for action escalation
│   ├── registry.ts               ← shared tool registry (no changes)
│   ├── session.ts                ← add companion yield signals
│   └── agent-runner.ts           ← add companion integration
│
├── cli/
│   └── repl/
│       └── http-server.ts        ← add companion endpoints (6 routes)
│
└── common/
    └── platform.ts               ← add Platform.watch() abstraction


~/.hlvm/
├── companion.json                ← awareness settings (consent)
└── companion-memory/
    └── <workspace-hash>.jsonl    ← persisted context per workspace


HTTP ENDPOINTS (new):
  POST  /api/companion/observe     ← GUI pushes events
  GET   /api/companion/stream      ← SSE to GUI
  POST  /api/companion/respond     ← user replies
  GET   /api/companion/settings    ← read settings
  PATCH /api/companion/settings    ← update settings
  POST  /api/companion/pause       ← pause observation
  POST  /api/companion/resume      ← resume observation
```


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 10. STARTUP FLOW

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

```
User opens HLVM GUI app (or runs `hlvm serve`)
       │
       ▼
┌─────────────────────────────────────────────────┐
│  hlvm serve starts                              │
│                                                  │
│  1. Start HTTP server on :11435   (existing)    │
│  2. Initialize runtime            (existing)    │
│  3. Load companion settings from                │
│     ~/.hlvm/companion.json                      │
│  4. If companion enabled:                       │
│     a. Create GUI observation channel           │
│     b. Detect active workspace (from GUI push   │
│        or last known)                           │
│     c. Create observation stream                │
│        (file watcher + GUI channel + git)       │
│     d. Start companion loop (async, background) │
│  5. Ready.                                      │
└─────────────────────────────────────────────────┘
       │
       │  First time ever?
       ▼
┌─────────────────────────────────────────────────┐
│  FIRST-RUN CONSENT FLOW                         │
│                                                  │
│  GUI shows:                                     │
│  ┌────────────────────────────────────────────┐ │
│  │                                            │ │
│  │  HLVM Companion                            │ │
│  │                                            │ │
│  │  I can watch what you're doing and help    │ │
│  │  proactively. You control what I can see.  │ │
│  │                                            │ │
│  │  ☑ File changes in your projects           │ │
│  │  ☑ Which app you're using                  │ │
│  ☐ Window titles                              │ │
│  │  ☐ Screen content                          │ │
│  │                                            │ │
│  │  Processing: ◉ On my device only           │ │
│  │                                            │ │
│  │  [ Enable Companion ]  [ Not Now ]         │ │
│  │                                            │ │
│  └────────────────────────────────────────────┘ │
│                                                  │
│  Nothing is observed until user explicitly       │
│  enables it. Opt-in only. Never default-on.      │
└─────────────────────────────────────────────────┘
```


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 11. REMAINING AMBIGUITIES — HONEST LIST

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Things I know HOW to solve but haven't nailed exact approach:

```
1. DEBOUNCE TIMING
   3 seconds — is this right?
   Too short → too many LLM calls
   Too long → companion feels sluggish
   PLAN: start at 3s, make configurable, tune from experience

2. WORKSPACE DETECTION
   How exactly to detect which project directory from window title?
   VSCode: "filename — project — VSCode" (parseable)
   IntelliJ: varies by version
   Terminal: CWD detection varies by OS
   PLAN: start with explicit project registration in settings,
         add auto-detection incrementally

3. CONTEXT COMPACTION THRESHOLD
   When to summarize old observations?
   How many raw observations to keep?
   PLAN: reuse existing context compaction from orchestrator.ts,
         keep last ~30 raw, summarize in batches of 50

4. ESCALATION PROTOCOL
   Exact mechanism for companion → action model handoff.
   How much context transfers? Full history or summary?
   PLAN: companion generates a task description string,
         action model gets that + can use tools to read files itself

5. COMPANION MODEL REQUIREMENTS
   What minimum model capability is needed?
   Does it need tool calling support?
   What if user only has a weak local model?
   PLAN: require tool calling support (most Ollama models have it),
         fall back to text-based responses if model can't call tools

6. ERROR RECOVERY
   Ollama down? LLM timeout? Watcher error?
   PLAN: companion loop catches all errors, logs them,
         continues on next event. Never crashes hlvm serve.
         Exponential backoff on repeated LLM failures.
```

Things that are INTENTIONALLY deferred (not ambiguous, just later):

```
- Screenshots / visual inference         → Phase 4
- Calendar integration                   → Phase 4
- Multi-channel (Slack/Discord/etc.)     → Phase 5
- Skill marketplace                      → Phase 5
- Cross-device sync                      → Phase 5
```


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 12. ONE-PAGE SUMMARY

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

```
WHAT:   Make HLVM an active personal AI agent.
WHY:    Passive chatbots are boring. A real AI companion is useful.
HOW:    Observe → Debounce → LLM decides everything.
WHERE:  New companion/ module inside hlvm, runs alongside hlvm serve.

EVENTS: File changes, app switches, git state, user messages, idle.
        All event-driven. Zero polling. FRP/AsyncIterable pattern.

BRAIN:  LLM decides 100% — speak, act, stay silent, whatever.
        No rule engines. No classifiers. No hardcoded behavior.

MODELS: Cheap local model for observation. Big model for actions.
        Companion yields when user is in active interactive chat.

PRIVACY: User-controlled consent gate. On-device default.
         Password/banking apps always blocked.
         Nothing observed until user explicitly enables.

GUI:    Thin renderer. Pushes observations in. Displays output.
        No logic. Swappable for any platform.

PERMISSIONS: Companion can read freely. Must ask for ALL writes.
             Stricter than interactive agent. User didn't ask.

FILES:  6 new files in src/hlvm/companion/
        1 modified: http-server.ts (6 new endpoints)
        1 modified: platform.ts (add watch())

PHASES: 1. Foundation (stream + loop + SSE)
        2. Intelligence (prompt tuning + context + two-model)
        3. Awareness (window info + workspace detection)
        4. Visual (screenshots — future)
        5. Ecosystem (channels, skills — future)
```
