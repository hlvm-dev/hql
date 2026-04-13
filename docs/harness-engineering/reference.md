# HLVM Harness Engineering — Technical Reference

HLVM has CC-inspired harness primitives: instructions, rules, skills,
hooks, and headless safety limits. It is not interface-compatible with
Claude Code. HLVM intentionally diverges by supporting many models/providers
and running as a global agent session.

HLVM is a global session (like Siri). Primary config is `~/.hlvm/`.
Project-scoped overrides exist but are secondary.

---

## 1. Instruction Composition

### 1.1 HLVM.md — Custom Instructions

Global instructions loaded automatically on every session.

| Path | Description |
|------|-------------|
| `~/.hlvm/HLVM.md` | Global instructions (always loaded) |

**Budget**: 8000 chars max (`MAX_INSTRUCTION_CHARS`).

**Implementation**: `src/hlvm/prompt/instructions.ts`
- `loadInstructionHierarchy()` — reads file, resolves includes, loads rules
- `mergeInstructions(hierarchy)` — merges into single string

### 1.2 @include Directive

Inline other files into HLVM.md using `@./relative/path` syntax.

```markdown
# My Rules
@./rules/naming.md
@./rules/security.md
Always use TypeScript strict mode.
```

**Behavior**:
- Only relative paths (`@./`) — no absolute paths
- Max recursion depth: 3
- Max included file size: 4000 chars (truncated)
- Circular includes detected — directive left as-is
- Missing files produce: `[include not found: ./path]`

**Security**:
- Path traversal blocked: `@./../../etc/passwd` → `[include blocked: ... escapes base directory]`
- Symlinks blocked: `[include blocked: ... is a symlink]`
- Both checks happen before file read — no data leaks

**Implementation**: `src/hlvm/prompt/instructions.ts`
- `resolveIncludes(text, baseDir, seen?, depth?)` — recursive resolver with containment + symlink checks

**Verified**: E2E tests `@include resolves files`, `blocks path traversal`, `blocks symlinks`

### 1.3 Rules Directory

All `.md` files in the rules directory auto-loaded, sorted alphabetically.

| Path | Description |
|------|-------------|
| `~/.hlvm/rules/*.md` | Global rules (always loaded) |

**Behavior**:
- Only `.md` files (other extensions ignored)
- Sorted by filename (use `01-`, `02-` prefixes for ordering)
- Each file trimmed, joined with double newline

**Implementation**: `src/hlvm/prompt/instructions.ts`
- `loadRulesDir(dir)` — reads, sorts, concatenates

**Verified**: E2E test `rules/*.md auto-loaded and sorted`

---

## 2. Skills System

### 2.1 Skill Definition Format

Skills are markdown files with YAML frontmatter in `~/.hlvm/skills/`.

```markdown
---
description: "What this skill does"          # REQUIRED
when_to_use: "When to trigger this skill"    # optional
allowed_tools: [shell_exec, read_file]       # optional
user_invocable: true                         # optional (default: true)
context: inline                              # optional: "inline" (default) or "fork"
---

Skill body — instructions the agent follows.
Use ${ARGS} for user-provided arguments.
```

**Type validation**: All frontmatter fields runtime-validated during loading.
Wrong types fall to safe defaults (no crash, no type leaks):
- `description` must be string (required — skill skipped without it)
- `allowed_tools` must be string array (scalar string dropped)
- `context` must be `"inline"` or `"fork"` (other values → defaults to inline)
- `user_invocable` must be boolean (string `"false"` dropped → defaults to true)

**Types**: `src/hlvm/skills/types.ts`

### 2.2 Skill Discovery

Skills loaded from three sources. Later sources override earlier by name.

| Priority | Source | Path | Trust |
|----------|--------|------|-------|
| 1 (lowest) | Bundled | Compiled into binary | N/A |
| 2 | User | `~/.hlvm/skills/*.md` | No |
| 3 (highest) | Project | `<workspace>/.hlvm/skills/*.md` | Yes (trust-gated) |

**Bundled skills** (3):

| Name | Context | Description |
|------|---------|-------------|
| `/commit` | inline | Review changes and create a git commit |
| `/test` | inline | Find and run project tests |
| `/review` | fork | Review code changes (delegates to child agent) |

**Implementation**: `src/hlvm/skills/loader.ts`
- `loadSkillCatalog()` — discovery with session caching
- `resetSkillCatalogCache()` — clear cache

**Verified**: E2E tests for bundled loading, user loading, override, malformed skipping

### 2.3 Skill Execution

