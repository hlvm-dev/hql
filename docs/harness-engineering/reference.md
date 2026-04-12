# HLVM Harness Engineering — Technical Reference

Complete reference for every harness feature: what it does, where it lives,
how to configure it, and how it was verified.

---

## 1. Instruction Composition

### 1.1 HLVM.md — Custom Instructions

Global and project-level instructions loaded automatically on every session.

| Scope | Path | Trust Required |
|-------|------|----------------|
| Global | `~/.hlvm/HLVM.md` | No (always loaded) |
| Project | `<workspace>/.hlvm/HLVM.md` | Yes |

**Merge order** (global wins on overflow):
1. Project block (lowest priority, trimmed first)
2. Rules block (supplementary)
3. Global block (highest priority, never trimmed)

**Budget**: 8000 chars combined (configurable via `MAX_INSTRUCTION_CHARS`).

**Implementation**: `src/hlvm/prompt/instructions.ts`
- `loadInstructionHierarchy(workspace?)` — reads files, resolves includes, loads rules
- `mergeInstructions(hierarchy)` — merges into single string with priority budgeting

### 1.2 @include Directive

Inline other files into HLVM.md using `@./relative/path` syntax.

```markdown
# My Rules
@./rules/naming.md
@./rules/security.md
Always use TypeScript strict mode.
```

**Behavior**:
- Only relative paths (`@./`) allowed — absolute paths ignored (security)
- Max recursion depth: 3
- Max included file size: 4000 chars (truncated silently)
- Circular includes detected via path tracking — directive left as-is
- Missing files produce: `[include not found: ./path]`
- Resolved BEFORE rules loading, so @includes can reference rules/ files

**Security**:
- Path traversal blocked: `@./../../etc/passwd` produces `[include blocked: ... escapes base directory]`
  — resolved path must stay within the instruction file's parent directory
- Symlinks blocked: `[include blocked: ... is a symlink]`
  — prevents symlinks inside allowed dirs from pointing to files outside
- Both checks happen before file read — no data leaks on blocked includes

**Implementation**: `src/hlvm/prompt/instructions.ts`
- `resolveIncludes(text, baseDir, seen?, depth?)` — recursive resolver with path containment + symlink checks

**Verified**: E2E test `harness: @include resolves files into HLVM.md`

### 1.3 Rules Directory

All `.md` files in rules directories are auto-loaded, sorted alphabetically,
and concatenated into the instruction hierarchy.

| Scope | Path | Trust Required |
|-------|------|----------------|
| Global | `~/.hlvm/rules/*.md` | No |
| Project | `<workspace>/.hlvm/rules/*.md` | Yes |

**Behavior**:
- Only `.md` files (other extensions ignored)
- Sorted by filename (use `01-`, `02-` prefixes for ordering)
- Each file trimmed, joined with double newline
- Empty/missing directories silently produce empty string

**Implementation**: `src/hlvm/prompt/instructions.ts`
- `loadRulesDir(dir)` — reads, sorts, concatenates
- Results stored in `InstructionHierarchy.globalRules` / `.projectRules`

**Verified**: E2E test `harness: rules/*.md auto-loaded and sorted`

---

## 2. Skills System

### 2.1 Skill Definition Format

Skills are markdown files with YAML frontmatter.

```markdown
---
description: "What this skill does"          # REQUIRED
when_to_use: "When to trigger this skill"    # optional
allowed_tools: [shell_exec, read_file]       # optional
model: "ollama/gemma4"                       # optional (override model)
user_invocable: true                         # optional (default: true)
context: inline                              # optional: "inline" (default) or "fork"
---

Skill body — instructions the agent follows.
Use ${ARGS} for user-provided arguments.
```

**Type validation**: All frontmatter fields are runtime-validated during loading.
Wrong types fall to safe defaults (no crash, no type leaks):
- `description` must be string (required — skill skipped without it)
- `allowed_tools` must be string array (scalar string silently dropped)
- `context` must be `"inline"` or `"fork"` (other values → undefined → defaults to inline)
- `user_invocable` must be boolean (string `"false"` silently dropped → defaults to true)

**Types**: `src/hlvm/skills/types.ts`
- `SkillDefinition` — resolved skill ready for execution
- `SkillFrontmatter` — parsed YAML metadata
- `SkillContext` — `"inline"` or `"fork"`

### 2.2 Skill Discovery

Skills are loaded from three sources. Later sources override earlier by name.

