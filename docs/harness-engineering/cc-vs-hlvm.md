# Harness Engineering: Claude Code vs HLVM Binary

Comparison of two agent runtimes on 5 harness engineering layers:
knowledge, reach, workflows, safety, and endurance.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│          HARNESS ENGINEERING: CC vs HLVM Binary                              │
│          Both evaluated as agent runtime products                            │
└──────────────────────────────────────────────────────────────────────────────┘


LAYER 1: KNOWLEDGE (auto-loaded context before agent works)
═══════════════════════════════════════════════════════════════

  Claude Code:                         HLVM Binary:
  ┌────────────────────────┐           ┌─────────────────────────────────────┐
  │ CLAUDE.md auto-read     │           │ HLVM.md auto-read                   │
  │ MEMORY.md system        │           │   ~/.hlvm/HLVM.md (global)          │
  │ .claude/ project dir    │           │   .hlvm/HLVM.md (project, trusted)  │
  │ git context             │           │ MEMORY.md + SQLite facts DB         │
  │                         │           │   temporal decay, entity linking,   │
  │                         │           │   FTS5 search, auto-inject          │
  │                         │           │ trust registry for workspaces       │
  │                         │           │   ~/.hlvm/trusted-workspaces.json   │
  │                         │           │ dynamic prompt sections             │
  │                         │           │   model-tier-aware assembly         │
  │                         │           │   (constrained/standard/enhanced/   │
  │                         │           │    frontier tiers get different     │
  │                         │           │    prompt content)                  │
  │                         │           │ memory tools (write/search/edit)    │
  │                         │           │   agent can learn and recall facts  │
  │                         │           │   during conversation               │
  └─────────────────────────┘           └─────────────────────────────────────┘

  CC:   ##########              HLVM:  ##########
        equivalent — HLVM actually has MORE (SQLite facts, trust gating,
        tier-aware prompt assembly)

  Key files:
    prompt/instructions.ts    — InstructionHierarchy, loadInstructionHierarchy()
    prompt/sections.ts        — collectSections(), model-tier-aware assembly
    memory/manager.ts         — loadMemoryContext(), buildMemorySystemMessage()
    memory/tools.ts           — memory_write, memory_search, memory_edit
    memory/facts.ts           — SQLite-backed fact store with FTS5
    memory/retrieve.ts        — hybrid retrieval (FTS5 + entity graph)
    memory/db.ts              — SQLite schema: facts, entities, relationships


LAYER 2: REACH (external tool access)
══════════════════════════════════════════

  Claude Code:                         HLVM Binary:
  ┌────────────────────────┐           ┌─────────────────────────────────────┐
  │ MCP server config       │           │ MCP server config                   │
  │   (.mcp.json)           │           │   ~/.hlvm/mcp.json (user scope)    │
  │ Any MCP pluggable       │           │   + CC scope auto-import           │
  │ WebSearch/WebFetch      │           │ SDK MCP client + OAuth              │
  │ Bash/Read/Write/        │           │   @modelcontextprotocol/sdk        │
  │   Edit/Glob/Grep        │           │ tool_search (on-demand discovery)  │
  │                         │           │ 12 tool categories:                │
  │                         │           │   FILE_TOOLS     — read/write/glob │
  │                         │           │   CODE_TOOLS     — symbol search   │
  │                         │           │   SHELL_TOOLS    — exec commands   │
  │                         │           │   WEB_TOOLS      — fetch/search    │
  │                         │           │   GIT_TOOLS      — version control │
  │                         │           │   MEMORY_TOOLS   — fact store      │
  │                         │           │   DELEGATE_TOOLS — child agents    │
  │                         │           │   AGENT_TEAM_TOOLS — multi-agent   │
  │                         │           │   DATA_TOOLS     — structured data │
  │                         │           │   ACTIVITY_TOOLS — observability   │
  │                         │           │   COMPUTER_USE_TOOLS — macOS ctrl  │
  │                         │           │   PLAYWRIGHT_TOOLS — browser auto  │
  │                         │           │ auto safety-level inference         │
  │                         │           │   for MCP tools (L0/L1/L2)        │
  └─────────────────────────┘           └─────────────────────────────────────┘

  CC:   ##########              HLVM:  ##########
        equivalent — both have MCP. HLVM adds safety inference on
        discovered tools + native ComputerUse/Playwright

  Key files:
    agent/mcp/config.ts       — loadMcpConfigMultiScope(), deduplication
    agent/mcp/tools.ts        — registerMcpTools(), inferMcpSafetyLevel()
    agent/mcp/sdk-client.ts   — createSdkMcpClient(), OAuth flow
    agent/registry.ts         — tool registry, computeTierToolFilter()
    agent/computer-use/       — native macOS keyboard/mouse/screen


