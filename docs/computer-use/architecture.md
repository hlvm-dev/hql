# Computer Use — Architecture

## System Design

```
                                    ┌─────────────────────┐
                                    │   LLM (vision)      │
                                    │  Claude/GPT-4o/etc  │
                                    └────────┬────────────┘
                                             │ tool_calls / image attachments
                                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        HLVM Orchestrator                             │
│                                                                      │
│  orchestrator-tool-execution.ts   orchestrator-response.ts           │
│  ┌──────────────────────┐         ┌────────────────────────────┐     │
│  │ Execute tool fn      │         │ If _imageAttachment:       │     │
│  │ Extract _imageAttach │────────▶│   Inject as user message   │     │
│  │ Return ToolExecResult│         │   with binary attachment   │     │
│  └──────────────────────┘         └────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    Tool Layer (tools.ts)                              │
│                                                                      │
│  ┌─────────┐  ┌──────────────┐  ┌──────────────────┐                │
│  │ guards()│  │ parseCoord() │  │ scrollDirection() │                │
│  │ platform│  │ parseMods()  │  │ ToDeltas()        │                │
│  │ + lock  │  └──────────────┘  └──────────────────┘                │
│  └────┬────┘                                                         │
│       ▼                                                              │
│  22 tool functions: cuScreenshotFn, cuLeftClickFn, ...               │
│  Each: guards() → getExecutor() → executor.method() → okTool()      │
└──────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│              Executor Layer (executor.ts)                             │
│                                                                      │
│  createCliExecutor() — CC-clone ComputerExecutor implementation      │
│                                                                      │
│  TS logic (identical to CC):                                         │
│  withModifiers, releasePressed, animatedMove, typeViaClipboard,      │
│  moveAndSettle, isBareEscape, computeTargetDims                      │
└──────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│              Bridge Layer (bridge.ts)                                 │
│                                                                      │
│  CC uses:                         HLVM uses:                         │
│  @ant/computer-use-input (Rust)   osascript CGEvent (async)          │
│  @ant/computer-use-swift (Swift)  screencapture + osascript          │
│                                                                      │
│  ComputerUseInputAPI:   moveMouse, mouseButton, keys, typeText       │
│  ComputerUseSwiftAPI:   screenshot, display, apps, hotkey            │
└──────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
              ┌──────────┐
              │  macOS    │
              │  CGEvent  │
              │  APIs     │
              └──────────┘
```

## File Map

```
src/hlvm/agent/computer-use/
├── mod.ts              (34 lines)   Barrel re-export
├── tools.ts            (1023 lines) 22 tool definitions + guards + helpers
├── executor.ts         (608 lines)  ComputerExecutor (CC clone)
├── bridge.ts           (680 lines)  macOS native bridge (osascript/JXA)
├── types.ts            (253 lines)  Type defs, image sizing, executor interface
├── lock.ts             (287 lines)  Session lock (prevents concurrent CU)
├── cleanup.ts          (108 lines)  Post-turn cleanup (unhide apps)
├── common.ts           (65 lines)   Bundle IDs, capabilities
├── keycodes.ts         (73 lines)   macOS keycodes + modifier map
├── app-names.ts        (204 lines)  App filtering for display (CC clone)
├── drain-run-loop.ts   (26 lines)   No-op (CC has Swift run loop drain)
└── esc-hotkey.ts       (41 lines)   No-op (CC has CGEventTap escape)
                        ─────────
                        ~3,400 lines total
```

## Image Attachment Pipeline

This is the critical path that makes screenshots visible to the LLM:

```
1. Tool returns _imageAttachment
   ┌─────────────────────────────────────┐
   │ { ...okTool({width, height}),       │
   │   _imageAttachment: {              │
   │     data: base64,                   │
   │     mimeType: "image/jpeg",         │
   │     width, height                   │
   │   }                                 │
   │ }                                   │
   └─────────────────────────────────────┘
                    │
2. Orchestrator extracts _imageAttachment
   (orchestrator-tool-execution.ts:1126-1138)
   → ToolExecutionResult.imageAttachments[]
                    │
3. Response builder injects as user message
   (orchestrator-response.ts:330-346)
   → { role: "user",
       content: "[Screenshot attached]",
       attachments: [{ mode: "binary", kind: "image", data }] }
                    │
4. SDK converts to provider format
   (sdk-runtime.ts convertToSdkMessages)
   → { type: "image", image: base64data }
                    │
5. Provider sends to LLM API
   → Model sees screenshot, decides next action
```

**Tools that return images:** `cu_screenshot`, `cu_zoom`, `cu_wait`

## Session Lock

CC pattern: only one agent session can use computer-use at a time.

```
Session A calls cu_left_click → lockGuard() → tryAcquireComputerUseLock("session-a")
  → acquired (fresh)

Session B calls cu_screenshot → lockGuard() → tryAcquireComputerUseLock("session-b")
  → blocked: "Computer use is in use by another session"

Session A finishes → releaseComputerUseLock()

Session B retries → acquired
```

Lock is reentrant (same session can re-acquire). Released on cleanup or session end.

## CC vs HLVM Differences

| Aspect | Claude Code | HLVM |
|--------|-------------|------|
| Tool prefix | `mcp__computer-use__*` | `cu_*` |
| Transport | MCP server | Direct tool registry |
| Input bridge | `@ant/computer-use-input` (Rust enigo) | osascript CGEvent |
| Screenshot | `@ant/computer-use-swift` (Swift) | screencapture + osascript |
| Run loop drain | Swift `_drainMainRunLoop()` | No-op passthrough |
| Escape hotkey | CGEventTap (Swift) | No-op |
| Permission dialog | React `setToolJSX` modal | Stub (system accessibility) |
| Feature gates | GrowthBook | Always enabled on macOS |
| Coordinate mode | Configurable (pixels/normalized) | Always pixels |
| State caching | `ScreenshotDims` in AppState | None (stateless) |
