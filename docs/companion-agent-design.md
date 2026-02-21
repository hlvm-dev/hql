# HLVM Companion Agent — Design Document

## 1. Goal

HLVM is currently a **passive** AI system. The user sends a prompt, the agent
responds, and it goes back to sleep. This is the standard LLM chatbot model.

We want HLVM to be an **active personal AI agent**. Not a coding tool. Not a
chatbot. A companion that lives on your computer, sees what you're doing, and
participates — like a friend who happens to be brilliant.

```
BEFORE (passive):

  User ──prompt──▶ Agent ──response──▶ User
                   (sleeps)

AFTER (active):

  User is just living their life
       │
       ▼
  Agent is always aware ──▶ decides to talk, help, act, or stay quiet
```

The agent can do anything: help with code, suggest something, crack a joke,
remind you about a meeting, summarize what changed while you were away, or
simply stay silent. **The LLM decides 100%.** We don't pre-program what it
should or shouldn't do.


## 2. Inspiration: OpenClaw — and How We Differ

OpenClaw (200K+ GitHub stars) popularized the personal AI agent concept.
Its proactive mechanism is a **cron heartbeat every 30 minutes** that reads
a `HEARTBEAT.md` checklist file. Simple but crude — it's polling.

OpenClaw's real magic isn't the architecture. It's that it connects to
messaging channels people already use (WhatsApp, Telegram, Slack), so
the agent feels present in your life.

```
OpenClaw:
  Cron every 30 min ──▶ read HEARTBEAT.md ──▶ maybe act
  Message arrives    ──▶ process ──▶ respond

  Pros: simple, works
  Cons: 0-30 min latency, blind between heartbeats, polling

HLVM:
  OS event fires     ──▶ debounce ──▶ LLM decides

  Pros: instant, event-driven, zero waste when idle
  Cons: more engineering
```

We take the same core idea — an AI that acts on its own — but replace
the cron with **real OS-level event observation**. Deno gives us native
file system events (FSEvents on macOS, inotify on Linux). The GUI wrapper
gives us window/app awareness. No polling. No cron. Pure observer pattern.


## 3. Core Design Principle

```
Observe ──▶ Debounce ──▶ LLM decides everything
```

Three rules:

1. **The LLM decides 100%.** We don't build rule engines, classifiers, or
   engagement scoring. The LLM is the brain. It decides whether to speak,
   what to say, whether to act, or whether to stay silent.

2. **Event-driven, not polling.** Events fire only when something happens.
   Zero CPU when idle. Observer/FRP pattern, not cron or heartbeat.

3. **All logic in the binary.** The GUI is a thin renderer. All intelligence
   lives in `hlvm` (Deno/TypeScript), which is cross-platform for free.


## 4. Architecture Overview