LAYER 3: REUSABLE WORKFLOWS / SKILLS
══════════════════════════════════════════

  Claude Code:                         HLVM Binary:
  ┌────────────────────────┐           ┌─────────────────────────────────────┐
  │ Skills system            │           │ Agent Profiles                      │
  │ Plugin marketplace       │           │   general, code, file, shell,      │
  │ Custom skill authoring   │           │   web, synthesis, research,        │
  │ Slash commands           │           │   implementation, review           │
  │   (/commit, /test, etc)  │           │   each has: tools, model override, │
  │                          │           │   temperature, custom instructions │
  │                          │           │ Planning system                     │
  │                          │           │   off / auto / always modes        │
  │                          │           │   shouldPlanRequest() auto-detect  │
  │                          │           │   structured JSON plans            │
  │                          │           │   step tracking + completion       │
  │                          │           │   PLAN_START/PLAN_END markers      │
  │                          │           │ Delegation system                   │
  │                          │           │   delegate_agent (single child)    │
  │                          │           │   batch_delegate (fan-out/batch)   │
  │                          │           │   isolated workspaces per child    │
  │                          │           │   context budgets per delegate     │
  │                          │           │ Agent Teams                         │
  │                          │           │   TaskCreate/List/Get/Update       │
  │                          │           │   SendMessage (DM + broadcast)     │
  │                          │           │   task dependencies (blockedBy)    │
  │                          │           │   file-based persistence           │
  │                          │           │   ~/.hlvm/teams/{name}/config.json │
  └──────────────────────────┘           └─────────────────────────────────────┘

  CC:   ########--              HLVM:  ########--
        different shape — CC has user-authored skills (text recipes)
        HLVM has runtime orchestration (delegation, teams, plans)
        CC: "here's HOW to do X"    HLVM: "I'll COORDINATE doing X"

  Key files:
    agent/planning.ts         — PlanningMode, requestPlan(), shouldPlanRequest()
    agent/agent-registry.ts   — AgentProfile definitions (9 built-in profiles)
    agent/delegation.ts       — delegate_agent, batch_delegate execution
    agent/team-runtime.ts     — createTeamRuntime(), TeamMessageKind
    agent/team-store.ts       — TeamStore, TaskIdCounter, file persistence
    agent/tools/agent-team-tools.ts — spawnAgent, task CRUD, messaging


