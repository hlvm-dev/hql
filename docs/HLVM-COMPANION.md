# HLVM Companion Agent

An always-on, event-driven AI companion that observes user desktop activity and proactively offers help when it detects opportunities — like an IDE copilot for your entire desktop.

## Architecture

```
                        Swift GUI (macOS)                              Deno Backend
  ┌───────────────────────────────────────┐     ┌─────────────────────────────────────────────────┐
  │                                       │     │                                                 │
  │  DesktopObserver                      │     │  HTTP Handlers (companion.ts)                   │
  │  ├── AX window notifications          │     │  ├── POST /api/companion/observe                │
  │  ├── NSWorkspace app switch           │ ──► │  ├── GET  /api/companion/stream (SSE)           │
  │  ├── NSPasteboard change monitor      │     │  ├── POST /api/companion/respond                │
  │  └── Optional external observations   │     │  ├── GET  /api/companion/status                 │
  │                                       │     │  └── POST /api/companion/config                 │
  │  CompanionStore                       │     │                                                 │
  │  ├── SSE subscription (auto-reconnect)│ ◄── │  Pipeline (loop.ts)                             │
  │  ├── forwards events to ReplLogViewModel     │  ┌─────────────────────────────────────────┐    │
  │  └── ScreenCaptureManager (vision)    │     │  │ bus → debounce → redact → context       │    │
  │                                       │     │  │      → gate(LLM) → decide(LLM) → emit   │    │
  └───────────────────────────────────────┘     │  │      → [handleActFlow | handleVisionFlow]│    │
                                                │  └─────────────────────────────────────────┘    │
                                                └─────────────────────────────────────────────────┘
```

## Pipeline Stages

### 1. Observation Bus (`bus.ts`)
Async iterable ring buffer. Accepts observations from the HTTP endpoint and yields them to the pipeline. Caps at `maxBufferSize` (default 100), dropping oldest on overflow.

### 2. Debounce (`debounce.ts`)
Batches rapid observations within a configurable time window (`debounceWindowMs`, default 3s). When a batch exceeds `maxBatchSize`, **triage** prioritizes high-signal events (`check.failed`, `terminal.result`, `app.switch`) over low-signal ones.

### 3. Redact (`redact.ts`)
Scrubs PII from observation data before it reaches any LLM:
- API keys (`sk_live_*`, `sk_test_*`, bearer tokens) → `[REDACTED]`
- Long clipboard text → truncated with content hash
- Deep object/array traversal (recursive)
- **Immutable** — original observations are never mutated

### 4. Context (`context.ts`)
Rolling buffer maintaining environmental state:
- Active app name (from `app.switch` events)
- Window title (from `ui.window.title.changed` events)
- Recent clipboard content
- Observation history count

Builds a prompt summary for LLM consumption. Observations themselves are passed separately by callers.

### 5. DND Check
Skips processing if the user was recently active (any observation resets the activity timer). Controlled by `quietWhileTypingMs` (default 5s). This is a generic activity-based check, not typing-specific despite the legacy config name.

### 6. Gate (`gate.ts`)
Binary LLM classifier (cheap/fast model). Responds `SILENT` or `NOTIFY <reason>`. Default bias is `SILENT` — only `NOTIFY` on clear, unmistakable opportunities (copied error, repeated docs visits, build failure).

### 7. Decide (`decide.ts`)
Richer LLM produces structured JSON decisions:

| Type | Behavior |
|------|----------|
| `SILENT` | No action. Default. |
| `CHAT` | Brief conversational message (e.g., explain an error) |
| `SUGGEST` | Specific actionable suggestion |
| `ACT` | Execute via agent runner. Includes `actions[]` with `requiresApproval: true` |
| `ASK_VISION` | Request screenshot for visual context |

JSON parsing has 3-stage fallback: direct parse → markdown fence extraction → greedy brace regex.

### 8. Rate Limit
Caps notifications at `maxNotifyPerMinute` (default 3) using a sliding 60-second window.

### 9. Dispatch

- **CHAT/SUGGEST**: Emit SSE event directly (type `"message"` or `"suggestion"`) and render through the normal chat message stream
- **ACT**: Emit `action_request` → wait for user approval via SSE → execute via `runAgentQuery` with `toolDenylist` preventing recursion (`delegate_agent`, `complete_task`, `ask_user`)
- **ASK_VISION**: Emit `vision_request` → wait for approval → emit `capture_request` → Swift captures screenshot → sends back as `screen.captured` observation