```
══════════════════════════════════════════════════════════════════
                         FULL SYSTEM
══════════════════════════════════════════════════════════════════

┌───────────────────────────────────────────────────────────────┐
│                     USER'S COMPUTER                           │
│                                                               │
│   User doing things:                                          │
│   coding, browsing, designing, emailing, whatever             │
│                                                               │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐       │
│   │ Editor  │  │ Browser │  │ Figma   │  │Terminal │  ...   │
│   └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘       │
│        │            │            │             │              │
│        ▼            ▼            ▼             ▼              │
│   ┌───────────────────────────────────────────────────┐      │
│   │              OBSERVATION SOURCES                  │      │
│   │                                                    │      │
│   │  A. File System ── Deno.watchFs() via Platform    │      │
│   │     (fires on create/modify/delete in workspace)  │      │
│   │                                                    │      │
│   │  B. GUI Push ── POST /api/companion/observe       │      │
│   │     (active app name, window title, screenshot)   │      │
│   │     (GUI uses native OS APIs, pushes to hlvm)     │      │
│   │                                                    │      │
│   │  C. Git ── fs watch on .git/HEAD, .git/refs/      │      │
│   │     (commit, branch switch, merge)                │      │
│   │                                                    │      │
│   │  D. Terminal ── own PTY stdout                    │      │
│   │     (command output, errors)                      │      │
│   │                                                    │      │
│   │  E. User ── existing HTTP endpoints               │      │
│   │     (typed a message, tapped a button)            │      │
│   │                                                    │      │
│   │  F. Idle Transition ── internal timer             │      │
│   │     (only fires on state CHANGE: active→idle)     │      │
│   └───────────────────────┬───────────────────────────┘      │
│                           │                                   │
│                     all sources                               │
│                     merged into                               │
│                     one stream                                │
│                           │                                   │
│                           ▼                                   │
│   ┌───────────────────────────────────────────────────┐      │
│   │         ObservationStream                         │      │
│   │         AsyncIterable<Observation>                │      │
│   │                                                    │      │
│   │  FRP-style reactive stream.                       │      │
│   │  Yields ONLY when events arrive.                  │      │
│   │  Zero CPU when nothing happens.                   │      │
│   │  Not polling. Not cron. Pure observer.            │      │
│   └───────────────────────┬───────────────────────────┘      │
│                           │                                   │
│                           ▼                                   │
│   ┌───────────────────────────────────────────────────┐      │
│   │              DEBOUNCE (3 seconds)                 │      │
│   │                                                    │      │
│   │  Rapid events get bundled into one batch:         │      │
│   │                                                    │      │
│   │  10:00:01 file save  ─┐                           │      │
│   │  10:00:02 file save   ├─▶ ONE batch ─▶ ONE call  │      │
│   │  10:00:03 file save  ─┘                           │      │
│   │                                                    │      │
│   │  No events = no batch = no LLM call.              │      │
│   └───────────────────────┬───────────────────────────┘      │
│                           │                                   │
│                           ▼                                   │
│   ┌───────────────────────────────────────────────────┐      │
│   │              LLM CALL                             │      │
│   │                                                    │      │
│   │  System prompt:                                   │      │
│   │  "You are the user's personal AI companion.       │      │
│   │   You can see what they're doing through          │      │
│   │   observations. You have tools. Do whatever       │      │
│   │   feels right — talk, help, act, or stay quiet.   │      │
│   │   Be a friend, not a tool."                       │      │
│   │                                                    │      │
│   │  Messages:                                        │      │
│   │  [...memory, ...new_observations]                 │      │
│   │                                                    │      │
│   │  Tools:                                           │      │
│   │  [full tool registry — read, write, search,       │      │
│   │   shell, web, git, ...]                           │      │
│   │                                                    │      │
│   │  Model: cheap/fast for companion duties           │      │
│   │  (local Ollama or Haiku-class)                    │      │
│   │  Escalate to big model for complex actions.       │      │
│   │                                                    │      │
│   │  LLM decides 100%:                                │      │
│   │  - Stay silent (most common)                      │      │
│   │  - Say something ("nice refactor!")               │      │
│   │  - Suggest ("want me to write tests?")            │      │
│   │  - Act (call tools — with permission for writes)  │      │
│   │  - Ask ("what are you building?")                 │      │
│   │  - Anything else it thinks is appropriate         │      │
│   └──────────┬────────────────────────────────────────┘      │
│              │                                                │
│              ▼                                                │
│   ┌───────────────────────────────────────────────────┐      │
│   │           PERMISSION LAYER                        │      │
│   │                                                    │      │
│   │  L0 tools (read, search): auto-execute            │      │
│   │  L1+ tools (write, edit, shell, git):             │      │
│   │       ALWAYS ask user — companion never writes    │      │
│   │       without explicit "yes"                      │      │
│   │                                                    │      │
│   │  This is stricter than the interactive agent.     │      │
│   │  Proactive actions need a higher trust bar.       │      │
│   └──────────┬────────────────────────────────────────┘      │
│              │                                                │
│              ▼                                                │
│   ┌───────────────────────────────────────────────────┐      │
│   │        SSE: /api/companion/stream                 │      │
│   │                                                    │      │
│   │  Push LLM output to GUI in real time.             │      │
│   │  Text, suggestions, action results, permission    │      │
│   │  requests — all go through this one channel.      │      │
│   └───────────────────────┬───────────────────────────┘      │
│                           │                                   │
└───────────────────────────┼───────────────────────────────────┘
                            │
                            ▼
┌───────────────────────────────────────────────────────────────┐
│              GUI (~/dev/HLVM — SwiftUI)                       │
│              Thin renderer. No logic.                          │
│                                                               │
│  Responsibilities:                                            │
│  1. Push observations TO hlvm serve                           │
│     (active app, window title — via native OS APIs)           │
│  2. Subscribe to SSE FROM hlvm serve                          │
│     (render companion messages, suggestions, actions)         │
│  3. Forward user responses back                               │
│     (POST /api/companion/respond)                             │
│  4. Show awareness indicator (eye icon in menu bar)           │
│  5. Consent settings UI                                       │
│                                                               │
│  That's it. No decision logic. No AI. No processing.          │
│  Swappable for any platform's native UI.                      │
│                                                               │
│  ┌─────────────────────────────────────┐                     │
│  │  Companion                          │                     │
│  │                                     │                     │
│  │  Stuck? I see you were reading      │                     │
│  │  about JWT refresh tokens. Your     │                     │
│  │  auth.ts doesn't handle expiry.     │                     │
│  │  Want me to add that?               │                     │
│  │                                     │                     │
│  │  [Yes please]  [Not now]  [...]     │                     │
│  └─────────────────────────────────────┘                     │
└───────────────────────────────────────────────────────────────┘
```


