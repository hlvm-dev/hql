# Migrating from Claude Code to HLVM

Guide for Claude Code users adopting HLVM's agent system.

---

## Overview

HLVM's agent system provides Claude Code-equivalent functionality with additional fine-grained control. This guide maps Claude Code patterns to HLVM equivalents.

---

## Quick Reference

| Claude Code | HLVM | Notes |
|-------------|------|-------|
| `claude ask "query"` | `hlvm ask "query"` | Identical interactive mode |
| `claude ask -p "query"` | `hlvm ask -p "query"` | Non-interactive mode (defaults to `dontAsk`) |
| `claude ask --print "query"` | `hlvm ask --print "query"` | Same long form |
| `claude ask --permission-mode <mode>` | `hlvm ask --permission-mode <mode>` | Modes: default, acceptEdits, plan, bypassPermissions, dontAsk |
| `claude ask --dangerously-skip-permissions` | `hlvm ask --dangerously-skip-permissions` | Legacy alias for `--permission-mode bypassPermissions` |
| `claude ask --allowedTools <tool>` | `hlvm ask --allowedTools <tool>` | Repeatable flag for fine-grained control |
| `claude ask --disallowedTools <tool>` | `hlvm ask --disallowedTools <tool>` | Repeatable flag for explicit denials |
| *(not available)* | `hlvm ask --permission-mode acceptEdits` | Auto-approve file ops, prompt for destructive |

---

## Core Concepts

### Interactive Mode (Default)

**Claude Code:**
```bash
claude ask "fix the bug in auth.ts"
```

**HLVM:**
```bash
hlvm ask "fix the bug in auth.ts"
```

**Behavior:** Identical — prompts for mutations, auto-approves read-only.

---

### Non-Interactive Mode (`-p` / `--print`)

**Claude Code:**
```bash
# Non-interactive, safe tools only
claude ask -p "analyze code quality"
```

**HLVM:**
```bash
# Same behavior — defaults to dontAsk permission mode
hlvm ask -p "analyze code quality"
```

**Behavior:** Identical — no prompts, mutations denied, read-only approved. The `-p`/`--print` flag sets `printMode=true` and defaults to `dontAsk` permission mode when no explicit `--permission-mode` is given.

**Use cases:**
- CI/CD pipelines
- Scripts and automation
- Non-interactive environments

---

### Bypass Permissions Mode (`--permission-mode bypassPermissions`)

**Claude Code:**
```bash
# Skip ALL prompts (dangerous!)
claude ask --dangerously-skip-permissions "task"
```

**HLVM:**
```bash
# Preferred: explicit permission mode
hlvm ask --permission-mode bypassPermissions "task"

# Legacy alias (still works)
hlvm ask --dangerously-skip-permissions "task"
```

**Warning:** Auto-approves all tools including destructive operations. Use only in fully trusted environments.

---

## HLVM Exclusive Features

### Fine-Grained Tool Control

HLVM extends Claude Code's permission model with surgical tool control:

#### Allow Specific Tools

```bash
# Allow only write_file (everything else denied unless L0)
hlvm ask --allowedTools write_file "generate config"

# Allow multiple tools (repeatable flag)
hlvm ask --allowedTools write_file --allowedTools edit_file "refactor"
```

**Use case:** Non-interactive mode with selective mutations.

#### Deny Specific Tools

```bash
# Deny shell_exec (everything else follows normal rules)
hlvm ask --disallowedTools shell_exec "refactor code"

# Deny multiple tools (repeatable flag)
hlvm ask --disallowedTools shell_exec --disallowedTools delete_file "task"
```

**Use case:** Interactive mode with extra safety guardrails.

#### Accept Edits Mode

```bash
# Auto-approve L0+L1 (read + file ops), prompt for L2 (destructive)
hlvm ask --permission-mode acceptEdits "apply linter fixes"

# Legacy alias (still works)
hlvm ask --auto-edit "apply linter fixes"
```

**Use case:** Trusted file operations without constant prompts.

---

## Permission System Comparison

### Claude Code

Claude Code has similar modes:

| Mode | Behavior |
|------|----------|
| Default (interactive) | Prompt for all mutations |
| dontAsk (`-p`) | Deny all mutations |
| bypassPermissions (`--dangerously-skip-permissions`) | Approve all |

### HLVM