## Observation Types

```typescript
type ObservationKind =
  | "app.switch"              // User switched active application
  | "ui.window.title.changed" // Window title changed (via Accessibility API)
  | "ui.window.focused"       // Window gained focus
  | "ui.selection.changed"    // Text selection changed
  | "clipboard.changed"       // Clipboard content changed
  | "fs.changed"              // File system change detected
  | "check.failed"            // Build/lint/test check failed
  | "check.passed"            // Build/lint/test check passed
  | "terminal.result"         // Terminal command output
  | "screen.captured"         // Screenshot captured (base64 in data.imageBase64)
  | "custom";                 // Extension point
```

## SSE Events (Backend → GUI)

```typescript
type CompanionEventType =
  | "message"          // CHAT decision → normal assistant chat message
  | "suggestion"       // SUGGEST decision → normal assistant chat message
  | "action_request"   // ACT decision → interaction approval prompt (Allow/Deny)
  | "vision_request"   // ASK_VISION → screenshot consent prompt
  | "capture_request"  // Approved vision → triggers Swift screenshot capture
  | "action_result"    // Agent execution result
  | "action_cancelled" // Denied, timed out, or aborted
  | "status_change";   // Companion state change
```

## HTTP API

### `POST /api/companion/observe`
Ingest one or more observations.

```json
// Single
{ "kind": "app.switch", "timestamp": "...", "source": "swift-gui", "data": { "appName": "Xcode" } }

// Batch
[{ "kind": "clipboard.changed", ... }, { "kind": "app.switch", ... }]
```

**Response**: `201 { "queued": N }` or `503` if companion not running.

### `GET /api/companion/stream`
SSE stream of companion events. Supports `Last-Event-ID` for replay.

### `POST /api/companion/respond`
User approval/denial for action or vision requests.

```json
{ "eventId": "comp-42", "approved": true, "actionId": "fix-1" }
```

### `GET /api/companion/status`
Returns current state, running flag, and config.

### `POST /api/companion/config`
Enable/disable the companion.

```json
{ "enabled": true }
```

## Configuration

```typescript
interface CompanionConfig {
  enabled: boolean;           // default: false
  debounceWindowMs: number;   // default: 3000
  maxBufferSize: number;      // default: 100
  quietWhileTypingMs: number; // default: 5000 (generic activity window, not typing-specific)
  maxNotifyPerMinute: number; // default: 3
  gateModel?: string;         // cheap/fast model for binary gate
  decisionModel?: string;     // richer model for nuanced decisions
}
```

## Approval Flow

```
                     ACT / ASK_VISION Decision
                              │
                    emitCompanionEvent()
                              │
                   ┌──────────▼──────────┐
                   │  SSE: action_request │
                   │  or vision_request   │──────► Swift InteractionBubbleView
                   └──────────┬──────────┘        (Allow / Deny buttons)
                              │
                   waitForApproval(eventId)
                              │                    User taps button
                   ┌──────────▼──────────┐              │
                   │   Pending Map       │◄─────── POST /respond
                   │   (Promise-based)   │         { eventId, approved }
                   └──────────┬──────────┘
                              │
                 ┌────────────┼────────────┐
                 │            │            │
              Approved     Denied       Timeout
                 │            │            │
           runAgentQuery  action_      action_
           (ACT) or      cancelled    cancelled
           capture_req
           (VISION)
```

## Tool Permission Routing

During ACT execution, tool calls are classified by safety level:
- **L0** (read-only: `read_file`, `list_files`, etc.) → auto-approved
- **L1+** (write, execute, delete) → routed through SSE approval bubble

## Modules

| File | Purpose | Lines |
|------|---------|-------|
| `types.ts` | Pure type definitions, zero runtime imports | ~110 |
| `bus.ts` | Async iterable ring buffer for observations | ~60 |
| `debounce.ts` | Time-windowed batching with triage priority | ~85 |
| `redact.ts` | PII scrubbing (API keys, tokens, long text) | ~70 |
| `context.ts` | Rolling context buffer with prompt builder | ~105 |
| `gate.ts` | Binary SILENT/NOTIFY LLM classifier | ~60 |
| `decide.ts` | 5-type decision engine with JSON parsing | ~130 |
| `loop.ts` | Main pipeline orchestrator + ACT/VISION flows | ~310 |
| `approvals.ts` | Promise-based pending approval lifecycle | ~85 |
| `mod.ts` | Barrel exports + start/stop lifecycle | ~80 |

