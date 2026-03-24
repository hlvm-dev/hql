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
| `claude ask -p "query"` | `hlvm ask -p "query"` | Identical headless mode |
| `claude ask --print "query"` | `hlvm ask --print "query"` | Same long form |
| `claude ask --dangerously-skip-permissions` | `hlvm ask --dangerously-skip-permissions` | Same (use with caution) |
| *(not available)* | `hlvm ask --allow-tool <tool>` | **HLVM exclusive** — fine-grained control |
| *(not available)* | `hlvm ask --deny-tool <tool>` | **HLVM exclusive** — explicit denials |
| *(not available)* | `hlvm ask --auto-edit` | **HLVM exclusive** — auto-approve file ops |

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

### Headless Mode (`-p` / `--print`)

**Claude Code:**
```bash
# Non-interactive, safe tools only
claude ask -p "analyze code quality"
```

**HLVM:**
```bash
# Same behavior
hlvm ask -p "analyze code quality"
```

**Behavior:** Identical — no prompts, mutations denied, read-only approved.

**Use cases:**
- CI/CD pipelines
- Scripts and automation
- Non-interactive environments

---

### Unsafe Mode (`--dangerously-skip-permissions`)

**Claude Code:**
```bash
# Skip ALL prompts (dangerous!)
claude ask --dangerously-skip-permissions "task"
```

**HLVM:**
```bash
# Same flag, same behavior
hlvm ask --dangerously-skip-permissions "task"
```

**⚠️ Warning:** Auto-approves all tools including destructive operations. Use only in fully trusted environments.

---

## HLVM Exclusive Features

### Fine-Grained Tool Control

HLVM extends Claude Code's permission model with surgical tool control:

#### Allow Specific Tools

```bash
# Allow only write_file (everything else denied unless L0)
hlvm ask --allow-tool write_file "generate config"

# Allow multiple tools
hlvm ask --allow-tool write_file --allow-tool edit_file "refactor"

# Comma-separated
hlvm ask --allowed-tools read_file,grep,search_code "search"
```

**Use case:** Headless mode with selective mutations.

#### Deny Specific Tools

```bash
# Deny shell_exec (everything else follows normal rules)
hlvm ask --deny-tool shell_exec "refactor code"

# Deny multiple tools
hlvm ask --deny-tool shell_exec --deny-tool delete_file "task"

# Comma-separated
hlvm ask --denied-tools shell_exec,git_commit "read-only task"
```

**Use case:** Interactive mode with extra safety guardrails.

#### Auto-Edit Mode

```bash
# Auto-approve L0+L1 (read + file ops), prompt for L2 (destructive)
hlvm ask --auto-edit "apply linter fixes"
```

**Use case:** Trusted file operations without constant prompts.

---

## Permission System Comparison

### Claude Code

Claude Code has two modes:

| Mode | Behavior |
|------|----------|
| Default (interactive) | Prompt for all mutations |
| Headless (`-p`) | Deny all mutations |
| Unsafe (`--dangerously-skip-permissions`) | Approve all |

### HLVM

HLVM adds two modes + fine-grained control:

| Mode | L0 (read) | L1 (mutations) | L2 (destructive) |
|------|-----------|----------------|------------------|
| Default (interactive) | Auto | Prompt | Prompt |
| Headless (`-p`) | Auto | Deny | Deny |
| Auto-edit (`--auto-edit`) | Auto | Auto | Prompt |
| Unsafe (`--dangerously-skip-permissions`) | Auto | Auto | Auto |

**Plus** explicit `--allow-tool` / `--deny-tool` flags.

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
# Safer: headless + selective write permission
hlvm ask -p --allow-tool write_file "generate docs"
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
hlvm ask --deny-tool shell_exec "refactor code"
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
hlvm ask --auto-edit "apply fixes"
```

**Migration:** Use auto-edit instead of unsafe mode.

---

## Permission Resolution Priority

Unlike Claude Code's binary prompt/deny model, HLVM has a priority system:

**Priority order (highest to lowest):**
1. Explicit deny (`--deny-tool`)
2. Explicit allow (`--allow-tool`)
3. Mode defaults (`-p`, `--auto-edit`, etc.)
4. Safety level defaults (L0 auto, L1/L2 prompt)

**Example:**

```bash
hlvm ask -p --allow-tool write_file "task"
```

- `-p` (headless) would normally deny `write_file`
- `--allow-tool write_file` explicitly allows it
- **Result:** `write_file` is allowed (explicit allow wins)

---

## Exit Codes

Both Claude Code and HLVM use standard POSIX exit codes:

| Code | Meaning | Example |
|------|---------|---------|
| `0` | Success | Query completed without errors |
| `1` | Execution error | LLM API failure, timeout |
| `2` | Validation error | Invalid flags, bad arguments |

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

### Example 1: Headless with Selective Writes

**Goal:** Auto-generate documentation files in CI.

**Claude Code:**
```bash
# Must use unsafe mode
claude ask --dangerously-skip-permissions "generate API docs"
```

**HLVM (safer):**
```bash
# Headless + selective write permission
hlvm ask -p --allow-tool write_file "generate API docs"
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
hlvm ask --deny-tool shell_exec "refactor authentication module"
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
hlvm ask --allowed-tools read_file,search_code,edit_file \
  "replace all instances of oldFunc with newFunc"
```

---

## Migration Checklist

- [ ] Replace `claude ask` with `hlvm ask` in scripts
- [ ] Review `-p` usage — no changes needed
- [ ] Review `--dangerously-skip-permissions` — consider safer alternatives (`--auto-edit` or `--allow-tool`)
- [ ] Add `--deny-tool` for extra safety where needed
- [ ] Use `--allow-tool` for selective headless mutations
- [ ] Update CI/CD pipelines with new flags
- [ ] Test exit code handling (should be identical)
- [ ] Update documentation and examples

---

## Key Differences Summary

| Feature | Claude Code | HLVM |
|---------|-------------|------|
| Interactive mode | ✅ Yes | ✅ Yes |
| Headless mode (`-p`) | ✅ Yes | ✅ Yes |
| Unsafe mode | ✅ Yes | ✅ Yes (same flag) |
| Fine-grained allow | ❌ No | ✅ Yes (`--allow-tool`) |
| Fine-grained deny | ❌ No | ✅ Yes (`--deny-tool`) |
| Auto-edit mode | ❌ No | ✅ Yes (`--auto-edit`) |
| Permission priority | N/A | ✅ Yes (deny > allow > mode > default) |
| Safety levels | Binary (safe/unsafe) | ✅ Three levels (L0/L1/L2) |

---

## Getting Help

- **HLVM Documentation:** [Agent System](./agent.md), [CLI Permissions](./cli-permissions.md)
- **Claude Code Docs:** https://docs.claude.ai/
- **Report Issues:** https://github.com/hlvm-dev/hlvm/issues

---

## See Also

- [Agent System Architecture](./agent.md) — Complete technical reference
- [CLI Permission System](./cli-permissions.md) — Permission guide
- [Non-Interactive Usage Guide](./non-interactive-guide.md) — Headless patterns
