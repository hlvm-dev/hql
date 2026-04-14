# Bird's-Eye View — Full System Map

## The Complete Pipeline

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║   USER: "go to python.org and download the installer"                      ║
║                                                                            ║
╚══════════════════════════════════════════╤═══════════════════════════════════╝
                                           │
                                           ▼
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  LAYER 1: ENTRY                                                           ┃
┃  ─────────────                                                            ┃
┃                                                                           ┃
┃  ask.ts ──HTTP──▶ agent-runner.ts:727 runAgentQuery()                     ┃
┃                     │                                                     ┃
┃                     ├─ resolve model ("auto" → concrete provider/model)   ┃
┃                     ├─ check shouldReuseAgentSession()                    ┃
┃                     │    YES → refreshReusableAgentSession()              ┃
┃                     │    NO  → createAgentSession()  ──────────────────┐  ┃
┃                     │                                                  │  ┃
┃                     │  ┌───────────────────────────────────────────────┘  ┃
┃                     │  │                                                  ┃
┃                     │  ▼                                                  ┃
┃                     │  SESSION CREATION  (session.ts:372)                  ┃
┃                     │    ├─ loadAgentPolicy()           ─┐                ┃
┃                     │    ├─ tryGetModelInfo()             ├─ parallel I/O ┃
┃                     │    ├─ classifyModelTier()          ─┘                ┃
┃                     │    ├─ computeTierToolFilter()                        ┃
┃                     │    ├─ createToolProfileState()     → 5-layer stack  ┃
┃                     │    ├─ resolveContextBudget()       → token limit    ┃
┃                     │    ├─ new ContextManager()         → msg history    ┃
┃                     │    ├─ compileSystemPrompt()        → persona+docs   ┃
┃                     │    ├─ injectPersistentMemory()     → recalled facts ┃
┃                     │    ├─ lazy MCP loader              → deferred       ┃
┃                     │    └─ engine.createLLM(config)     → callable fn    ┃
┃                     │                                                     ┃
┃                     ├─ load history, restore todos, build plan mode       ┃
┃                     ├─ build OrchestratorConfig (1358-1473)               ┃
┃                     │                                                     ┃
┃                     ▼                                                     ┃
┃              runReActLoop(query, config, llm, attachments)                ┃
┃                                                                           ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
                                ┃
                                ▼
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  LAYER 2: REACT LOOP                     orchestrator.ts:1507             ┃
┃  ───────────────────                                                      ┃
┃                                                                           ┃
┃  See 02-react-loop.md for the complete stage-by-stage breakdown.          ┃
┃  Summary:                                                                 ┃
┃                                                                           ┃
┃  ┌─── INIT ─────────────────────────────────────────────────────────────┐ ┃
┃  │ initializeLoopState() → fresh LoopState                              │ ┃
┃  │ applyRequestDomainToolProfile() → browser or general                 │ ┃
┃  │ addContextMessage(userRequest)                                       │ ┃
┃  │ requestPlan() → optional upfront planning                            │ ┃
┃  └──────────────────────────────────────────────────────────────────────┘ ┃
┃                                                                           ┃
┃  ┌─── WHILE (iterations < max && now < deadline) ───────────────────────┐ ┃
┃  │                                                                       │ ┃
┃  │  ┌─ BOUNDARY ────────────────────────────────────────────────┐       │ ┃
┃  │  │  abort? timeout? drain inboxes? shutdown?                  │       │ ┃
┃  │  └───────────────────────────────────────────────────────────┘       │ ┃
┃  │                        │                                              │ ┃
┃  │  ┌─ PRE-LLM ──────────▼─────────────────────────────────────┐       │ ┃
┃  │  │  rate limit → reminders → memory                          │       │ ┃
┃  │  │  → context pressure → compaction → tool phase → thinking  │       │ ┃
┃  │  └───────────────────────────────────────────────────────────┘       │ ┃
┃  │                        │                                              │ ┃
┃  │  ┌─ LLM CALL ─────────▼─────────────────────────────────────┐       │ ┃
┃  │  │  engine-sdk: resolve tool filter → build schema → call    │       │ ┃
┃  │  │  → stream tokens → parse tool_calls                       │       │ ┃
┃  │  │  → auto-continue if truncated (up to 3 hops)             │       │ ┃
┃  │  └───────────────────────────────────────────────────────────┘       │ ┃
┃  │                        │                                              │ ┃
┃  │              ┌─────────┴──────────┐                                   │ ┃
┃  │          has tools?            text only?                              │ ┃
┃  │              │                    │                                    │ ┃
┃  │  ┌───────────▼──────────┐   ┌────▼───────────────────────────┐       │ ┃
┃  │  │  TOOL EXECUTION      │   │  FINAL RESPONSE                │       │ ┃
┃  │  │  validate → permit   │   │  plan advance → grounding      │       │ ┃
┃  │  │  → execute → enrich  │   │  → citations → return          │       │ ┃
┃  │  └───────────┬──────────┘   └────┬───────────────────────────┘       │ ┃
┃  │              │                    │                                    │ ┃
┃  │  ┌───────────▼──────────┐        │                                    │ ┃
┃  │  │  POST-TOOL           │        │                                    │ ┃
┃  │  │  denial tracking     │        │                                    │ ┃
┃  │  │  playwright recovery │        │                                    │ ┃
┃  │  │  hybrid promotion    │        │                                    │ ┃
┃  │  └───────────┬──────────┘        │                                    │ ┃
┃  │              │                    │                                    │ ┃
┃  │              ▼                    ▼                                    │ ┃
┃  │         {continue}          {return answer}                           │ ┃
┃  │              │                    │                                    │ ┃
┃  └──────────────┘                    │                                   │ ┃
┃                                      │                                    ┃
┃  ┌─── EXHAUSTION ────────────────────┘───────────────────────────────┐   ┃
┃  │  maybeSynthesizeLoopExhaustionAnswer() → LLM with tools disabled  │   ┃
┃  │  or: buildLimitStopMessage("max_iterations" | "timeout")          │   ┃
┃  └───────────────────────────────────────────────────────────────────┘   ┃
┃                                                                           ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
                                ┃
                                ▼
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  LAYER 3: POST-LOOP                      agent-runner.ts:1480             ┃
┃  ──────────────────                                                       ┃
┃                                                                           ┃
┃  wait hooks → emit traces                                                 ┃
┃  → structured result synthesis → memory persistence                       ┃
┃  → build AgentRunnerResult → dispose session (if not reusing)             ┃
┃                                                                           ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```


## Subsystem Map — What Connects to What

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          ORCHESTRATOR CONFIG                                │
│                                                                            │
│  The god-object. Created in agent-runner.ts:1358, passed to everything.    │
│  Contains references to ALL subsystems:                                     │
│                                                                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │   context     │  │   policy     │  │ toolProfile  │  │  thinking    │   │
│  │   Manager     │  │              │  │ State        │  │  State       │   │
│  │              │  │  permissions │  │              │  │              │   │
│  │  messages[]  │  │  allow/deny  │  │  5 layers    │  │  budget      │   │
│  │  tokenBudget │  │  rules       │  │  _generation │  │  thinkingOn  │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
│         │                 │                 │                 │            │
│  ┌──────┼─────────────────┼─────────────────┼─────────────────┼────────┐  │
│  │      │     USED BY:    │                 │                 │        │  │
│  │      │                 │                 │                 │        │  │
│  │  ┌───▼───────┐    ┌────▼────┐    ┌───────▼───────┐   ┌────▼────┐  │  │
│  │  │ PRE-LLM   │    │  TOOL   │    │  ENGINE-SDK   │   │  LLM    │  │  │
│  │  │           │    │  EXEC   │    │               │   │  CALL   │  │  │
│  │  │ compaction│    │         │    │ resolveFilter │   │         │  │  │
│  │  │ injection │    │ validate│    │ buildSchemas  │   │ timeout │  │  │
│  │  │ pressure  │    │ permit  │    │ cache mgmt    │   │ retry   │  │  │
│  │  └───────────┘    │ execute │    └───────────────┘   └─────────┘  │  │
│  │                   │ enrich  │                                      │  │
│  │                   └────┬────┘                                      │  │
│  │                        │                                           │  │
│  │  ┌─────────────────────▼───────────────────────────────────────┐  │  │
│  │  │                  RESPONSE PROCESSING                        │  │  │
│  │  │                                                             │  │  │
│  │  │  ┌────────────┐  ┌───────────┐  ┌───────────┐  ┌────────┐ │  │  │
│  │  │  │ post-tool   │  │ final     │  │ plan      │  │browser │ │  │  │
│  │  │  │ execution   │  │ response  │  │ advance   │  │recovery│ │  │  │
│  │  │  │             │  │           │  │           │  │        │ │  │  │
│  │  │  │ denial track│  │ grounding │  │ step done │  │safe →  │ │  │  │
│  │  │  │ loop detect │  │ citations │  │ next step │  │hybrid  │ │  │  │
│  │  │  └─────────────┘  └───────────┘  └───────────┘  └────────┘ │  │  │
│  │  └─────────────────────────────────────────────────────────────┘  │  │
│  │                                                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐                                      │
│  │  hook        │  │  MCP         │                                      │
│  │  Runtime     │  │  (lazy)      │                                      │
│  │              │  │              │                                      │
│  │  pre/post    │  │  ensureMcp   │                                      │
│  │  tool/llm    │  │  Loaded()    │                                      │
│  │  stop hooks  │  │  deferred    │                                      │
│  └──────────────┘  └──────────────┘                                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```


