# Gap Analysis: What HLVM Must Add from Claude Code

Objective: close harness engineering gaps AND intentionally mirror CC concepts
so CC users feel at home. Knowledge transfer > originality.

## Research Source

CC codebase: `~/dev/ClaudeCode-main/` (full source analysis, not docs).

---

## Gap Summary

```
                           CC Has    HLVM Has    Gap
  ─────────────────────────────────────────────────────
  Skills system            YES       NO          CRITICAL — copy entirely
  Slash commands           YES       NO          CRITICAL — copy entirely
  Skill Tool (model-side)  YES       NO          CRITICAL — copy entirely
  @include in HLVM.md      YES       NO          HIGH — easy win
  .hlvm/rules/*.md         YES       NO          HIGH — easy win
  Settings hierarchy       YES       PARTIAL     HIGH — add managed + local
  Hook variants            5 types   1 type      HIGH — add prompt/agent/http
  Hook event breadth       25+       11          MEDIUM — add missing events
  Auto-mode classifier     YES       NO          MEDIUM — ML permission gating
  --max-turns              YES       NO          MEDIUM — headless safety
  --max-budget-usd         YES       NO          MEDIUM — headless safety
  Output formats (json)    YES       NO          MEDIUM — SDK/integration
  Scheduling/cron          YES       NO          LOW — needs cloud infra
  Plugin marketplace       YES       NO          LOW — needs ecosystem
  Worktree per agent       YES       PARTIAL     LOW — already have workspace leases
```

---

## GAP 1: SKILLS SYSTEM [CRITICAL]

**CC has it. HLVM has nothing equivalent.**

HLVM has agent profiles (general, code, web, etc.) but those are runtime
execution configs — not user-authored reusable workflows. A CC "skill" is a
markdown recipe the agent follows. HLVM has no concept of this.

### What CC Does

```
~/.claude/skills/my-skill/SKILL.md      (user-global)
.claude/skills/my-skill/SKILL.md        (project-local)
skills/bundled/*.ts                      (built-in)
plugins/*/skills/                        (third-party)
```

**Skill file format:**
```markdown
---
description: "What this skill does"
when_to_use: "When to trigger this skill"
allowed-tools: [Bash, Write, Edit]
argument-hint: "e.g. file path"
model: "sonnet"
user-invocable: true
context: "inline"                       # or "fork" (sub-agent)
effort: "high"
hooks:
  PreToolUse:
    - matcher: "Write"
      hooks:
        - type: command
          command: "eslint --fix $FILE"
---

Skill content here. The agent follows these instructions.
Supports ${CLAUDE_SKILL_DIR} and ${CLAUDE_SESSION_ID} variables.
Supports !`shell command` inline execution.
```

**Discovery hierarchy (first match wins):**
1. Managed skills (`~/.claude_managed/`)
2. User skills (`~/.claude/skills/`)
3. Project skills (`.claude/skills/`, walks up to home)
4. `--add-dir` flag directories
5. Bundled skills (TypeScript, compiled in)
6. Plugin skills
7. MCP server skills

**Two invocation paths:**

| Path | Trigger | Example |
|------|---------|---------|
| Slash command | User types `/skill-name args` | `/commit fix login bug` |
| Skill Tool | Model calls `Skill({skill: "commit"})` | Agent decides to use skill |

**Execution modes:**
- `inline`: skill content injected as `isMeta: true` user message (hidden from
  user, visible to model) + allowed tools attachment
- `fork`: spawns sub-agent with isolated context budget, returns result

### What HLVM Must Build

```
HLVM Skill System — CC-Compatible Design
─────────────────────────────────────────

File locations (mirror CC exactly):
  ~/.hlvm/skills/{name}/SKILL.md        (user-global)
  .hlvm/skills/{name}/SKILL.md          (project-local)
  src/hlvm/skills/bundled/*.ts          (built-in, compiled)

File format (CC-compatible frontmatter):
  ---
  description: "..."
  when_to_use: "..."
  allowed-tools: [tool1, tool2]
  argument-hint: "..."
  model: "gemma4|llama3|claude-sonnet"
  user-invocable: true|false
  context: inline|fork
  effort: low|medium|high|max
  hooks: { ... }
  ---
  Markdown skill content.

Discovery:
  loadSkillDirs()
    → walk ~/.hlvm/skills/
    → walk .hlvm/skills/ (if workspace trusted)
    → load bundled skills
    → deduplicate by realpath

Registry:
  SkillRegistry (Map<name, SkillDefinition>)
    → getSkill(name): SkillDefinition | null
    → listSkills(): SkillDefinition[]
    → findMatchingSkills(query): SkillDefinition[]

Invocation — slash commands:
  User types: /commit fix login bug
  Parser: parseSlashCommand(input) → { name, args }
  Router: findSkill(name) → SkillDefinition
  Execute:
    inline → inject content as system message + set allowed tools
    fork   → delegate_agent with skill content as instructions

Invocation — Skill Tool (model-side):
  Agent calls: skill({ skill: "commit", args: "fix login" })
  Tool validates: skill exists, user-invocable check
  Execute: same inline/fork logic
  Return: { success, skillName, allowedTools }

Prompt injection:
  collectSections() includes available skills list
  → "Available skills: /commit, /test, /review — invoke with Skill tool"
```