LAYER 4: SAFETY (guardrails agent can't bypass)
═════════════════════════════════════════════════════

  Claude Code:                         HLVM Binary:
  ┌────────────────────────┐           ┌─────────────────────────────────────┐
  │ Hooks system             │           │ Hooks system (11 hook points)       │
  │   PreToolUse             │           │   pre_llm        — before LLM call │
  │   PostToolUse            │           │   post_llm       — after LLM call  │
  │   Notification           │           │   pre_tool       — before tool exec│
  │   Stop                   │           │   post_tool      — after tool exec │
  │                          │           │   plan_created   — plan generated  │
  │                          │           │   write_verified — file written    │
  │                          │           │   delegate_start — child spawned   │
  │                          │           │   delegate_end   — child returned  │
  │                          │           │   final_response — before reply    │
  │                          │           │   teammate_idle  — team member idle│
  │                          │           │   task_completed — team task done  │
  │                          │           │   config: settings.json (unified)  │
  │                          │           │   exit code 2 = BLOCK action       │
  │                          │           │   stdout = feedback to agent       │
  │ Permission modes         │           │ Policy engine (settings.json)       │
  │   (accept, plan, etc)    │           │   per-tool rules: allow/deny/ask   │
  │ Tool allowlists          │           │   per-safety-level rules           │
  │                          │           │   path glob rules (filesystem)     │
  │                          │           │   network URL rules (HTTP)         │
  │                          │           │ Permission tiers (L0/L1/L2)        │
  │                          │           │   L0: auto-approve (read-only)     │
  │                          │           │   L1: confirm once (low-risk)      │
  │                          │           │   L2: always confirm (destructive) │
  │                          │           │ 5 permission modes                  │
  │                          │           │   default, acceptEdits, plan,      │
  │                          │           │   bypassPermissions, dontAsk       │
  │                          │           │ Tool profiles (layered slots)       │
  │                          │           │   baseline -> domain -> plan ->    │
  │                          │           │   discovery -> runtime             │
  │                          │           │   first non-empty slot wins        │
  │                          │           │ File sandbox (path validation)     │
  │                          │           │   isPathWithinRoot() enforcement   │
  │                          │           │ Child denylist propagation          │
  │                          │           │   delegates can't re-delegate      │
  └──────────────────────────┘           └─────────────────────────────────────┘

  CC:   ########--              HLVM:  ##########
        HLVM wins — 11 hook points vs 4, full policy engine,
        layered tool profiles, path/network rules, child isolation

  Key files:
    agent/hooks.ts            — dispatchWithFeedback(), dispatchDetached()
    agent/policy.ts           — AgentPolicy, loadAgentPolicy()
    agent/security/safety.ts  — SafetyLevel (L0/L1/L2), confirmation tracking
    agent/tool-profiles.ts    — DeclaredToolProfile, layered slot resolution
    providers/approval.ts     — InteractionRequestEvent, approval UX


LAYER 5: ENDURANCE (survive beyond 1 session)
═══════════════════════════════════════════════════

  Claude Code:                         HLVM Binary:
  ┌────────────────────────┐           ┌─────────────────────────────────────┐
  │ claude -p (headless)     │           │ hlvm ask -p (headless/batch)        │
  │ --max-turns              │           │ hlvm serve (HTTP daemon mode)       │
  │ --dangerously-skip       │           │   localhost:3333, SSE/NDJSON       │
  │ /schedule (cron)         │           │   stays alive across requests      │
  │ context compression      │           │ --permission-mode bypass            │
  │ ralph loop possible      │           │ context compression                 │
  │                          │           │   sliding window auto-trim         │
  │                          │           │   tool result compaction           │
  │                          │           │   orphan prevention (roundId)      │
  │                          │           │   summary injection for trimmed    │
  │                          │           │ session persistence (SQLite)        │
  │                          │           │   metadata store, session resume   │
  │                          │           │   deriveDefaultSessionKey()        │
  │                          │           │ batch delegation (20 parallel)      │
  │                          │           │   DelegateBatch with progress      │
  │                          │           │   transcript snapshots             │
  │                          │           │ bootstrap auto-recovery             │
  │                          │           │   verifyBootstrap(), recover...()  │
  │                          │           │ 25-iteration plan execution loop    │
  │                          │           │   DEFAULT_MAX_ITERATIONS = 25      │
  │                          │           │ (no built-in cron/schedule)         │
  │                          │           │ (no ralph loop script — yet)        │
  └──────────────────────────┘           └─────────────────────────────────────┘

  CC:   ########--              HLVM:  ########--
        different shape — CC has cron + ralph loop ecosystem
        HLVM has daemon mode + batch delegation + session resume
        CC: "restart me externally"   HLVM: "I stay running as a server"

  Key files:
    agent/agent-runner.ts     — core ReAct loop, session setup
    agent/context.ts          — message history, compaction, sliding window
    agent/context-resolver.ts — resolveContextBudget(), token allocation
    agent/delegate-batches.ts — DelegateBatch, batch progress tracking
    cli/commands/ask.ts       — CLI agent mode (interactive/batch/permission)
    cli/commands/serve.ts     — HTTP daemon, SSE/NDJSON, bootstrap readiness
    store/session-metadata.ts — session persistence, resume key derivation


═══════════════════════════════════════════════════════════════════════════════

CORRECTED SCORECARD:

                        CC            HLVM Binary
  Knowledge (L1)      ##########      ##########   EVEN (both auto-load)
  Reach (L2)          ##########      ##########   EVEN (both have MCP)
  Workflows (L3)      ########--      ########--   DIFFERENT (skills vs orchestration)
  Safety (L4)         ########--      ##########   HLVM WINS (11 hooks, policy engine)
  Endurance (L5)      ########--      ########--   DIFFERENT (cron vs daemon)
  ───────────────────────────────────────────────
  Team orchestration  ####------      ##########   HLVM WINS
  Computer Use        ----------      ##########   HLVM WINS
  Plugin ecosystem    ##########      ####------   CC WINS (marketplace)
  Community adoption  ##########      ----------   CC WINS


ARCHITECTURAL DIFFERENCE:

  CC model:                    HLVM model:
  ┌────────────────┐           ┌────────────────────────────┐
  │   text skills   │           │   runtime orchestration    │
  │   |             │           │   |                        │
  │   one agent     │           │   N agents (teams)         │
  │   |             │           │   |                        │
  │   file tools    │           │   file + screen + browser  │
  │   |             │           │   |                        │
  │   kill+restart  │           │   daemon (stays alive)     │
  └────────────────┘           └────────────────────────────┘

  CC is a configurable single-agent with great plugin ecosystem.
  HLVM is a multi-agent runtime with deeper safety and orchestration.

  They solve DIFFERENT problems:
    CC   = "how to configure an agent well"
    HLVM = "how to run agents that coordinate and act on your Mac"
```

## Config Note

As of config version 2, HLVM unifies `config.json`, `agent-policy.json`,
and `hooks.json` into a single `~/.hlvm/settings.json`. The diagram above
references legacy filenames; the runtime reads `settings.json` first with
transparent fallback to old files.

## Key Takeaway

CC and HLVM are **complementary, not competing**. CC excels at wrapping a
single agent with community-sourced context and guardrails. HLVM excels at
running multiple coordinated agents with native macOS control, structured
planning, and deep safety policy.

The real gaps in HLVM are plugin marketplace and community ecosystem — not
core harness infrastructure. On raw runtime capabilities (hooks, policy,
teams, computer use, daemon mode), HLVM is ahead.
