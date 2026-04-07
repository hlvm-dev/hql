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
   (orchestrator-tool-execution.ts)
   → ToolExecutionResult.imageAttachments[]
                    │
3. Vision gating (orchestrator-response.ts)
   ┌──────────────────────────────────────────────┐
   │  if (config.visionCapable !== false)          │
   │    → inject as user message with attachment   │
   │  else                                         │
   │    → text fallback: "[Screenshot captured     │
   │       (WxHpx) — not shown: model lacks vision]│
   └──────────────────────────────────────────────┘
                    │ (vision path)
4. Response builder injects as user message
   → { role: "user",
       content: "[Screenshot attached]",
       attachments: [{ mode: "binary", kind: "image", data }] }
                    │
5. SDK converts to provider format
   (sdk-runtime.ts convertToSdkMessages)
   → { type: "image", image: base64data }
                    │
6. Provider sends to LLM API
   → Model sees screenshot, decides next action
```

**Tools that return images:** `cu_screenshot`, `cu_zoom`, `cu_wait`

**Note:** Non-vision models never reach step 3 for CU tools because `session.ts` adds all `cu_*` tools to `effectiveToolDenylist` when `!visionCapable`. The text fallback in step 3 is defense-in-depth for edge cases where an image attachment comes from a non-CU source.

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

## Vision Gating Pipeline

Non-vision models are automatically blocked from CU tools. This is derived in `session.ts`:

```
session.ts: createAgentLLMConfig()
  │
  ├─ modelInfo?.capabilities?.includes("vision") → true/false
  │    OR
  ├─ isFrontier (anthropic/openai/google) → default true
  │    OR
  └─ local model without modelInfo → default false
  │
  ▼
visionCapable = true                    visionCapable = false
  │                                       │
  ├─ CU tools available                   ├─ cu_* added to effectiveToolDenylist
  ├─ CU system prompt section rendered    ├─ CU system prompt section suppressed
  ├─ Images injected as attachments       ├─ Images → text fallback
  └─ Full CU functionality                └─ CU completely hidden from model
```

Threading path:
```
session.ts (derive visionCapable)
  ├─→ buildCompiledPromptArtifacts → compileSystemPrompt → sections.ts
  │     (CU prompt section gated on visionCapable)
  └─→ AgentSession.visionCapable → agent-runner.ts → OrchestratorConfig
        → orchestrator-response.ts (image injection gated)
```

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
| Vision gating | N/A (Claude always has vision) | Auto-derive from modelInfo |
| LLM flexibility | Claude only | Any vision-capable LLM |
| CU system prompt | Injected by Anthropic API backend | Self-contained in `sections.ts` |