### Key files to create

```
src/hlvm/skills/
  loader.ts           — loadSkillDirs(), parseSkillFrontmatter()
  registry.ts         — SkillRegistry, findSkill(), listSkills()
  executor.ts         — executeInlineSkill(), executeForkSkill()
  bundled/
    index.ts          — registerBundledSkill()
    commit.ts         — /commit skill
    test.ts           — /test skill
    review.ts         — /review skill
    simplify.ts       — /simplify skill
  types.ts            — SkillDefinition, SkillFrontmatter, SkillCommand
```

### CC files to study

```
~/dev/ClaudeCode-main/
  skills/loadSkillsDir.ts               — discovery + parsing (670 lines)
  skills/bundledSkills.ts               — bundled registration
  skills/bundled/index.ts               — bundled init
  tools/SkillTool/SkillTool.ts          — model-side invocation
  utils/processUserInput/
    processSlashCommand.tsx             — slash command execution (880 lines)
  utils/slashCommandParsing.ts          — /command parser
  utils/frontmatterParser.ts            — YAML frontmatter (400 lines)
  types/command.ts                      — Command type definitions
```

---

## GAP 2: @include AND .hlvm/rules/ [HIGH]

### What CC Does

**@include directive in CLAUDE.md:**
```markdown
# Project Rules

@./coding-standards.md
@~/global-rules.md
@/etc/shared-rules.md
```
- Relative (`@./`), home (`@~/`), absolute (`@/`) paths
- Included files added as separate entries BEFORE the including file
- Circular reference prevention via tracking set
- Max 40,000 chars per file

**Rules directory:**
```
.claude/rules/*.md          — all .md files auto-loaded
```
- Every `.md` file in rules/ is treated as additional CLAUDE.md content
- Loaded after CLAUDE.md, before CLAUDE.local.md
- Allows splitting rules into topical files

### What HLVM Must Build

```
instructions.ts changes:
  1. Add parseIncludeDirectives(content, basePath, seen: Set<string>)
     → scan for @path lines
     → resolve relative to file location
     → prevent circular refs
     → return expanded content

  2. Add loadRulesDirectory(workspacePath)
     → glob .hlvm/rules/*.md
     → sort alphabetically
     → append to instruction hierarchy after HLVM.md

  3. Bump char limit to 40,000 (CC default)
```

### CC files to study

```
~/dev/ClaudeCode-main/
  utils/claudemd.ts                     — @include parsing, rules/ loading
```

---

## GAP 3: SETTINGS HIERARCHY [HIGH]

### What CC Does

CC has 6-level settings merge (later wins):

```
1. /etc/claude-code/managed-settings.json       (admin/IT)
   /etc/claude-code/managed-settings.d/*.json   (drop-ins, sorted)
2. ~/.claude/settings.json                       (user global)
3. .claude/settings.json                         (project shared)
4. .claude/settings.local.json                   (project private)
5. --settings <file-or-json>                     (CLI flag)
6. Remote managed settings                       (cloud sync)
```

### What HLVM Has

```
  ~/.hlvm/agent-policy.json             (single file, flat)
```

### What HLVM Must Build

```
settings/
  loader.ts       — loadSettings() with 5-level merge:
    1. /etc/hlvm/managed-settings.json        (admin)
    2. ~/.hlvm/settings.json                   (user global)
    3. .hlvm/settings.json                     (project shared)
    4. .hlvm/settings.local.json               (project private, .gitignore)
    5. --settings flag                          (CLI override)

  types.ts        — HlvmSettings schema (superset of current AgentPolicy)
    hooks: { ... }
    permissions: { allowedTools, deniedTools, rules }
    models: { default, fallback }
    memory: { enabled, maxFacts }
    skills: { enabled, dirs }

  Migrate agent-policy.json → settings.json (keep compat)
```

### CC files to study

```
~/dev/ClaudeCode-main/
  utils/settings/settings.ts            — 6-level merge logic
  utils/settings/types.ts               — Zod schema
  utils/settings/settingsCache.ts       — session cache
```

---

## GAP 4: HOOK VARIANTS [HIGH]