## Data Flow — What Mutates, What Reads

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      MUTABLE STATE PER REACT TURN                          │
│                                                                            │
│  ┌─── LoopState (orchestrator-state.ts) ─────────────────────────────────┐ │
│  │                                                                        │ │
│  │  iterations              ─── incremented each turn                     │ │
│  │  browserDomainSignal    ─── set once, cached for loop lifetime         │ │
│  │  runtimePhase            ─── recomputed each turn                      │ │
│  │  lastToolNames           ─── updated after tool execution              │ │
│  │  toolUses                ─── accumulated across all turns              │ │
│  │  planState               ─── advanced when STEP_DONE parsed           │ │
│  │                                                                        │ │
│  │  ┌─ playwright ──────────────────────────────────────────────────────┐ │ │
│  │  │  repeatFailureCount   ─── tracks consecutive PW failures          │ │ │
│  │  │  temporaryToolDenylist─── Map<toolName, ttl>, drained each turn   │ │ │
│  │  │  notifiedRecoveryKey  ─── dedup: don't re-notify same recovery    │ │ │
│  │  └───────────────────────────────────────────────────────────────────┘ │ │
│  │                                                                        │ │
│  │  groundingRetries, noInputRetries, toolCallRetries                    │ │
│  │  consecutiveToolFailures, consecutiveTransientRetries                 │ │
│  │  memoryFlushedThisCycle, lastProactiveCompactionMessageRevision       │ │
│  │  continuationCount                                                    │ │
│  │                                                                        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌─── ToolProfileState (tool-profiles.ts) ───────────────────────────────┐ │
│  │                                                                        │ │
│  │  layers: {                                                             │ │
│  │    baseline  ─── set at session start, widened on hybrid promotion     │ │
│  │    domain    ─── set once per request (browser_safe | cleared)        │ │
│  │    plan      ─── set when plan approved, cleared when done            │ │
│  │    discovery ─── set by tool_search results                           │ │
│  │    runtime   ─── rewritten every turn by applyAdaptiveToolPhase      │ │
│  │  }                                                                     │ │
│  │  _generation ─── bumped on every layer mutation, drives cache         │ │
│  │                                                                        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌─── ContextManager (context.ts) ───────────────────────────────────────┐ │
│  │                                                                        │ │
│  │  messages[]    ─── grows with user/assistant/tool msgs each turn      │ │
│  │  totalChars    ─── O(1) token estimation cache                        │ │
│  │  pendingCompaction ── armed at 80% capacity, consumed by compaction   │ │
│  │                                                                        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
└─────────────────────────────────────────────────────────────────────────────┘


  WHO READS WHAT:

  engine-sdk.ts ────reads────▶ toolProfileState (via cached resolver)
                               → builds tool schemas for LLM

  orchestrator.ts ──reads────▶ toolProfileState (via cached resolver)
                               → effectiveAllowlist / effectiveDenylist

  orch-response.ts ─reads────▶ LoopState.playwright
                               → recovery decisions, temp denylist

  orch-state.ts ────reads────▶ toolProfileState
                               → effectiveAllowlist/denylist helpers

  orch-tool-exec.ts reads────▶ policy, toolProfileState, hookRuntime
                               → validate + permit + dispatch

  grounding.ts ─────reads────▶ LoopState.toolUses
                               → verify final response cites tool data
```


## File Dependency Graph

```
  agent-runner.ts
    ├── session.ts
    │     ├── engine-sdk.ts
    │     │     └── tool-profiles.ts ◄──── SSOT for tool visibility
    │     ├── context.ts
    │     └── tool-profiles.ts
    │
    ├── orchestrator.ts ◄──────────────── THE MAIN LOOP
    │     ├── orchestrator-state.ts
    │     ├── orchestrator-llm.ts
    │     │     └── engine-sdk.ts
    │     ├── orchestrator-response.ts
    │     │     ├── orchestrator-tool-execution.ts
    │     │     │     ├── registry.ts (tool lookup)
    │     │     │     └── security/safety.ts
    │     │     ├── playwright/recovery-policy.ts
    │     │     ├── playwright/failure-enrichment.ts
    │     │     ├── grounding.ts
    │     │     └── planning.ts
    │     └── tool-profiles.ts
    │
    └── memory/*.ts (recall, write, search)
```