HLVM provides six permission modes via `--permission-mode` plus fine-grained control:

| Mode | L0 (read) | L1 (mutations) | L2 (destructive) | CLI |
|------|-----------|----------------|------------------|-----|
| `default` | Auto | Prompt | Prompt | (none) |
| `plan` | Auto | Prompt | Prompt | `--permission-mode plan` |
| `acceptEdits` | Auto | Auto | Prompt | `--permission-mode acceptEdits` |
| `bypassPermissions` | Auto | Auto | Auto | `--permission-mode bypassPermissions` |
| `dontAsk` | Auto | Deny | Deny | `--permission-mode dontAsk` |
| `auto` | Auto | LLM classify | LLM classify | `--permission-mode auto` |

**Plus** explicit `--allowedTools` / `--disallowedTools` flags (repeatable).

**Note:** `-p`/`--print` defaults to `dontAsk` when no explicit `--permission-mode` is given.

---

## Safety Levels

HLVM classifies tools into three safety levels:

### L0: Safe Read-Only

Auto-approved in all modes.

**Examples:**
- `read_file` — Read file contents
- `list_files` — List directories
- `search_code` — Search codebase
- `git_status` — Check git status
- `git_diff` — View changes

### L1: Low-Risk Mutations

Prompted in default mode, denied in headless.

**Examples:**
- `write_file` — Create/overwrite files
- `edit_file` — Modify existing files
- `shell_exec` — Execute safe commands
- `git_commit` — Create commits

### L2: High-Risk Mutations

Prompted in default/auto-edit, denied in headless.

**Examples:**
- `shell_exec` with dangerous commands (e.g., `rm -rf`)
- `delete_file` — Irreversible deletion
- Destructive git operations (e.g., `git reset --hard`)

---

## Common Migration Patterns

### Pattern 1: CI/CD Analysis

**Claude Code:**
```bash
claude ask -p "analyze code quality"
```

**HLVM:**
```bash
hlvm ask -p "analyze code quality"
```

**Migration:** No changes needed.

---

### Pattern 2: Automated Documentation

**Claude Code:**
```bash
# Not possible without --dangerously-skip-permissions
claude ask --dangerously-skip-permissions "generate docs"
```

**HLVM:**
```bash
# Safer: non-interactive + selective write permission
hlvm ask -p --allowedTools write_file "generate docs"
```

**Migration:** Use fine-grained control instead of blanket unsafe mode.

---

### Pattern 3: Interactive with Extra Safety

**Claude Code:**
```bash
# Not possible — must manually reject shell prompts
claude ask "refactor code"
```

**HLVM:**
```bash
# Block shell access upfront
hlvm ask --disallowedTools shell_exec "refactor code"
```

**Migration:** Use explicit denials for extra guardrails.

---

### Pattern 4: Trusted File Operations

**Claude Code:**
```bash
# Must use unsafe mode or click prompts
claude ask --dangerously-skip-permissions "apply fixes"
```

**HLVM:**
```bash
# Auto-approve file ops, prompt for destructive
hlvm ask --permission-mode acceptEdits "apply fixes"
```

**Migration:** Use `acceptEdits` mode instead of bypassing all permissions.

---

## Permission Resolution Priority

Unlike Claude Code's binary prompt/deny model, HLVM has a priority system:

**Priority order (highest to lowest):**
1. Explicit deny (`--disallowedTools`)
2. Explicit allow (`--allowedTools`)
3. Mode defaults (`dontAsk`, `acceptEdits`, etc.)
4. Safety level defaults (L0 auto, L1/L2 prompt)

**Example:**

```bash
hlvm ask -p --allowedTools write_file "task"
```

- `-p` (dontAsk mode) would normally deny `write_file`
- `--allowedTools write_file` explicitly allows it
- **Result:** `write_file` is allowed (explicit allow wins)

---

## Exit Codes

Both Claude Code and HLVM use standard exit codes:

| Code | Meaning | Example |
|------|---------|---------|
| `0` | Success | Query completed without errors |
| `1` | Error | LLM API failure, timeout, tool blocked, or any other error |

All errors (execution failures, tool blocks, interaction blocks) now use exit code 1.

**Usage:**

```bash
# Claude Code
claude ask -p "query" || echo "Failed"

# HLVM
hlvm ask -p "query" || echo "Failed"
```

Identical behavior.

---