### What CC Has (5 hook types)

HLVM hooks are command-only (shell exec). CC has 5:

```
1. command   — shell exec (HLVM already has this)
2. prompt    — send to LLM for evaluation ("is this safe?")
3. agent     — spawn sub-agent for verification
4. http      — POST to webhook (Slack, PagerDuty, etc.)
5. callback  — TypeScript function (SDK only)
```

**CC hook config format:**
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "prompt",
            "prompt": "Review this edit for security issues. $ARGUMENTS",
            "model": "claude-haiku-4",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

**CC hook output protocol:**
- Exit 0: success
- Exit 2: BLOCK (stderr shown to model)
- JSON output can override: `{ "decision": "block", "reason": "..." }`
- `updatedInput`: modify tool input before execution
- `additionalContext`: inject context into next turn
- `permissionBehavior`: "allow" | "deny" | "ask"

### What HLVM Must Add

```
hooks.ts changes:
  1. Add HookType = "command" | "prompt" | "agent" | "http"

  2. Add executePromptHook(hook, input)
     → call local LLM with hook.prompt + JSON input
     → parse response as HookResult
     → return allow/block/context

  3. Add executeAgentHook(hook, input)
     → delegate_agent with hook.prompt + JSON input
     → agent runs verification
     → return structured result

  4. Add executeHttpHook(hook, input)
     → POST hook.url with JSON input body
     → parse response as HookResult
     → support header env var expansion ($VAR_NAME)

  5. Unify hook output protocol:
     → exit 0 = success
     → exit 2 = block (CC compatible)
     → JSON output: { decision, reason, updatedInput, additionalContext }

  6. Add matcher patterns to hook config:
     → "matcher": "Write|Edit" (regex against tool_name)
     → "if": "Write(*.ts)" (permission rule syntax)
```

### CC files to study

```
~/dev/ClaudeCode-main/
  utils/hooks.ts                        — main engine (massive)
  utils/hooks/execPromptHook.ts         — LLM evaluation
  utils/hooks/execAgentHook.ts          — agent spawning
  utils/hooks/execHttpHook.ts           — webhook POST
  schemas/hooks.ts                      — Zod validation
  types/hooks.ts                        — type definitions
  services/tools/toolHooks.ts           — tool integration
```

---

## GAP 5: HOOK EVENT BREADTH [MEDIUM]

### CC Events HLVM Is Missing

```
HLVM has (11):                CC has but HLVM lacks (14+):
  pre_llm                       PermissionRequest
  post_llm                      PermissionDenied
  pre_tool                      PostToolUseFailure
  post_tool                     SessionStart
  plan_created                  SessionEnd
  write_verified                Setup
  delegate_start                SubagentStart
  delegate_end                  SubagentStop
  final_response                UserPromptSubmit
  teammate_idle                 PreCompact
  task_completed                PostCompact
                                Elicitation
                                FileChanged
                                CwdChanged
                                WorktreeCreate
                                InstructionsLoaded
                                ConfigChange
```

### Priority additions for HLVM

```
P0 (add now):
  SessionStart      — run setup scripts, load env, check prereqs
  SessionEnd        — save state, cleanup temp files
  PostToolFailure   — error recovery hooks
  PermissionRequest — custom permission logic

P1 (add soon):
  UserPromptSubmit  — input validation, content filtering
  PreCompact        — save important context before compression
  SubagentStart     — log/audit agent spawning
  SubagentStop      — collect agent results
```

---

## GAP 6: HEADLESS MODE SAFETY [MEDIUM]

### What CC Has

```bash
claude -p "fix the bug" \
  --max-turns 25 \
  --max-budget-usd 5.00 \
  --output-format stream-json \
  --permission-mode auto
```

### What HLVM Has

```bash
hlvm ask -p "fix the bug" \
  --permission-mode bypassPermissions
  # no --max-turns
  # no --max-budget-usd
  # no --output-format
```

### What HLVM Must Add

```
cli/commands/ask.ts changes:
  1. --max-turns <N>           (default: 25, like CC)
  2. --max-budget-usd <N>      (track via UsageTracker)
  3. --output-format text|json|stream-json
  4. --include-hook-events     (for SDK consumers)

agent-runner.ts changes:
  1. Check turnCount >= maxTurns → early exit
  2. Check totalCost >= maxBudget → early exit
  3. Emit structured JSON events in stream-json mode
```

---

## GAP 7: AUTO-MODE CLASSIFIER [MEDIUM]

### What CC Does

CC's `yoloClassifier.ts` uses an LLM to decide permissions automatically:

```
Tool call arrives → classify(tool_name, tool_input, context)
  → fast stage: pattern matching on known-safe tools
  → thinking stage: send to model with CLAUDE.md context
  → returns: { shouldBlock, reason, model, usage }
```