| Priority | Source | Path | Trust |
|----------|--------|------|-------|
| 1 (lowest) | Bundled | Compiled into binary | N/A |
| 2 | User | `~/.hlvm/skills/*.md` | No |
| 3 (highest) | Project | `<workspace>/.hlvm/skills/*.md` | Yes |

**Bundled skills** (3):

| Name | Context | Description |
|------|---------|-------------|
| `/commit` | inline | Review changes and create a git commit |
| `/test` | inline | Find and run project tests |
| `/review` | fork | Review code changes (runs in background agent) |

**Implementation**: `src/hlvm/skills/loader.ts`
- `loadSkillCatalog(workspace?)` — full discovery with session caching
- `resetSkillCatalogCache()` — clear cache (tests, session reuse)

**Bundled skills**: `src/hlvm/skills/bundled/commit.ts`, `test.ts`, `review.ts`

**Verified**: E2E tests for bundled loading, user loading, project loading,
override, trust gating, malformed skipping

### 2.3 Skill Execution

**Inline mode** (`context: "inline"`):
- Skill body injected as system message into the agent session
- `${ARGS}` placeholder replaced with user arguments
- `allowed_tools` from frontmatter passed as tool allowlist
- Agent follows the instructions in its next turn

**Fork mode** (`context: "fork"`):
- Skill body sent as task to a child agent via `delegate_agent`
- Child runs in isolated workspace
- Result returned to parent agent

**Implementation**: `src/hlvm/skills/executor.ts`
- `executeInlineSkill(skill, args?)` — returns `{ systemMessage, allowedTools }`

**Verified**: E2E test `harness: user skill loaded and invoked with args`

### 2.4 Skill Invocation — Two Paths

**Path 1: User slash command** — user types `/commit fix bug` in REPL

```
User types /commit fix bug
  → commands.ts: static lookup fails
  → loadSkillCatalog() → find "commit"
  → executeInlineSkill(commit, "fix bug")
  → returns RunCommandResult { skillActivation: { systemMessage } }
  → App.tsx detects SKILL marker
  → submits as agent query with skill instructions
  → agent follows the workflow
```

**Path 2: Model tool call** — model calls `skill({skill:"commit", args:"fix bug"})`

```
Model tool call: skill({ skill: "commit" })
  → meta-tools.ts: skill handler
  → loadSkillCatalog() → find "commit"
  → inline: executeInlineSkill() → model follows instructions
  → fork: returns delegate instruction → orchestrator delegates
```

**Implementation**:
- Slash: `src/hlvm/cli/repl/commands.ts` — `runCommand()` skill fallback
- Tool: `src/hlvm/agent/tools/meta-tools.ts` — `skill` tool in `META_TOOLS`
- App wiring: `src/hlvm/cli/repl-ink/components/App.tsx` — SKILL marker protocol

**Verified**: E2E tests `/commit activates inline skill`, `/review activates fork skill`

### 2.5 Skills in System Prompt

When skills are loaded, the model sees them listed in its system prompt:

```
# Skills
Invoke a skill by calling the `skill` tool with its name.

- /commit: Review changes and create a descriptive git commit
  When: When the user wants to commit staged or unstaged changes
- /test: Find and run project tests, report results
- /review: Review code changes (runs in background)
```

**Wiring path**:
```
agent-runner.ts: loadSkillCatalog()
  → session.ts: createAgentSession({ skills })
  → session.ts: buildCompiledPromptArtifacts({ skills })
  → llm-integration.ts: compileSystemPrompt({ skills })
  → sections.ts: collectSections() → renderSkillCatalog()
```

**Implementation**:
- `src/hlvm/prompt/sections.ts` — `renderSkillCatalog()`
- `src/hlvm/prompt/types.ts` — `PromptCompilerInput.skills`
- `src/hlvm/agent/llm-integration.ts` — `SystemPromptOptions.skills`
- `src/hlvm/agent/session.ts` — `AgentSessionOptions.skills`

**Verified**: E2E test `harness: skills section renders in system prompt`

---

## 3. Hook System

### 3.1 Hook Configuration

Hooks are configured in `.hlvm/hooks.json` (project-level).

```json
{
  "version": 1,
  "hooks": {
    "pre_tool": [
      { "command": ["lint.sh", "--fix"] },
      { "type": "prompt", "prompt": "Is ${PAYLOAD} safe?", "model": "gemma4" },
      { "type": "http", "url": "https://hooks.example.com/check" }
    ],
    "session_start": [
      { "command": ["setup-env.sh"] }
    ]
  }
}
```