## 5. The Companion Loop (Pseudocode)

This is the entire active agent mechanism. It runs alongside `hlvm serve`.

```typescript
async function companionLoop(
  observationStream: AsyncIterable<Observation>,
  llm: LLMFunction,
  tools: Tool[],
  sse: SSEChannel,
) {
  const context = new CompanionContext();  // persisted memory + history

  for await (const events of debounce(3000, observationStream)) {
    // events = batch of everything that happened in the last 3s

    context.addObservations(events);
    context.compact();  // summarize old observations, keep recent raw

    const response = await llm.chat({
      system: COMPANION_SYSTEM_PROMPT,
      messages: context.getMessages(),
      tools: tools,
    });

    // LLM returned nothing? It chose silence. Continue.
    if (!response) continue;

    // LLM wants to say something?
    if (response.text) {
      sse.emit("companion", { type: "message", text: response.text });
    }

    // LLM wants to use tools?
    if (response.toolCalls) {
      for (const call of response.toolCalls) {
        if (isSafe(call)) {
          // L0 read-only tools: just do it
          const result = await executeTool(call);
          context.addToolResult(result);
        } else {
          // L1+ write tools: ask user first via GUI
          sse.emit("companion", {
            type: "permission",
            text: response.text,
            tool: call,
            actions: ["Yes", "No"],
          });
          // wait for user response via POST /api/companion/respond
        }
      }
    }

    context.addAssistantResponse(response);
    await context.save();  // persist to disk
  }
}
```


## 6. Observation Stream (Detail)

The observation stream merges multiple event sources into a single
`AsyncIterable<Observation>`. Each source emits events only when something
happens. No source polls.

```
┌─────────────────────────────────────────────────────────┐
│                 ObservationStream                        │
│                 AsyncIterable<Observation>               │
│                                                          │
│  Source A: File System                                   │
│  ─────────────────                                       │
│  Implementation: Deno.watchFs() via Platform.watch()     │
│  Events:                                                 │
│    { type: "fs", action: "modify", path: "src/auth.ts" } │
│    { type: "fs", action: "create", path: "src/new.ts" }  │
│    { type: "fs", action: "delete", path: "src/old.ts" }  │
│  Notes:                                                  │
│    - Watches active workspace directory only              │
│    - Ignores: .git/, node_modules/, build artifacts       │
│    - Deduplicates (macOS FSEvents emits duplicates)       │
│    - Workspace changes → stop old watcher, start new      │
│                                                          │
│  Source B: GUI Push                                       │
│  ─────────────────                                       │
│  Implementation: POST /api/companion/observe              │
│  Events:                                                 │
│    { type: "app", name: "Code", title: "auth.ts" }      │
│    { type: "app", name: "Chrome", title: "JWT docs" }   │
│    { type: "app", name: "Figma", title: "Dashboard" }   │
│    { type: "screenshot", image: <base64> }               │
│  Notes:                                                  │
│    - GUI uses native OS APIs (NSWorkspace on macOS)       │
│    - Fires on app switch / window title change            │
│    - No polling — macOS notifications are event-driven    │
│    - Screenshot only when user opts in or triggers hotkey │
│                                                          │
│  Source C: Git                                            │
│  ─────────────────                                       │
│  Implementation: fs watch on .git/HEAD and .git/refs/     │
│  Events:                                                 │
│    { type: "git", action: "commit", branch: "main" }    │
│    { type: "git", action: "checkout", branch: "feat" }  │
│    { type: "git", action: "merge" }                      │
│  Notes:                                                  │
│    - Piggybacks on the file watcher (Source A)            │
│    - .git/HEAD changes = branch switch                    │
│    - .git/refs/ changes = new commit                      │
│                                                          │
│  Source D: Terminal                                        │
│  ─────────────────                                       │
│  Implementation: capture own PTY stdout                   │
│  Events:                                                 │
│    { type: "terminal", output: "3 tests failed" }        │
│    { type: "terminal", output: "build succeeded" }       │
│  Notes:                                                  │
│    - Only HLVM's own terminal, not user's other terminals │
│    - Useful when companion triggers shell_exec            │
│                                                          │
│  Source E: User Messages                                  │
│  ─────────────────                                       │
│  Implementation: existing HTTP endpoints                  │
│  Events:                                                 │
│    { type: "user", message: "hey" }                      │
│    { type: "user", action: "Yes please" }                │
│  Notes:                                                  │
│    - User typing in GUI chat                              │
│    - User tapping action buttons on suggestions           │
│                                                          │
│  Source F: Idle Transition                                 │
│  ─────────────────                                       │
│  Implementation: internal timer, fires on STATE CHANGE    │
│  Events:                                                 │
│    { type: "idle", duration: 300 }  // active→idle       │
│    { type: "active" }                // idle→active       │
│  Notes:                                                  │
│    - NOT a periodic timer                                 │
│    - Only emits on transition (went idle / came back)     │
│    - "idle" = no events from any source for N seconds     │
│                                                          │
│  All sources merge into one AsyncIterable.                │
│  Debounced at 3 seconds.                                 │
│  Fed to LLM.                                             │
└─────────────────────────────────────────────────────────┘
```