**Inline mode** (`context: "inline"`):
- Skill body injected as system message
- `${ARGS}` placeholder replaced with user arguments
- Agent follows the instructions in its next turn

**Fork mode** (`context: "fork"`):
- Returns instructions telling the model to use `delegate_agent`
- Background delegates get isolated workspace leases; foreground delegates
  share the parent workspace (read-only by convention)

**Implementation**: `src/hlvm/skills/executor.ts`
- `executeInlineSkill(skill, args?)` — returns `{ systemMessage, allowedTools }`

### 2.4 Skill Invocation — Two Paths

**Path 1: User slash command** — user types `/commit fix bug`

```
/commit fix bug
  → commands.ts: static lookup fails → try skill catalog
  → find "commit" (bundled, inline)
  → executeInlineSkill(commit, "fix bug")
  → App.tsx submits as agent query with skill instructions
  → agent follows the workflow
```

**Path 2: Model tool call** — model calls `skill({skill:"commit"})`

```
skill({ skill: "commit", args: "fix bug" })
  → meta-tools.ts: skill handler
  → inline: executeInlineSkill() → model follows instructions
  → fork: returns delegation instruction → model calls delegate_agent
```

**Implementation**:
- Slash: `src/hlvm/cli/repl/commands.ts`
- Tool: `src/hlvm/agent/tools/meta-tools.ts`
- App wiring: `src/hlvm/cli/repl-ink/components/App.tsx`

### 2.5 Skills in System Prompt

The model sees available skills listed in its system prompt:

```
# Skills
Invoke a skill by calling the `skill` tool with its name.

- /commit: Review changes and create a descriptive git commit
- /test: Find and run project tests, report results
- /review: Review code changes (runs in background)
```

**Wiring**: `agent-runner.ts` → `session.ts` → `llm-integration.ts` → `sections.ts`

---

## 3. Hook System

### 3.1 Hook Configuration

Hooks configured in `<workspace>/.hlvm/hooks.json` (project-scoped, not global).

```json
{
  "version": 1,
  "hooks": {
    "pre_tool": [
      { "command": ["lint.sh", "--fix"] },
      { "type": "prompt", "prompt": "Is ${PAYLOAD} safe?" },
      { "type": "http", "url": "https://hooks.example.com/check" }
    ],
    "session_start": [
      { "command": ["setup-env.sh"] }
    ]
  }
}
```

### 3.2 Hook Events (15)

| Event | When it fires | Wired at |
|-------|--------------|----------|
| `pre_llm` | Before LLM call | orchestrator.ts |
| `post_llm` | After LLM response | orchestrator.ts |
| `pre_tool` | Before tool execution | orchestrator-tool-execution.ts |
| `post_tool` | After tool execution | orchestrator-response.ts |
| `plan_created` | When plan is generated | agent-runner.ts |
| `write_verified` | After file write | orchestrator-tool-execution.ts |
| `delegate_start` | Child agent spawned | agent-runner.ts |
| `delegate_end` | Child agent returned | agent-runner.ts |
| `final_response` | Before sending response | agent-runner.ts |
| `teammate_idle` | Team member idle | team-executor.ts |
| `task_completed` | Task marked complete | team-executor.ts |
| `session_start` | After session setup | agent-runner.ts |
| `session_end` | Before session cleanup | agent-runner.ts |
| `pre_compact` | Before context compaction | orchestrator.ts |
| `user_prompt_submit` | User submits query | agent-runner.ts |

### 3.3 Hook Handler Types (3)

**Command** (shell process):
```json
{ "command": ["lint.sh", "--fix"], "timeoutMs": 5000 }
```
Exit 0: ok. Exit 2: blocked (stdout = feedback).

**Prompt** (LLM judge):
```json
{ "type": "prompt", "prompt": "Is this safe? ${PAYLOAD}" }
```
Local fallback LLM evaluates. Response: `{ "decision": "block"|"allow" }`. Fail-open.

**HTTP** (webhook):
```json
{ "type": "http", "url": "https://hooks.co/check", "headers": {"Authorization": "Bearer x"} }
```
POST payload to webhook. Response: `{ "decision": "block"|"allow" }`. Fail-open.

**Implementation**: `src/hlvm/agent/hooks.ts`

---

## 4. Permission Modes

| Mode | Behavior |
|------|----------|
| `default` | L0 auto-approve, L1 confirm-once, L2 always-confirm |
| `acceptEdits` | L0+L1 auto-approve, L2 always-confirm |
| `plan` | Research and plan first, then execute with approval |
| `bypassPermissions` | Auto-approve everything |
| `dontAsk` | Non-interactive: L0 auto-approve, all else denied |
| `auto` | L0 auto-approve, L1/L2 classified by local LLM — safe=approve, unsafe=prompt user |