### 3.2 Hook Events (15)

| Event | When it fires |
|-------|--------------|
| `pre_llm` | Before LLM call |
| `post_llm` | After LLM response |
| `pre_tool` | Before tool execution |
| `post_tool` | After tool execution (has `success` field) |
| `plan_created` | When plan is generated |
| `write_verified` | After file write verification |
| `delegate_start` | Child agent spawned |
| `delegate_end` | Child agent returned |
| `final_response` | Before sending final response |
| `teammate_idle` | Team member goes idle |
| `task_completed` | Task marked complete |
| `session_start` | After session setup (NEW) |
| `session_end` | Before session cleanup (NEW) |
| `pre_compact` | Before context compaction (NEW) |
| `user_prompt_submit` | When user submits input (NEW) |

### 3.3 Hook Handler Types (3)

**Command** (original, backward-compatible):
```json
{ "command": ["lint.sh", "--fix"], "timeoutMs": 5000, "cwd": ".", "env": {} }
```
- Spawns shell process, writes JSON payload to stdin
- Exit 0: ok. Exit 2: blocked (stdout = feedback to model)
- `type` field optional for backward compatibility

**Prompt** (NEW):
```json
{ "type": "prompt", "prompt": "Is this safe? ${PAYLOAD}", "model": "gemma4", "timeoutMs": 3000 }
```
- Sends prompt to local LLM via `collectChat()` from `local-llm.ts`
- `${PAYLOAD}` replaced with JSON payload
- Response parsed as `{ "decision": "block"|"allow", "reason": "..." }`
- Fail-open on error/timeout

**HTTP** (NEW):
```json
{ "type": "http", "url": "https://hooks.co/check", "headers": {"Authorization": "Bearer x"}, "timeoutMs": 5000 }
```
- POST JSON payload to webhook URL
- Response parsed as `{ "decision": "block"|"allow", "reason": "..." }`
- Fail-open on error/timeout

### 3.4 Hook Execution

All handlers for an event run sequentially. If any returns "block", the action
is stopped and the feedback message is shown to the model.

```
Event fires → routeHandlerWithResult()
  ├── command → spawn process → exit code protocol
  ├── prompt  → local LLM    → decision JSON
  └── http    → POST webhook  → decision JSON

All: fail-open on error/timeout (safety default)
```

**Implementation**: `src/hlvm/agent/hooks.ts`
- `AgentHookRuntime` interface: `hasHandlers`, `dispatch`, `dispatchWithFeedback`
- `loadAgentHookRuntime(workspace)` — reads `.hlvm/hooks.json`
- `normalizeHookHandler()` — validates and routes by type
- `routeHandlerWithResult()` — dispatches to correct executor
- `parseDecisionResponse()` — shared JSON parser for prompt/http results

**Verified**: E2E tests `hook runtime loads all 3 types + new events`,
`old-format hooks (no type field) still work`

---

## 4. Headless Safety Bounds

### 4.1 --max-turns

Limits the number of ReAct loop iterations in headless mode.

```bash
hlvm ask -p "refactor everything" --max-turns 10
```

Maps directly to `OrchestratorConfig.maxIterations` (existing field).
Default: 20 (unchanged). When limit reached: `"Maximum iterations (N) reached."`

### 4.2 --max-budget

Limits API cost in USD. Checked at the top of each loop iteration.

```bash
hlvm ask -p "refactor everything" --max-budget 2.50
```

Uses `UsageTracker.snapshot(modelId).totalCostUsd` for cost estimation.
When limit exceeded: `"Maximum budget ($N) exceeded. Task incomplete."`

### 4.3 Wire-Through Path

```
ask.ts (CLI flag parsing)
  → host-client.ts (HostBackedAgentQueryOptions)
  → chat-protocol.ts (ChatRequest.max_iterations / max_budget_usd)
  → chat-agent-mode.ts (extracts from request body)
  → agent-runner.ts (AgentRunnerOptions)
  → orchestrator.ts (OrchestratorConfig.maxIterations / maxBudgetUsd)
  → orchestrator-state.ts (LoopConfig — checked per iteration)
```

**Implementation**:
- `src/hlvm/cli/commands/ask.ts` — flag parsing + validation
- `src/hlvm/agent/orchestrator.ts` — budget check in ReAct loop
- `src/hlvm/agent/orchestrator-state.ts` — `LoopConfig.maxBudgetUsd`

---

## 5. Trust Gating

All project-level files are gated by the same trust mechanism. An untrusted
workspace gets ONLY global + bundled resources.

