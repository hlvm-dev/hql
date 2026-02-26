# HLVM Companion Agent

An always-on, event-driven AI companion that observes user desktop activity and proactively offers help when it detects opportunities — like an IDE copilot for your entire desktop.

## Architecture

```
                        Swift GUI (macOS)                              Deno Backend
  ┌───────────────────────────────────────┐     ┌─────────────────────────────────────────────────┐
  │                                       │     │                                                 │
  │  DesktopObserver                      │     │  HTTP Handlers (companion.ts)                   │
  │  ├── AX window title (accessibility)  │     │  ├── POST /api/companion/observe                │
  │  ├── NSWorkspace app switch           │ ──► │  ├── GET  /api/companion/stream (SSE)           │
  │  ├── NSPasteboard clipboard poll      │     │  ├── POST /api/companion/respond                │
  │  └── Build/test result hooks          │     │  ├── GET  /api/companion/status                 │
  │                                       │     │  └── POST /api/companion/config                 │
  │  CompanionStore                       │     │                                                 │
  │  ├── SSE subscription (auto-reconnect)│ ◄── │  Pipeline (loop.ts)                             │
  │  ├── CompanionBubbleView (approval UI)│     │  ┌─────────────────────────────────────────┐    │
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

- **CHAT/SUGGEST**: Emit SSE event directly (type `"message"` or `"suggestion"`)
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
  | "message"          // CHAT decision → conversational bubble
  | "suggestion"       // SUGGEST decision → actionable bubble
  | "action_request"   // ACT decision → approval bubble (Allow/Deny)
  | "vision_request"   // ASK_VISION → screenshot consent bubble
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
                   │  or vision_request   │──────► Swift CompanionBubbleView
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
- **Window title**: Accessibility API (`AXUIElement`) polling
- **Clipboard**: `NSPasteboard` change count polling (1s interval)

### CompanionStore
- SSE subscription with auto-reconnect on disconnect
- Event routing: `message`/`suggestion` → notification bubble, `action_request`/`vision_request` → approval bubble
- `capture_request` → `ScreenCaptureManager.captureAndOptimizeScreen()` → `POST /observe` with `screen.captured`

### CompanionBubbleView
- Reuses `InteractionBubbleView` pattern (Allow/Deny buttons)
- Animated appearance, auto-dismiss on timeout

## Test Coverage

85 tests covering:
- **Unit**: bus, debounce, redact, context, gate, decide, approvals (per-module)
- **HTTP E2E**: All 5 endpoints with real handlers
- **Pipeline E2E**: Full bus→debounce→redact→context→gate→decide flow
- **Loop integration**: `runCompanionLoop` with mock LLMs via `setAgentEngine` — CHAT dispatch, gate SILENT skip, ASK_VISION approval/denial, ACT denial, rate limiting
- **Direct flow**: `handleActFlow` (no-action-found, timeout), `handleVisionFlow` (abort)
- **Security**: `companionOnInteraction` L0 auto-approve, L1 SSE approval, abort→deny