## 7. Privacy Architecture

HLVM is a **personal** AI. It can see a lot. Privacy is non-negotiable.

### 7.1 Consent Gate

The user controls exactly what the companion can observe.
Per-category toggle. Off by default for sensitive categories.

```
┌─────────────────────────────────────────────────────┐
│  HLVM Companion — Awareness Settings                 │
│                                                      │
│  What can your companion see?                        │
│                                                      │
│  ☑ File system activity    (saves, creates, deletes)│
│  ☑ Git changes             (commits, branches)      │
│  ☑ Active app name         (which app is in front)  │
│  ☐ Window title            (what's in the title bar)│
│  ☐ Screen content          (periodic screenshots)   │
│  ☐ Calendar events         (your schedule)          │
│                                                      │
│  Always blocked:                                     │
│  🔒 Password managers                               │
│  🔒 Banking & finance apps                          │
│  🔒 Private/incognito browsing                      │
│  🔒 Keystrokes & clipboard                          │
│                                                      │
│  Processing:  ◉ On-device only   ○ Cloud allowed    │
│  Indicator:   ◉ Always show 👁   ○ Hide             │
│                                                      │
│  [ Pause All ]                                       │
└─────────────────────────────────────────────────────┘
```

### 7.2 Data Flow and Privacy

```
Raw observation (screenshot, window title, file path)
       │
       ▼
  Consent gate: is this category enabled?
       │
  No ──▶ discarded, never reaches LLM
       │
  Yes ─▼
       │
  On-device processing mode?
       │
  Yes ──▶ Local LLM (Ollama) processes it
  │       Raw data never leaves machine.
  │       Structured summary stays in local memory.
  │
  No ───▶ Cloud LLM receives observation
          (user explicitly chose this)
```

### 7.3 Key Privacy Rules

1. **Consent before observation.** First launch has an explicit setup flow.
   Nothing is observed until user enables categories.
2. **Visible indicator.** When companion is observing, menu bar shows 👁.
   User always knows.
3. **One-click pause.** Instantly stops all observation. No confirmation dialog.
4. **On-device default.** Local Ollama processes observations by default.
   Cloud only if user explicitly enables it.
5. **Raw data discarded.** Screenshots, window titles, etc. are processed
   into text summaries and then discarded. Not stored.
6. **Hardcoded blocks.** Password managers, banking apps, private browsing
   are always blocked. User cannot override this.


## 8. Two-Model Strategy

The companion needs to be cheap and fast for observation processing, but
powerful for actual actions (code edits, complex reasoning).

```
Observations arrive
       │
       ▼
┌─────────────────────────┐
│  Companion Model         │
│  (local Ollama / Haiku)  │
│                          │
│  Cheap. Fast. Always on. │
│  Handles 95% of work:   │
│  - "Should I speak?"     │
│  - "What should I say?"  │
│  - Read-only tool calls  │
│                          │
│  Cost: ~$0/hr (local)    │
│  Latency: <2s            │
└────────────┬─────────────┘
             │
             │  only when complex action needed
             │  AND user approved it
             │
             ▼
┌─────────────────────────┐
│  Action Model            │
│  (Sonnet / Opus / GPT-4) │
│                          │
│  Powerful. Expensive.    │
│  On-demand only:         │
│  - Multi-file refactors  │
│  - Bug diagnosis         │
│  - Complex code gen      │
│                          │
│  Cost: per-task          │
│  Latency: 5-30s          │
└─────────────────────────┘
```