This powers `--permission-mode auto` — CC asks the LLM "is this safe?" instead
of asking the user every time.

### What HLVM Can Do

HLVM already has local LLM classification (`local-llm.ts` with 10 classifiers).
Add one more:

```
local-llm.ts addition:
  classifyToolSafety(toolName, toolInput, context)
    → returns: { safe: boolean, reason: string }
    → used by permission system when mode = "auto"

policy.ts changes:
  Add "auto" to permission modes
  When mode=auto: call classifyToolSafety before prompting user
```

---

## GAP 8: NAMING ALIGNMENT [CRITICAL — zero cost]

**Intentionally use CC naming so CC users feel at home:**

```
CC Name                  HLVM Current           HLVM Should Be
─────────────────────────────────────────────────────────────────
CLAUDE.md                HLVM.md                HLVM.md (keep — brand)
.claude/                 .hlvm/                 .hlvm/ (keep — brand)
settings.json            agent-policy.json      settings.json ← RENAME
settings.local.json      (none)                 settings.local.json ← ADD
skills/                  (none)                 skills/ ← ADD
rules/                   (none)                 rules/ ← ADD
commands/                (none)                 (skip — CC legacy)
hooks (in settings)      hooks.json             hooks (in settings.json) ← MOVE
/commit                  (none)                 /commit ← ADD
/test                    (none)                 /test ← ADD
Skill tool               (none)                 skill tool ← ADD
--max-turns              (none)                 --max-turns ← ADD
--max-budget-usd         (none)                 --max-budget ← ADD
--output-format          (none)                 --output-format ← ADD
PreToolUse               pre_tool               pre_tool (keep — snake_case)
PostToolUse              post_tool              post_tool (keep)
```

Keep HLVM brand names (HLVM.md, .hlvm/) but mirror CC structure names
(settings.json, skills/, rules/) so the mental model transfers.

---

## IMPLEMENTATION PRIORITY

```
Phase 1 — Foundation (1 week)
  [x] already have: HLVM.md, memory, hooks (command), policy, headless
  [ ] GAP 8: Rename agent-policy.json → settings.json
  [ ] GAP 2: Add @include + .hlvm/rules/*.md
  [ ] GAP 3: Settings hierarchy (managed/user/project/local/flag)

Phase 2 — Skills System (2 weeks)
  [ ] GAP 1: Skill loader + frontmatter parser
  [ ] GAP 1: Skill registry + discovery
  [ ] GAP 1: Slash command parser + router
  [ ] GAP 1: Skill Tool (model-side invocation)
  [ ] GAP 1: Bundled skills (/commit, /test, /review, /simplify)
  [ ] GAP 1: Inline + fork execution modes

Phase 3 — Safety & Endurance (1 week)
  [ ] GAP 4: Hook variants (prompt, agent, http)
  [ ] GAP 5: Missing hook events (SessionStart/End, PostToolFailure)
  [ ] GAP 6: --max-turns, --max-budget, --output-format
  [ ] GAP 7: Auto-mode classifier (classifyToolSafety)

Phase 4 — Polish (ongoing)
  [ ] Bundled skills library expansion
  [ ] Plugin/skill marketplace (needs community)
  [ ] Scheduling/cron (needs cloud infra)
```

---

## CC Architecture Quick Reference

For implementors — key CC files to study when building each feature:

```
SKILLS:
  skills/loadSkillsDir.ts             — discovery, frontmatter, creation
  skills/bundledSkills.ts             — bundled skill type + registration
  tools/SkillTool/SkillTool.ts        — model invocation
  utils/processUserInput/
    processSlashCommand.tsx           — slash command execution
  utils/slashCommandParsing.ts        — /command parser
  utils/frontmatterParser.ts          — YAML frontmatter parser
  types/command.ts                    — Command types

SETTINGS:
  utils/settings/settings.ts          — 6-level merge
  utils/settings/types.ts             — Zod schema

HOOKS:
  utils/hooks.ts                      — main execution engine
  utils/hooks/execPromptHook.ts       — LLM hook
  utils/hooks/execAgentHook.ts        — agent hook
  utils/hooks/execHttpHook.ts         — webhook hook
  schemas/hooks.ts                    — validation
  types/hooks.ts                      — types

CONTEXT:
  utils/claudemd.ts                   — CLAUDE.md discovery + @include
  context.ts                          — system prompt assembly

HEADLESS:
  cli/print.ts                        — headless runner
  main.tsx                            — --max-turns, --max-budget-usd

AUTO-MODE:
  utils/permissions/yoloClassifier.ts — ML permission classifier
```
