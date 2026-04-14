# HLVM Harness Engineering — Full System Map

> **HISTORICAL DOCUMENT** — written during initial implementation.
> CC "parity" claims in this document are outdated and overstated.
> See [reference.md](./reference.md) for the current authoritative reference.
> HLVM has CC-inspired primitives, not CC interface compatibility.

Pipeline diagrams from the initial implementation sprint.

---

## 1. FULL PIPELINE: BEFORE (what was broken)

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                     HLVM AGENT PIPELINE — BEFORE                           ║
╚══════════════════════════════════════════════════════════════════════════════╝

  USER INPUT
  ══════════
  ┌──────────────────────────────────────────────┐
  │ REPL (App.tsx)                               │
  │                                              │
  │  "fix the login bug"  → send-agent path      │
  │  "/commit"            → "Unknown command" ❌  │
  │  "/test"              → "Unknown command" ❌  │
  │  "/review"            → "Unknown command" ❌  │
  │                                              │
  │  Only static commands work:                  │
  │    /help, /flush, /exit, /config, /model,    │
  │    /doctor, /tasks                           │
  └────────────────┬─────────────────────────────┘
                   │ agent query
                   ▼
  KNOWLEDGE LOADING (agent-runner.ts)
  ═══════════════════════════════════
  ┌──────────────────────────────────────────────┐
  │                                              │
  │  loadInstructionHierarchy(workspace)         │
  │  ┌────────────────────────────────────────┐  │
  │  │ ~/.hlvm/HLVM.md    (global, always)   │  │
  │  │   → flat text, NO @include ❌          │  │
  │  │   → NO rules/ directory ❌             │  │
  │  │   → 2000 char limit                   │  │
  │  │                                        │  │
  │  │ .hlvm/HLVM.md      (project, trusted) │  │
  │  │   → flat text, NO @include ❌          │  │
  │  └────────────────────────────────────────┘  │
  │                                              │
  │  loadAgentProfiles(workspace)                │
  │  ┌────────────────────────────────────────┐  │
  │  │ built-in: general, code, file,        │  │
  │  │           shell, web, memory           │  │
  │  │ .hlvm/agents/*.md  NO TRUST GATE ⚠️    │  │
  │  │   → any workspace can inject agents   │  │
  │  └────────────────────────────────────────┘  │
  │                                              │
  │  (NO skill loading) ❌                        │
  │                                              │
  └────────────────┬─────────────────────────────┘
                   │
                   ▼
  PROMPT COMPILATION (session.ts → sections.ts)
  ═════════════════════════════════════════════
  ┌──────────────────────────────────────────────┐
  │ compileSystemPrompt() → collectSections()    │
  │                                              │
  │  Sections rendered:                          │
  │  ┌──────────────────────────────────────┐    │
  │  │ 1. role           (agent identity)   │    │
  │  │ 2. critical_rules (guardrails)       │    │
  │  │ 3. instructions   (tier rules)       │    │
  │  │ 4. routing        (tool table)       │    │
  │  │ 5. web_guidance                      │    │
  │  │ 6. computer_use                      │    │
  │  │ 7. browser_auto                      │    │
  │  │ 8. permissions    (L0/L1/L2)         │    │
  │  │ 9. environment    (OS, HOME)         │    │
  │  │ 10. custom        (HLVM.md content)  │    │
  │  │ 11. (NO SKILLS SECTION) ❌            │    │
  │  │ 12. examples                         │    │
  │  │ 13. tips                             │    │
  │  │ 14. footer                           │    │
  │  └──────────────────────────────────────┘    │
  │                                              │
  │  Model has NO idea skills exist.             │
  │  Model cannot invoke /commit, /test, etc.    │
  └────────────────┬─────────────────────────────┘
                   │
                   ▼
  REACT LOOP (orchestrator.ts)
  ════════════════════════════
  ┌──────────────────────────────────────────────┐
  │ while (iterations < 20) {  ← hardcoded       │
  │   // NO --max-turns override ❌               │
  │   // NO --max-budget check ❌                 │
  │                                              │
  │   LLM call → response → tool calls          │
  │                                              │
  │   TOOL EXECUTION                             │
  │   ┌────────────────────────────────────────┐ │
  │   │ Available tools:                       │ │
  │   │   FILE: read_file, write_file, edit... │ │
  │   │   CODE: search_code, find_symbol...    │ │
  │   │   SHELL: shell_exec, shell_script      │ │
  │   │   WEB: search_web, fetch_url...        │ │
  │   │   GIT: git_status, git_diff, git_log   │ │
  │   │   MEMORY: memory_write/search/edit     │ │
  │   │   META: tool_search, ask_user          │ │
  │   │   CU: cu_keyboard, cu_mouse...         │ │
  │   │   PW: pw_click, pw_fill...             │ │
  │   │   (NO skill tool) ❌                    │ │
  │   └────────────────────────────────────────┘ │
  │                                              │
  │   HOOK DISPATCH                              │
  │   ┌────────────────────────────────────────┐ │
  │   │ .hlvm/hooks.json                       │ │
  │   │                                        │ │
  │   │ Events (7):                            │ │
  │   │   pre_llm, post_llm                    │ │
  │   │   pre_tool, post_tool                  │ │
  │   │   plan_created, write_verified         │ │
  │   │   final_response                       │ │
  │   │                                        │ │
  │   │ Handler types:                         │ │
  │   │   command ONLY (shell exec) ❌          │ │
  │   │   NO prompt hooks ❌                    │ │
  │   │   NO http hooks ❌                      │ │
  │   │                                        │ │
  │   │ exit 0 → ok                            │ │
  │   │ exit 2 → blocked (stdout = feedback)   │ │
  │   └────────────────────────────────────────┘ │
  │ }                                            │
  └────────────────┬─────────────────────────────┘
                   │
                   ▼
  RESPONSE → USER
```

---

## 2. FULL PIPELINE: AFTER (what works now)

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                     HLVM AGENT PIPELINE — AFTER                            ║
╚══════════════════════════════════════════════════════════════════════════════╝

  USER INPUT
  ══════════
  ┌──────────────────────────────────────────────────────────────────────┐
  │ REPL (App.tsx)                                                      │
  │                                                                     │
  │  "fix the login bug"  → send-agent path (unchanged)                 │
  │                                                                     │
  │  "/commit fix login"  → SKILL DISPATCH ✅                            │
  │       │                                                             │
  │       ▼                                                             │
  │  commands.ts: static lookup → miss                                  │
  │       │                                                             │
  │       ▼                                                             │
  │  loadSkillCatalog() → finds "commit" (bundled, inline)              │
  │       │                                                             │
  │       ▼                                                             │
  │  executeInlineSkill("commit", "fix login")                          │
  │       │                                                             │
  │       ▼                                                             │
  │  returns RunCommandResult { skillActivation: { systemMessage } }    │
  │       │                                                             │
  │       ▼                                                             │
  │  handleCommand() → "\x00SKILL\x00# Skill: commit\n..."             │
  │       │                                                             │
  │       ▼                                                             │
  │  App.tsx detects marker → addUserMessage(skillInstructions)         │
  │       │                                                             │
  │       ▼                                                             │
  │  Agent receives skill workflow as query ✅                           │
  │                                                                     │
  │  Completion provider also shows skills:                             │
  │    /com[mit]  — Review changes and create a git commit              │
  │    /tes[t]    — Find and run project tests                          │
  │    /rev[iew]  — Review code changes (runs in background)            │
  └────────────────┬────────────────────────────────────────────────────┘
                   │ agent query (natural language OR skill activation)
                   ▼
  KNOWLEDGE LOADING (agent-runner.ts)
  ═══════════════════════════════════
  ┌──────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  loadInstructionHierarchy(workspace)                                │
  │  ┌──────────────────────────────────────────────────────────────┐   │
  │  │ ~/.hlvm/HLVM.md (global, always)                            │   │
  │  │   │                                                         │   │
  │  │   ▼ resolveIncludes()                                       │   │
  │  │   @./rules/naming.md → [inlined content] ✅                  │   │
  │  │   @./rules/testing.md → [inlined content] ✅                 │   │
  │  │   Max depth: 3, max 4000 chars/include, circular detection  │   │
  │  │                                                             │   │
  │  │ .hlvm/HLVM.md (project, trust-gated)                        │   │
  │  │   ▼ resolveIncludes() (same rules)                          │   │
  │  │                                                             │   │
  │  │ ~/.hlvm/rules/*.md (global rules, always) ✅ NEW             │   │
  │  │   → sorted alphabetically, concatenated                     │   │
  │  │                                                             │   │
  │  │ .hlvm/rules/*.md (project rules, trust-gated) ✅ NEW         │   │
  │  │   → sorted alphabetically, concatenated                     │   │
  │  │                                                             │   │
  │  │ Budget: 8000 chars (was 2000)                               │   │
  │  │ Merge: project → rules → global (global wins on overflow)   │   │
  │  └──────────────────────────────────────────────────────────────┘   │
  │                                                                     │
  │  loadAgentProfiles(workspace, { trusted: instructions.trusted })    │
  │  ┌──────────────────────────────────────────────────────────────┐   │
  │  │ built-in: general, code, file, shell, web, memory           │   │
  │  │ .hlvm/agents/*.md → NOW TRUST-GATED ✅                       │   │
  │  │   untrusted workspace → built-in only (safe)                │   │
  │  └──────────────────────────────────────────────────────────────┘   │
  │                                                                     │
  │  loadSkillCatalog(workspace) ✅ NEW — loaded EAGERLY at session start│
  │  ┌──────────────────────────────────────────────────────────────┐   │
  │  │ Discovery order (later overrides by name):                  │   │
  │  │                                                             │   │
  │  │ 1. BUNDLED (lowest priority)                                │   │
  │  │    /commit  — inline, git workflow                          │   │
  │  │    /test    — inline, test runner                           │   │
  │  │    /review  — fork, code review in child agent              │   │
  │  │                                                             │   │
  │  │ 2. USER (~/.hlvm/skills/*.md)                               │   │
  │  │    User-authored skills, always loaded                      │   │
  │  │    Can shadow bundled skills by name                        │   │
  │  │                                                             │   │
  │  │ 3. PROJECT (.hlvm/skills/*.md, TRUST-GATED)                 │   │
  │  │    Project-specific skills, highest priority                │   │
  │  │    Can shadow user + bundled by name                        │   │
  │  │    Blocked in untrusted workspaces                          │   │
  │  │                                                             │   │
  │  │ Skill file format:                                          │   │
  │  │   ---                                                       │   │
  │  │   description: "What this does"                             │   │
  │  │   when_to_use: "When to trigger"                            │   │
  │  │   allowed_tools: [shell_exec, read_file]                    │   │
  │  │   context: inline|fork                                      │   │
  │  │   user_invocable: true                                      │   │
  │  │   ---                                                       │   │
  │  │   Skill body (markdown instructions)                        │   │
  │  │   ${ARGS} placeholder for arguments                         │   │
  │  │                                                             │   │
  │  │ Session-cached (loaded once, reused across turns)           │   │
  │  └──────────────────────────────────────────────────────────────┘   │
  │                                                                     │
  └────────────────┬────────────────────────────────────────────────────┘
                   │ instructions + agentProfiles + skills
                   ▼
  PROMPT COMPILATION (session.ts → llm-integration.ts → sections.ts)
  ══════════════════════════════════════════════════════════════════
  ┌──────────────────────────────────────────────────────────────────────┐
  │ createAgentSession({ ..., skills })                                 │
  │   → compileSystemPrompt({ ..., skills })                            │
  │     → compilePrompt({ ..., skills })                                │
  │       → collectSections(input)                                      │
  │                                                                     │
  │  Sections rendered:                                                 │
  │  ┌──────────────────────────────────────────────────────────────┐   │
  │  │  1. role             (agent identity)                       │   │
  │  │  2. critical_rules   (guardrails)                           │   │
  │  │  3. instructions     (tier rules)                           │   │
  │  │  4. routing          (tool table — now includes skill tool) │   │
  │  │  5. web_guidance                                            │   │
  │  │  6. computer_use                                            │   │
  │  │  7. browser_auto                                            │   │
  │  │  8. permissions      (L0/L1/L2)                             │   │
  │  │  9. environment      (OS, HOME)                             │   │
  │  │ 10. custom           (HLVM.md + @includes + rules)          │   │
  │  │ 11. SKILLS CATALOG ✅ NEW                                    │   │
  │  │     ┌─────────────────────────────────────────────────┐     │   │
  │  │     │ # Skills                                        │     │   │
  │  │     │ Invoke via `skill` tool or slash command.       │     │   │
  │  │     │                                                 │     │   │
  │  │     │ - /commit: Review changes and create commit     │     │   │
  │  │     │ - /test: Find and run project tests             │     │   │
  │  │     │ - /review: Review code changes (background)     │     │   │
  │  │     │ - (any user/project skills also listed)         │     │   │
  │  │     └─────────────────────────────────────────────────┘     │   │
  │  │ 12. examples                                                │   │
  │  │ 13. tips                                                    │   │
  │  │ 14. footer                                                  │   │
  │  └──────────────────────────────────────────────────────────────┘   │
  │                                                                     │
  │  Model SEES skills in its prompt.                                   │
  │  Model CAN invoke them via skill tool.                              │
  └────────────────┬────────────────────────────────────────────────────┘
                   │
                   ▼
  REACT LOOP (orchestrator.ts)
  ════════════════════════════
  ┌──────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │ ┌─ SAFETY BOUNDS ─────────────────────────────────────────────────┐ │
  │ │ maxIterations: --max-turns N  (default: 20) ✅ NEW              │ │
  │ │ maxBudgetUsd: --max-budget N  (checked per iteration) ✅ NEW    │ │
  │ │ loopDeadline: timeout         (existing)                        │ │
  │ └─────────────────────────────────────────────────────────────────┘ │
  │                                                                     │
  │ while (iterations < maxIterations) {                                │
  │                                                                     │
  │   // Budget check (NEW)                                             │
  │   if (maxBudgetUsd) {                                               │
  │     snap = usageTracker.snapshot(modelId)                           │
  │     if (snap.totalCostUsd > maxBudgetUsd) → STOP                   │
  │   }                                                                 │
  │                                                                     │
  │   LLM call → response → tool calls                                 │
  │                                                                     │
  │   TOOL EXECUTION                                                    │
  │   ┌────────────────────────────────────────────────────────────┐    │
  │   │ Available tools (same as before PLUS):                     │    │
  │   │                                                            │    │
  │   │   META: tool_search, ask_user, skill ✅ NEW                 │    │
  │   │                                                            │    │
  │   │   skill tool invocation:                                   │    │
  │   │   ┌──────────────────────────────────────────────────┐     │    │
  │   │   │ model calls: skill({ skill: "commit", args: ""})│     │    │
  │   │   │      │                                           │     │    │
  │   │   │      ▼                                           │     │    │
  │   │   │ loadSkillCatalog() → find skill by name          │     │    │
  │   │   │      │                                           │     │    │
  │   │   │      ├── inline?                                 │     │    │
  │   │   │      │   executeInlineSkill()                    │     │    │
  │   │   │      │   → { systemMessage, allowedTools }       │     │    │
  │   │   │      │   → model follows instructions            │     │    │
  │   │   │      │                                           │     │    │
  │   │   │      └── fork?                                   │     │    │
  │   │   │          → spawns child agent with skill content │     │    │
  │   │   └──────────────────────────────────────────────────┘     │    │
  │   └────────────────────────────────────────────────────────────┘    │
  │                                                                     │
  │   HOOK DISPATCH (routeHandlerWithResult)                            │
  │   ┌────────────────────────────────────────────────────────────┐    │
  │   │ .hlvm/hooks.json                                           │    │
  │   │                                                            │    │
  │   │ Events (11 — was 7):                                       │    │
  │   │   pre_llm, post_llm                                        │    │
  │   │   pre_tool, post_tool                                      │    │
  │   │   plan_created, write_verified                              │    │
  │   │   final_response                                            │    │
  │   │   session_start     ✅ NEW                                   │    │
  │   │   session_end       ✅ NEW                                   │    │
  │   │   pre_compact       ✅ NEW                                   │    │
  │   │   user_prompt_submit✅ NEW                                   │    │
  │   │                                                            │    │
  │   │ Handler types (3 — was 1):                                 │    │
  │   │                                                            │    │
  │   │   ┌─ COMMAND (existing, backward-compatible) ────────┐     │    │
  │   │   │ { "command": ["lint.sh"], "timeoutMs": 5000 }    │     │    │
  │   │   │ → spawn process → stdin: JSON envelope           │     │    │
  │   │   │ → exit 0: ok, exit 2: blocked                    │     │    │
  │   │   └──────────────────────────────────────────────────┘     │    │
  │   │                                                            │    │
  │   │   ┌─ PROMPT ✅ NEW ──────────────────────────────────┐     │    │
  │   │   │ { "type": "prompt",                              │     │    │
  │   │   │   "prompt": "Is this safe? ${PAYLOAD}",          │     │    │
  │   │   │   "model": "gemma4" }                            │     │    │
  │   │   │ → local LLM (via collectChat)                    │     │    │
  │   │   │ → parse { "decision": "block"|"allow" }          │     │    │
  │   │   │ → fail-open on error                             │     │    │
  │   │   └──────────────────────────────────────────────────┘     │    │
  │   │                                                            │    │
  │   │   ┌─ HTTP ✅ NEW ────────────────────────────────────┐     │    │
  │   │   │ { "type": "http",                                │     │    │
  │   │   │   "url": "https://hooks.co/check",               │     │    │
  │   │   │   "headers": { "Authorization": "Bearer x" } }   │     │    │
  │   │   │ → POST JSON payload to webhook                   │     │    │
  │   │   │ → parse { "decision": "block"|"allow" }          │     │    │
  │   │   │ → fail-open on error/timeout                     │     │    │
  │   │   └──────────────────────────────────────────────────┘     │    │
  │   │                                                            │    │
  │   │ All three share:                                           │    │
  │   │   - parseDecisionResponse() (DRY)                          │    │
  │   │   - HookFeedback { blocked, feedback }                     │    │
  │   │   - fail-open safety default                               │    │
  │   └────────────────────────────────────────────────────────────┘    │
  │ }                                                                   │
  └────────────────┬────────────────────────────────────────────────────┘
                   │
                   ▼
  RESPONSE → USER
```

---

## 3. DATA FLOW: Trust Gating (security model)

```
  Workspace: ~/dev/my-project

  isWorkspaceTrusted("~/dev/my-project")
       │
       ▼
  ~/.hlvm/trusted-workspaces.json
  { "workspaces": ["~/dev/my-project", ...] }
       │
       ├── trusted = true ──→ load ALL project-level files:
       │                        .hlvm/HLVM.md (project instructions)
       │                        .hlvm/rules/*.md (project rules)
       │                        .hlvm/agents/*.md (project agent profiles) ✅ FIXED
       │                        .hlvm/skills/*.md (project skills) ✅ NEW
       │
       └── trusted = false ──→ SKIP all project-level files
                                only global + bundled loaded
                                untrusted workspace = built-in only

  BEFORE: .hlvm/agents/ loaded from ANY workspace (security hole)
  AFTER:  ALL .hlvm/ project files gated by same trust check
```

---

## 4. HEADLESS MODE PIPELINE

```
  BEFORE:
  ═══════
  $ hlvm ask -p "refactor the auth module"
       │
       ▼
  parseArgs: -p → dontAsk mode
  query → runAgentQueryViaHost()
       │
       ▼
  orchestrator: while (iterations < 20) { ... }
  │  NO way to limit turns ❌
  │  NO way to limit cost ❌
  │  Runs until 20 iterations or timeout
  └──→ response to stdout


  AFTER:
  ══════
  $ hlvm ask -p "refactor the auth module" --max-turns 10 --max-budget 2.50
       │
       ▼
  parseArgs:
    -p → dontAsk mode
    --max-turns 10 → maxTurns = 10
    --max-budget 2.50 → maxBudget = 2.50
       │
       ▼
  validation:
    maxTurns must be positive integer
    maxBudget must be positive number
       │
       ▼
  runAgentQueryViaHost({ maxIterations: 10, maxBudgetUsd: 2.50 })
       │
       ▼
  WIRE-THROUGH:
    ask.ts → host-client.ts → ChatRequest { max_iterations, max_budget_usd }
    → chat-agent-mode.ts → agent-runner.ts → OrchestratorConfig
    → orchestrator-state.ts → LoopConfig { maxIterations, maxBudgetUsd }
       │
       ▼
  orchestrator: while (iterations < 10) {  ← from --max-turns
    // budget check EVERY iteration
    snap = usageTracker.snapshot(modelId)
    if (snap.totalCostUsd > 2.50) {
      return "Maximum budget ($2.50) exceeded. Task incomplete."
    }
    ...
  }
  └──→ response to stdout (stops at 10 turns OR $2.50)
```

---

## 5. CC vs HLVM: FULL COMPARISON TABLE

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                    CLAUDE CODE vs HLVM — FULL COMPARISON                   ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                            ║
║  LAYER 1: KNOWLEDGE (auto-loaded context)                                  ║
║  ════════════════════════════════════════                                   ║
║                                                                            ║
║  Feature                    CC                HLVM              Status      ║
║  ─────────────────────────────────────────────────────────────────────────  ║
║  Auto-read instructions     CLAUDE.md         HLVM.md           PARITY     ║
║  @include directive         @path             @./path           PARITY ✅   ║
║  Rules directory            .claude/rules/    .hlvm/rules/      PARITY ✅   ║
║  Persistent memory          MEMORY.md         MEMORY.md+SQLite  HLVM WINS  ║
║  Settings merge             6-level cascade   2 files           CC WINS    ║
║  Char budget                40,000            8,000             CC BIGGER  ║
║  Trust gating               .claude/ trusted  .hlvm/ trusted    PARITY ✅   ║
║  Managed settings (/etc/)   YES               NO                CC WINS    ║
║  Project settings           YES               NO (deferred)     CC WINS    ║
║                                                                            ║
║                                                                            ║
║  LAYER 2: REACH (tool access)                                              ║
║  ════════════════════════════                                               ║
║                                                                            ║
║  Feature                    CC                HLVM              Status      ║
║  ─────────────────────────────────────────────────────────────────────────  ║
║  MCP server support         .mcp.json         mcp.json          PARITY     ║
║  MCP OAuth                  YES               YES               PARITY     ║
║  Tool categories            ~15 tools         12 categories     PARITY     ║
║  Plugin marketplace         YES               NO                CC WINS    ║
║  ComputerUse (native)       NO                YES               HLVM WINS  ║
║  Playwright (browser)       NO                YES               HLVM WINS  ║
║  Tool search (deferred)     YES               YES               PARITY     ║
║  Safety-level inference     YES               YES               PARITY     ║
║                                                                            ║
║                                                                            ║
║  LAYER 3: WORKFLOWS (reusable skills)                                      ║
║  ═════════════════════════════════════                                      ║
║                                                                            ║
║  Feature                    CC                HLVM              Status      ║
║  ─────────────────────────────────────────────────────────────────────────  ║
║  Skills system              YES               YES               PARITY ✅   ║
║  Skill file format          YAML frontmatter  YAML frontmatter  PARITY ✅   ║
║  User skills dir            ~/.claude/skills/ ~/.hlvm/skills/   PARITY ✅   ║
║  Project skills (trusted)   .claude/skills/   .hlvm/skills/     PARITY ✅   ║
║  Bundled skills             YES               /commit,test,rev  PARITY ✅   ║
║  Skill tool (model-invoked) YES               YES               PARITY ✅   ║
║  Slash commands (user)      /commit /test     /commit /test     PARITY ✅   ║
║  Inline execution           YES               YES               PARITY ✅   ║
║  Fork execution (subagent)  YES               YES               PARITY ✅   ║
║  Plugin skills              YES               NO                CC WINS    ║
║  MCP skills                 YES               NO                CC WINS    ║
║  Agent profiles             basic             rich (9 built-in) HLVM WINS  ║
║  Planning system            basic             structured JSON   HLVM WINS  ║
║                                                                            ║
║                                                                            ║
║  LAYER 4: SAFETY (guardrails)                                              ║
║  ════════════════════════════                                               ║
║                                                                            ║
║  Feature                    CC                HLVM              Status      ║
║  ─────────────────────────────────────────────────────────────────────────  ║
║  Hook events                25+               15                CC WINS    ║
║  Hook type: command         YES               YES               PARITY     ║
║  Hook type: prompt (LLM)    YES               YES               PARITY ✅   ║
║  Hook type: http (webhook)  YES               YES               PARITY ✅   ║
║  Hook type: agent           YES               NO                CC WINS    ║
║  Hook type: callback        YES (SDK)         NO                CC WINS    ║
║  Permission modes           5                 5                 PARITY     ║
║  Auto-mode classifier       YES               NO                CC WINS    ║
║  Tool profiles (layered)    basic             5-slot cascade    HLVM WINS  ║
║  Policy engine (path/net)   basic             full (glob rules) HLVM WINS  ║
║  Trust gating consistency   YES               YES               PARITY ✅   ║
║  File sandbox               basic             isPathWithinRoot  PARITY     ║
║  Child denylist propagation YES               YES               PARITY     ║
║  Fail-open hooks            YES               YES               PARITY     ║
║                                                                            ║
║                                                                            ║
║  LAYER 5: ENDURANCE (multi-session)                                        ║
║  ══════════════════════════════════                                         ║
║                                                                            ║
║  Feature                    CC                HLVM              Status      ║
║  ─────────────────────────────────────────────────────────────────────────  ║
║  Headless mode              claude -p         hlvm ask -p       PARITY     ║
║  --max-turns                YES               YES               PARITY ✅   ║
║  --max-budget               YES               YES               PARITY ✅   ║
║  --output-format            json/stream       json/stream       PARITY     ║
║  Context compression        YES               YES               PARITY     ║
║  Session persistence        YES               YES (SQLite)      PARITY     ║
║  Cron scheduling            YES (/schedule)   NO                CC WINS    ║
║  Daemon mode (HTTP server)  NO                hlvm serve        HLVM WINS  ║
║  Bootstrap auto-recovery    NO                YES               HLVM WINS  ║
║  Session resume             basic             key derivation    HLVM WINS  ║
║                                                                            ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                            ║
║  SCORECARD (after this work)                                               ║
║  ═══════════════════════════                                                ║
║                                                                            ║
║                          CC            HLVM                                ║
║    Knowledge           ##########    ########--    NEAR-PARITY             ║
║    Reach               ##########    ##########    PARITY (HLVM has CU)    ║
║    Workflows           ########--    ##########    HLVM WINS               ║
║    Safety              ##########    ########--    NEAR-PARITY             ║
║    Endurance           ########--    ##########    HLVM WINS (daemon)      ║
║                                                                            ║
║  CC wins: settings hierarchy, plugin ecosystem, auto-classifier, cron      ║
║  HLVM wins: CU, Playwright, daemon, planning                              ║
║                                                                            ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

## 6. REMAINING GAPS (deferred tracks)

```
  GAP                         CC Has      HLVM Has    Priority    Blocker
  ──────────────────────────────────────────────────────────────────────────
  Settings hierarchy          6-level     2-file      HIGH        Migration complexity
    config.json + policy.json → settings.json
    managed/user/project/local/flag merge
    Touches: storage.ts, /config cmd, session.ts, RuntimeConfigApi

  Auto-mode classifier        YES         NO          MEDIUM      Safety design needed
    LLM-based permission auto-decisions
    HLVM has local-llm.ts classifiers — foundation exists

  Plugin marketplace          YES         NO          LOW         Ecosystem decisions
    Distribution format, versioning, trust model
    Skills v1 provides the file-format foundation

  Cron/scheduling             YES         NO          LOW         Cloud infra needed
    /schedule → remote agents on cron
    HLVM has hlvm serve (daemon) but no cloud dispatch

  Agent hook type             YES         NO          LOW         Add when needed
    Spawn sub-agent as hook handler
    HLVM has prompt hooks which cover most use cases

  Callback/function hooks     YES (SDK)   NO          LOW         SDK-only, internal
    TypeScript function hooks for SDK consumers
    Not user-facing, low priority

  10+ more hook events        YES         NO          LOW         Add incrementally
    PermissionRequest, FileChanged,
    CwdChanged, WorktreeCreate, InstructionsLoaded, etc.
    Add per event as use cases arise
```

---

## 7. FILE INVENTORY

```
  NEW FILES CREATED (10):
  ──────────────────────
  src/common/frontmatter.ts                  45 lines   shared YAML frontmatter
  src/hlvm/skills/types.ts                   31 lines   SkillDefinition types
  src/hlvm/skills/loader.ts                 124 lines   catalog discovery + cache
  src/hlvm/skills/executor.ts                35 lines   inline execution
  src/hlvm/skills/mod.ts                     15 lines   barrel export
  src/hlvm/skills/bundled/index.ts           21 lines   aggregator
  src/hlvm/skills/bundled/commit.ts          44 lines   /commit skill
  src/hlvm/skills/bundled/test.ts            32 lines   /test skill
  src/hlvm/skills/bundled/review.ts          35 lines   /review skill
  docs/harness-engineering/system-map.md              this document

  FILES MODIFIED (17):
  ────────────────────
  src/common/paths.ts                        +24 lines  skill/rules path helpers
  src/hlvm/agent/agent-registry.ts            ~20 lines  extract frontmatter, trust gate
  src/hlvm/agent/agent-runner.ts              ~40 lines  skill load, trust wire, budget
  src/hlvm/agent/hooks.ts                    +221 lines  prompt/http hooks, 4 events, DRY
  src/hlvm/agent/llm-integration.ts           +3 lines  skills passthrough
  src/hlvm/agent/orchestrator.ts             +14 lines  max-budget enforcement
  src/hlvm/agent/orchestrator-state.ts        +2 lines  maxBudgetUsd in LoopConfig
  src/hlvm/agent/session.ts                   +6 lines  skills in session options
  src/hlvm/agent/tools/meta-tools.ts         +46 lines  skill tool
  src/hlvm/cli/commands/ask.ts               +28 lines  --max-turns, --max-budget
  src/hlvm/cli/repl/commands.ts              +63 lines  skill slash dispatch
  src/hlvm/cli/repl-ink/components/App.tsx    +10 lines  skill activation → agent query
  src/hlvm/prompt/instructions.ts           +172 lines  @include, rules loading
  src/hlvm/prompt/sections.ts                +39 lines  skill catalog section
  src/hlvm/prompt/types.ts                   +10 lines  rules fields, skills input
  src/hlvm/runtime/chat-protocol.ts           +2 lines  max_iterations/budget fields
  src/hlvm/runtime/host-client.ts             +8 lines  wire-through
```