The context handoff between models:
- Companion model decides "user wants auth.ts fixed"
- Companion summarizes the relevant context into a task description
- Action model receives the task + relevant files (via tool calls)
- Action model executes via existing ReAct loop
- Result returns to companion context


## 9. Integration with Existing HLVM

### 9.1 Where It Lives

```
src/hlvm/
├── companion/              ← NEW module
│   ├── mod.ts              ← start/stop companion, export API
│   ├── observe.ts          ← ObservationStream: merge sources, debounce
│   ├── loop.ts             ← the for-await companion loop
│   └── context.ts          ← CompanionContext: memory, history, compaction
│
├── agent/                  ← EXISTING (unchanged)
│   ├── orchestrator.ts     ← ReAct loop (reused for action escalation)
│   ├── registry.ts         ← tool registry (shared with companion)
│   ├── session.ts          ← session management
│   └── ...
│
├── cli/
│   └── repl/
│       └── http-server.ts  ← MODIFIED: add companion endpoints
│
└── common/
    └── platform.ts         ← MODIFIED: add Platform.watch() abstraction
```

### 9.2 New HTTP Endpoints

```
POST /api/companion/observe       GUI pushes observation events
GET  /api/companion/stream        SSE — companion output to GUI
POST /api/companion/respond       User responds to companion
GET  /api/companion/settings      Get awareness settings
PATCH /api/companion/settings     Update awareness settings
POST /api/companion/pause         Pause all observation
POST /api/companion/resume        Resume observation
```

### 9.3 How Companion Integrates with Interactive Agent

The user can also chat with HLVM interactively (existing `hlvm ask` / GUI chat).
The companion and interactive agent share one unified context.

```
┌──────────────────────────────────────────────┐
│            UNIFIED CONTEXT                    │
│                                               │
│  ┌─────────────────────────────────────────┐ │
│  │ Observations (from companion)           │ │
│  │ [10:23] file:save auth.ts               │ │
│  │ [10:24] app: Chrome — JWT docs          │ │
│  └─────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────┐ │
│  │ Companion messages                      │ │
│  │ companion: "want me to fix that?"       │ │
│  │ user: "yes"                             │ │
│  │ companion: [edited auth.ts]             │ │
│  └─────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────┐ │
│  │ Interactive chat                        │ │
│  │ user: "explain the auth flow"           │ │
│  │ agent: "the auth flow works by..."      │ │
│  └─────────────────────────────────────────┘ │
│                                               │
│  Both companion and interactive agent read    │
│  and write to the same context. No split      │
│  brain. The interactive agent knows what      │
│  the companion did and vice versa.            │
└──────────────────────────────────────────────┘
```

### 9.4 Concurrent Access: Companion Yields

When user is actively chatting (interactive agent is running),
the companion pauses LLM calls. User interaction always takes priority.

```
t=0  User sends message via GUI
     → Interactive agent starts processing
     → Companion: observations still collected, but LLM calls paused

t=5  Interactive agent responds
     → Companion: resumes LLM calls with accumulated observations
```

This prevents: Ollama request queue contention, conflicting actions,
and the companion interrupting an active conversation.


## 10. Cross-Platform Strategy

All intelligence lives in the `hlvm` binary (Deno). The GUI is a thin
renderer that can be reimplemented for any platform.

```
WHAT LIVES WHERE:

hlvm binary (Deno — macOS, Linux, Windows):
  ✓ File watching           Deno.watchFs() — cross-platform
  ✓ Observation stream      TypeScript — cross-platform
  ✓ Debounce logic          TypeScript — cross-platform
  ✓ Companion loop          TypeScript — cross-platform
  ✓ LLM calls               TypeScript — cross-platform
  ✓ Tool execution           TypeScript — cross-platform
  ✓ Permission logic         TypeScript — cross-platform
  ✓ Context management       TypeScript — cross-platform
  ✓ Privacy filtering        TypeScript — cross-platform
  ✓ HTTP server + SSE        TypeScript — cross-platform

GUI (platform-specific, thin):
  → Push active window info    macOS: NSWorkspace
                               Linux: xdotool / D-Bus
                               Windows: Win32 API
  → Render notifications       native UI framework
  → Forward user responses     HTTP POST
  → Settings UI                native UI framework
  → Menu bar icon              native UI framework

The GUI contract is minimal:
  Push:   POST /api/companion/observe { app, title, screenshot? }
  Listen: GET  /api/companion/stream  (SSE)
  Reply:  POST /api/companion/respond { action }

Any GUI framework can implement this in ~100 lines.
```