### Auto Mode

Uses local LLM (`classifyToolSafety()` in `local-llm.ts`) to decide whether
a tool call is safe enough to auto-approve. Runs ONLY when the existing
pipeline would otherwise prompt the user. Precedence preserved:

```
explicit deny > explicit allow > policy > L0 allow > dontAsk deny >
bypass allow > acceptEdits L1 allow > AUTO CLASSIFIER > user prompt
```

- Classifier failure → falls through to user prompt (never silently denies)
- L1 auto-approvals reuse the L1 confirmation cache
- HLVM differentiator: auto mode uses local LLM (free), CC uses Claude API (paid)

```bash
hlvm ask -p "fix the bug" --permission-mode auto
```

**Implementation**: `src/hlvm/agent/security/safety.ts` — `resolveToolPermission()` returns
`"auto-classify"`, `checkToolSafety()` handles via injectable classifier.

---

## 5. Headless Safety Bounds

### --max-turns

Limits ReAct loop iterations.

```bash
hlvm ask -p "refactor everything" --max-turns 10
```

Maps to `OrchestratorConfig.maxIterations`. Default: 20.

### --max-budget

Limits API cost in USD (for cloud providers: Claude, OpenAI, Gemini).

```bash
hlvm ask -p "refactor everything" --max-budget 2.50
```

Uses `UsageTracker.snapshot(modelId).totalCostUsd`. Returns `undefined` for
local models (no pricing data) — the check is a no-op for Ollama.

**Wire-through**: `ask.ts` → `host-client.ts` → `chat-protocol.ts` → `agent-runner.ts` → `orchestrator.ts`

---

## 5. UX Commands

| Command | Description |
|---------|-------------|
| `/skills` | List available skills grouped by source |
| `/hooks` | List active hooks with handler details |
| `/init` | Scaffold `~/.hlvm/skills/`, `~/.hlvm/rules/`, show skill template |
| `/help` | Updated with Skills & Hooks section |
| `/commit` | Bundled skill: create a git commit |
| `/test` | Bundled skill: run project tests |
| `/review` | Bundled skill: review code changes |

Tab completion includes skills alongside commands.

**Implementation**: `src/hlvm/cli/repl/commands.ts`, `src/hlvm/cli/repl-ink/completion/concrete-providers.ts`

---

## 6. Shared Infrastructure

### Frontmatter Parser

```typescript
import { splitFrontmatter, parseFrontmatter } from "src/common/frontmatter.ts";
const { meta, body } = parseFrontmatter<MyType>(markdownText);
```

Used by agent profiles (`.hlvm/agents/*.md`) and skills (`.hlvm/skills/*.md`).

### Path Helpers (`src/common/paths.ts`)

| Function | Returns |
|----------|---------|
| `getSkillsDir()` | `~/.hlvm/skills/` |
| `getRulesDir()` | `~/.hlvm/rules/` |
| `getHooksConfigPath(ws)` | `<ws>/.hlvm/hooks.json` |

---

## 7. Test Verification

### E2E Integration Tests
```
tests/e2e/harness-engineering.test.ts    20/20 passed
```

| # | Test | Feature |
|---|------|---------|
| 1 | @include resolves files | @include |
| 2 | rules/*.md auto-loaded and sorted | Rules directory |
| 3 | missing @include shows placeholder | Error handling |
| 4 | @include blocks path traversal | Security |
| 5 | @include blocks symlinks | Security |
| 6 | bundled skills load by default | Skill discovery |
| 7 | user skill loaded and invoked with args | User skills |
| 8 | user skill overrides bundled | Override priority |
| 9 | untrusted project skill blocked | Trust gating |
| 10 | trusted project skill loaded | Trust gating |
| 11 | malformed skills silently skipped | Error handling |
| 12 | /commit activates inline skill | Slash commands |
| 13 | /review activates fork skill | Fork execution |
| 14 | unknown slash command rejected | Error handling |
| 15 | skills section renders in prompt | Prompt rendering |
| 16 | skill tool registered | Tool registration |
| 17 | hook runtime loads 3 types + events | Hook system |
| 18 | old-format hooks still work | Backward compat |
| 19 | trust gates agents, skills, rules | Security |
| 20 | completion catalog includes skills | Tab completion |

### Unit Tests (all passing)
```
hooks.test.ts              3/3
agent-registry.test.ts    23/23
instructions.test.ts      13/13
compiler.test.ts          39/39
sdk-runtime.test.ts       19/19
```