## Model Configuration

### Claude Code

```bash
# Set default model
claude config --model anthropic/claude-sonnet-4-5

# Override per-query
claude ask --model openai/gpt-4o "query"
```

### HLVM

```bash
# Set default model
hlvm config set model anthropic/claude-sonnet-4-5-20250929

# Override per-query
hlvm ask --model openai/gpt-4o "query"
```

**Migration:** Use `hlvm config` instead of `claude config`.

---

## Output Formats

### Plain Text (Default)

**Claude Code:**
```bash
claude ask -p "query" > output.txt
```

**HLVM:**
```bash
hlvm ask -p "query" > output.txt
```

Identical.

---

### JSON (Structured)

**Claude Code:**
```bash
claude ask -p --json "query" > output.jsonl
```

**HLVM:**
```bash
hlvm ask -p --json "query" > output.jsonl
```

Identical — newline-delimited JSON events.

---

### Verbose (Debugging)

**Claude Code:**
```bash
claude ask --verbose "query"
```

**HLVM:**
```bash
hlvm ask --verbose "query"
```

Identical — detailed trace output.

---

## Advanced Examples

### Example 1: Non-Interactive with Selective Writes

**Goal:** Auto-generate documentation files in CI.

**Claude Code:**
```bash
# Must use unsafe mode
claude ask --dangerously-skip-permissions "generate API docs"
```

**HLVM (safer):**
```bash
# Non-interactive + selective write permission
hlvm ask -p --allowedTools write_file "generate API docs"
```

---

### Example 2: Interactive with Shell Block

**Goal:** Refactor code interactively, but prevent shell access.

**Claude Code:**
```bash
# Not possible — must manually reject prompts
claude ask "refactor authentication module"
```

**HLVM:**
```bash
# Explicitly deny shell upfront
hlvm ask --disallowedTools shell_exec "refactor authentication module"
```

---

### Example 3: Multi-Tool Allowlist

**Goal:** Search and replace with minimal tool set.

**Claude Code:**
```bash
# Not possible
```

**HLVM:**
```bash
hlvm ask --allowedTools read_file --allowedTools search_code --allowedTools edit_file \
  "replace all instances of oldFunc with newFunc"
```

---

## Migration Checklist

- [ ] Replace `claude ask` with `hlvm ask` in scripts
- [ ] Review `-p` usage -- now defaults to `dontAsk` permission mode
- [ ] Replace `--dangerously-skip-permissions` with `--permission-mode bypassPermissions` (legacy alias still works)
- [ ] Replace `--auto-edit` with `--permission-mode acceptEdits` (legacy alias still works)
- [ ] Add `--disallowedTools` for extra safety where needed
- [ ] Use `--allowedTools` for selective non-interactive mutations
- [ ] Update CI/CD pipelines with new flags
- [ ] Update exit code handling -- all errors are now exit code 1
- [ ] Update documentation and examples

---

## Key Differences Summary

| Feature | Claude Code | HLVM |
|---------|-------------|------|
| Interactive mode | Yes | Yes |
| Non-interactive mode (`-p`) | Yes | Yes (defaults to `dontAsk`) |
| Permission modes | Yes | Yes (`--permission-mode`) |
| `bypassPermissions` mode | Yes (`--dangerously-skip-permissions`) | Yes (same flag as legacy alias) |
| Fine-grained allow | Yes (`--allowedTools`) | Yes (`--allowedTools`, repeatable) |
| Fine-grained deny | Yes (`--disallowedTools`) | Yes (`--disallowedTools`, repeatable) |
| `acceptEdits` mode | Yes | Yes (`--permission-mode acceptEdits`) |
| Permission priority | N/A | Yes (deny > allow > mode > default) |
| Safety levels | Binary (safe/unsafe) | Three levels (L0/L1/L2) |

---

## Getting Help

- **HLVM Documentation:** [Agent System](./agent.md), [CLI Permission Modes](./CLI.md#permission-modes)
- **Claude Code Docs:** https://docs.claude.ai/
- **Report Issues:** https://github.com/hlvm-dev/hql/issues

---

## See Also

- [Agent System Architecture](./agent.md) — Complete technical reference
- [CLI Permission Modes](./CLI.md#permission-modes) — Permission guide
- [Non-Interactive Usage Guide](./non-interactive-guide.md) — Non-interactive patterns