| Resource | Untrusted | Trusted |
|----------|-----------|---------|
| `~/.hlvm/HLVM.md` | Loaded | Loaded |
| `.hlvm/HLVM.md` | Blocked | Loaded |
| `~/.hlvm/rules/*.md` | Loaded | Loaded |
| `.hlvm/rules/*.md` | Blocked | Loaded |
| `~/.hlvm/skills/*.md` | Loaded | Loaded |
| `.hlvm/skills/*.md` | Blocked | Loaded |
| `.hlvm/agents/*.md` | Blocked | Loaded |

**Trust registry**: `~/.hlvm/trusted-workspaces.json`
```json
{ "workspaces": ["/path/to/trusted/project"] }
```

**Implementation**:
- `src/hlvm/prompt/instructions.ts` — `isWorkspaceTrusted()`, `trustWorkspace()`
- `src/hlvm/agent/agent-registry.ts` — `loadAgentProfiles({ trusted })` (FIXED — was ungated)
- `src/hlvm/skills/loader.ts` — `loadSkillCatalog()` checks trust for project skills

**Verified**: E2E test `harness: trust gates agents, skills, and rules consistently`

---

## 6. UX Commands

### /skills
Lists all available skills grouped by source.

```
HLVM Skills

  Bundled
    /commit  Review changes and create a descriptive git commit
    /test    Find and run project tests, report results
    /review  Review code changes... (fork)

  User (~/.hlvm/skills/)
    /deploy  Deploy to staging server

  Tip: Type /<name> to invoke. Create at ~/.hlvm/skills/<name>.md
```

### /hooks
Lists active hooks from `.hlvm/hooks.json` with handler details.

```
HLVM Hooks

  pre_tool  2 handlers
    command  lint.sh --fix
    prompt   "Is this safe? ${PAYLOAD}..."
  session_start  1 handler
    command  setup-env.sh
```

Shows example JSON template when no hooks configured.

### /init
Scaffolds harness directories and prints skill template.

```
HLVM Init

  created  ~/.hlvm/skills/
  created  ~/.hlvm/rules/
  exists   ~/.hlvm/HLVM.md

  Skill Template:
    ---
    description: "What this skill does"
    ...
```

### /help
Updated to include Skills & Hooks section listing `/skills`, `/hooks`, `/init`,
and bundled skills `/commit`, `/test`, `/review`.

### Tab Completion
Skills appear in tab completion alongside commands. The `CommandProvider`
uses `getFullCommandCatalog()` which merges static commands + dynamic skill catalog.
Loaded async on first trigger, cached for session.

**Implementation**: `src/hlvm/cli/repl/commands.ts`, `src/hlvm/cli/repl-ink/completion/concrete-providers.ts`

---

## 7. Shared Infrastructure

### 7.1 Frontmatter Parser

Shared YAML frontmatter parser used by both agent profiles and skills.

```typescript
import { splitFrontmatter, parseFrontmatter } from "src/common/frontmatter.ts";

const { meta, body } = parseFrontmatter<MyType>(markdownText);
```

**Implementation**: `src/common/frontmatter.ts` (extracted from `agent-registry.ts`)

### 7.2 Path Helpers

All harness paths via SSOT helpers in `src/common/paths.ts`:

| Function | Returns |
|----------|---------|
| `getSkillsDir()` | `~/.hlvm/skills/` |
| `getProjectSkillsDir(ws)` | `<ws>/.hlvm/skills/` |
| `getRulesDir()` | `~/.hlvm/rules/` |
| `getProjectRulesDir(ws)` | `<ws>/.hlvm/rules/` |

---

## 8. Files Modified/Created

### New Files (11)
```
src/common/frontmatter.ts                   — shared YAML frontmatter parser
src/hlvm/skills/types.ts                    — SkillDefinition, SkillFrontmatter
src/hlvm/skills/loader.ts                   — catalog discovery + session cache
src/hlvm/skills/executor.ts                 — inline skill execution
src/hlvm/skills/mod.ts                      — barrel export
src/hlvm/skills/bundled/index.ts            — bundled aggregator
src/hlvm/skills/bundled/commit.ts           — /commit skill
src/hlvm/skills/bundled/test.ts             — /test skill
src/hlvm/skills/bundled/review.ts           — /review skill
tests/e2e/harness-engineering.test.ts       — 18 E2E integration tests
docs/harness-engineering/reference.md       — this document
```