## 11. Technical Concerns and Solutions

### 11.1 SSOT Compliance

`Deno.watchFs()` is a direct Deno API call. Our rules forbid this.

**Solution:** Add `Platform.watch()` abstraction:
```typescript
interface Platform {
  fs: { ... }           // existing
  watch(path: string, options?: WatchOptions): AsyncIterable<FsEvent>  // new
}
```

Implementation handles dedup (macOS FSEvents duplicates) and ignore patterns
(.git, node_modules) internally.

### 11.2 Battery Awareness

Continuous observation + LLM calls drain battery on laptops.

**Solution:** Detect power state. On battery → companion pauses LLM calls.
File watching continues (kernel-level, negligible power). Companion resumes
when plugged in or when user explicitly pings it.

```
macOS:   IOKit power source API
Linux:   /sys/class/power_supply/
Windows: Win32 GetSystemPowerStatus
```

### 11.3 Context Growth

Observations accumulate. After hours of coding, context is huge.

**Solution:** Aggressive compaction. Old observations get summarized:
```
Raw (recent):   [10:50] file:save auth.ts
                [10:51] file:save auth.test.ts
Compacted (old): "Between 9am-10am: user worked on auth module
                  (15 saves), checked JWT docs (3 times)"
```

We already have context compaction in the orchestrator. Same mechanism.

### 11.4 Screenshots Are Hard

Vision models are slow, expensive, and not all local models support them.
macOS Screen Recording permission is confusing when requested by a terminal.

**Solution:** Defer screenshots to a later phase. Start with file events +
GUI-pushed app/window metadata. This gives enough signal for a useful
companion. Add visual inference after the text-based companion works well.

### 11.5 Workspace Detection

HLVM is global, not per-project. How does it know which directory to watch?

**Solution:** GUI pushes active app info. From that, detect workspace:
- Window title parsing: "VSCode — auth.ts — ~/dev/appA" → workspace is ~/dev/appA
- For terminals: CWD detection via OS APIs
- Fallback: user registers project directories in settings

When workspace changes, stop old watcher, start new one.
Companion context is per-workspace but personality is global.


## 12. What The Companion Is NOT

To avoid ambiguity:

- **Not a chatbot.** It doesn't wait for you to talk to it.
- **Not a coding tool.** It can help with code, but it's not limited to that.
- **Not surveillance.** It only sees what you consent to.
- **Not Clippy.** It stays silent most of the time. Quality over frequency.
- **Not a rule engine.** No hardcoded "if X then say Y." LLM decides everything.
- **Not a cron job.** No polling. Event-driven only.
- **Not platform-specific.** All logic in Deno. GUI is a thin shell.


## 13. Implementation Phases

### Phase 1: Foundation
- `Platform.watch()` abstraction with dedup + ignore
- `ObservationStream` merging file watcher + HTTP push endpoint
- Debounce operator for AsyncIterable
- Basic companion loop calling local Ollama
- SSE endpoint for companion output
- GUI: subscribe to SSE, render bubbles

### Phase 2: Intelligence
- Companion system prompt tuning (personality, when to speak)
- Context management with compaction
- Two-model strategy (companion + action escalation)
- Unified context with interactive agent
- Companion yields during active chat

### Phase 3: Awareness
- GUI pushes active window info (per-platform native APIs)
- Workspace detection and dynamic watcher switching
- Consent settings UI
- Battery-aware throttling
- Idle transition detection

### Phase 4: Visual (future)
- Opt-in screenshot capture
- On-device vision processing
- Visual context extraction

### Phase 5: Ecosystem (future)
- Skill discovery and hot-loading
- Multi-channel (messaging platforms)
- Cross-device sync
- Community skill marketplace


## 14. Summary

```
HLVM today:     User asks  →  Agent answers  →  Sleeps

HLVM tomorrow:  Events fire  →  Debounce  →  LLM decides everything
                     ▲                              │
                     │                              ▼
                     └──── observe ◄──── act/speak/silence
```

One sentence: **HLVM becomes an event-driven personal AI that observes
your activity, feeds it to an LLM, and lets the LLM decide what to do —
talk, help, act, or stay quiet.**

The LLM is the only decision maker. We just give it good eyes and good
hands.