## Swift GUI Integration

### DesktopObserver
- **App switch**: `NSWorkspace.didActivateApplicationNotification`
- **Window title**: Accessibility notifications (`kAXFocusedWindowChangedNotification`, `kAXTitleChangedNotification`) with no timer polling
- **Clipboard**: `NSPasteboard` change count monitoring via `Timer.scheduledTimer` (1s interval; macOS does not provide a reliable global clipboard-changed event callback)

### CompanionStore
- SSE subscription with auto-reconnect on disconnect
- App launches companion runtime automatically (always-on by default in current app wiring)
- Event routing: forwards companion SSE events into `ReplLogViewModel`
- `message`/`suggestion`/`action_result`/`action_cancelled` are mapped into normal assistant chat messages (`HlvmMessage`)
- `action_request`/`vision_request` are routed through the existing interaction flow (`InteractionBubbleView`)
- `capture_request` → `ScreenCaptureManager.captureAndOptimizeScreen()` → `POST /observe` with `screen.captured`

### Chat Rendering
- Companion output is not a separate floating widget anymore
- User-visible output uses the same chat pipeline and chat bubbles as normal assistant responses
- Companion approvals use the same interaction bubble style already used by agent interactions

## Test Coverage

96 tests covering:
- **Unit**: bus, debounce, redact, context, gate, decide, approvals (per-module)
- **HTTP E2E**: All 5 endpoints with real handlers
- **Pipeline E2E**: Full bus→debounce→redact→context→gate→decide flow
- **Loop integration**: `runCompanionLoop` with mock LLMs via `setAgentEngine` — CHAT dispatch, gate SILENT skip, ASK_VISION approval/denial, ACT denial, rate limiting
- **Direct flow**: `handleActFlow` (no-action-found, timeout), `handleVisionFlow` (abort)
- **Security**: `companionOnInteraction` L0 auto-approve, L1 SSE approval, abort→deny

## Manual E2E (User POV)

Use this checklist to validate the full companion behavior from the app UI.

1. Preconditions
- Launch HLVM normally.
- Ensure macOS permissions are granted:
- Accessibility (for window title/focus observation)
- Screen Recording (for vision capture path)
- Open the REPL/chat window (companion output is rendered in normal chat + interaction UI).

2. Observation layer works
- Switch between apps (Terminal, Xcode, browser).
- Change focused window/tab titles.
- Copy single-line and multi-line text.
- Expected: `[observer] app.switch ...`, `[observer] ui.window.title.changed ...`, `[observer] clipboard.changed ...` logs appear.

3. Backend ingestion and stream are alive
- From terminal, confirm companion status and stream:
- `GET /api/companion/status` shows `running: true`
- `GET /api/companion/stream` stays connected and emits `companion_event` payloads

4. Chat/Suggest path
- Trigger a high-signal event (for example: copy a clear error message).
- Expected: companion emits assistant output into the normal chat bubble stream (same surface as standard chat replies).

5. Approval path
- Trigger `ACT` / `ASK_VISION`.
- Expected: approval prompt appears through the standard interaction UI (`InteractionBubbleView`) with Allow/Deny.

6. ACT approval path
- Trigger a scenario where companion proposes an action.
- Expected sequence:
- `action_request` interaction prompt appears with `Allow`/`Deny`
- `Deny` → `action_cancelled`
- `Allow` → action runs, then `action_result` appears

7. ASK_VISION path
- Trigger a scenario needing visual context.
- Expected sequence:
- `vision_request` interaction prompt appears
- `Deny` → `action_cancelled`
- `Allow` → `capture_request` emitted, screenshot captured, `screen.captured` observation sent back

8. Reconnect behavior
- Briefly drop network/backend connectivity, then restore.
- Expected:
- SSE auto-reconnect succeeds
- Stream resumes
- If replay window is exceeded, a `status_change` with `replay_gap_detected` is emitted