### Modified Files (19)
```
src/common/paths.ts                         — +4 path helpers
src/hlvm/agent/agent-registry.ts            — extracted frontmatter, added trust gating
src/hlvm/agent/agent-runner.ts              — skill loading, trust wiring, budget passthrough
src/hlvm/agent/hooks.ts                     — prompt/http hook types, 4 new events, DRY cleanup
src/hlvm/agent/llm-integration.ts           — skills passthrough to compilePrompt
src/hlvm/agent/orchestrator.ts              — max-budget enforcement in ReAct loop
src/hlvm/agent/orchestrator-state.ts        — maxBudgetUsd in LoopConfig
src/hlvm/agent/session.ts                   — skills in AgentSessionOptions
src/hlvm/agent/tools/meta-tools.ts          — skill tool registration
src/hlvm/cli/commands/ask.ts                — --max-turns, --max-budget flags
src/hlvm/cli/repl/commands.ts               — /skills, /hooks, /init, help update, skill dispatch
src/hlvm/cli/repl-ink/components/App.tsx     — skill activation → agent query
src/hlvm/cli/repl-ink/completion/concrete-providers.ts — async skill completions
src/hlvm/prompt/instructions.ts             — @include resolver, rules loading
src/hlvm/prompt/sections.ts                 — skill catalog section
src/hlvm/prompt/types.ts                    — InstructionHierarchy extensions, skills in input
src/hlvm/runtime/chat-protocol.ts           — max_iterations/max_budget_usd fields
src/hlvm/runtime/host-client.ts             — wire-through for CLI flags
src/hlvm/cli/repl/handlers/chat-agent-mode.ts — max-turns/budget extraction
```

### Test Files Updated (3)
```
tests/unit/prompt/instructions.test.ts      — updated for 8000 char budget
tests/unit/prompt/compiler.test.ts          — updated for 8000 char budget
tests/unit/agent/llm-integration.test.ts    — updated for 8000 char budget
```

---

## 9. Test Verification

### Unit Tests (unchanged suites, all passing)
```
hooks.test.ts              3/3   passed
agent-registry.test.ts    23/23  passed
instructions.test.ts      13/13  passed
compiler.test.ts          39/39  passed (includes budget fix)
sdk-runtime.test.ts       19/19  passed
llm-integration.test.ts    all   passed (includes budget fix)
```

### E2E Integration Tests (new suite)
```
tests/e2e/harness-engineering.test.ts    20/20 passed
```

| # | Test | Feature Verified |
|---|------|-----------------|
| 1 | @include resolves files into HLVM.md | @include directive |
| 2 | rules/*.md auto-loaded and sorted | Rules directory |
| 3 | missing @include shows placeholder | Error handling |
| 4 | @include blocks path traversal | Security: path containment |
| 5 | @include blocks symlinks | Security: symlink bypass |
| 6 | bundled skills load by default | Skill discovery |
| 7 | user skill loaded and invoked with args | User skills + ${ARGS} |
| 8 | user skill overrides bundled by name | Override priority |
| 9 | untrusted project skill blocked | Trust gating |
| 10 | trusted project skill loaded | Trust gating |
| 11 | malformed skills silently skipped | Error handling |
| 12 | /commit activates inline skill | Slash commands |
| 13 | /review activates fork skill | Fork execution |
| 14 | unknown slash command rejected | Error handling |
| 15 | skills section renders in system prompt | Prompt rendering |
| 16 | skill tool registered in registry | Tool registration |
| 17 | hook runtime loads all 3 types + new events | Hook system |
| 18 | old-format hooks still work | Backward compatibility |
| 19 | trust gates agents, skills, rules consistently | Security model |
| 20 | completion catalog includes skills | Tab completion |

### SSOT Compliance
Zero violations in all harness files. Verified via `deno task ssot:check`.

---

## 10. Remaining Gaps (vs Claude Code)

| Feature | CC Has | HLVM Status | Priority |
|---------|--------|-------------|----------|
| Settings hierarchy (6-level) | YES | 2 files (config.json + policy.json) | Separate track |
| Auto-mode classifier (ML permissions) | YES | NO | Separate track |
| Plugin marketplace | YES | NO | Needs ecosystem |
| Cron/scheduling | YES | NO | Needs cloud |
| Agent hook type | YES | NO | Add when needed |
| Callback/function hooks | YES (SDK) | NO | Low priority |
| 10+ more hook events | YES | NO | Add incrementally |
| Interactive skill/hook modals | YES (Ink) | Text-based listing | Acceptable for v1 |
