# HLVM CLI Reference

Complete reference for the `hlvm` command-line interface.

## Quick Reference

| Command | Description |
|---------|-------------|
| `hlvm run` | Execute HQL or JavaScript code |
| `hlvm repl` | Interactive shell (REPL) |
| `hlvm ask` | AI agent task execution |
| `hlvm chat` | Plain one-turn AI chat |
| `hlvm model` | Model management (list, set, show, pull, rm) |
| `hlvm ai` | AI model setup (prefer `hlvm model`) |
| `hlvm serve` | HTTP runtime host |
| `hlvm hql init` | Initialize an HQL project |
| `hlvm hql compile` | Compile HQL to JS or native binary |
| `hlvm hql publish` | Publish an HQL package |
| `hlvm mcp` | MCP server management |
| `hlvm ollama` | Ollama server forwarding |
| `hlvm upgrade` | Check for updates |
| `hlvm uninstall` | Remove HLVM from system |

---

## hlvm run

Execute HQL or JavaScript code from a file or inline expression.

```
hlvm run <target.hql|target.js>    Run a file
hlvm run '<expression>'            Run an HQL S-expression
```

**Options:**

| Flag | Description |
|------|-------------|
| `--verbose, -v` | Enable verbose logging |
| `--time` | Show performance timing |
| `--print` | Print transpiled JS without executing |
| `--debug` | Show detailed debug info and stack traces |
| `--log <namespaces>` | Filter logging to specified namespaces |
| `--help, -h` | Show help |

**Examples:**

```bash
hlvm run '(+ 1 1)'            # Auto-prints: 2
hlvm run hello.hql             # Run file
hlvm run app.js                # Run JavaScript
```

Single S-expressions auto-print their result. File targets support `.hql`, `.js`, and `.ts`.

---

## hlvm repl

Start the interactive shell. With no arguments, `hlvm` starts the REPL by default.

```
hlvm repl [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--ink` | Force Ink REPL (requires interactive terminal) |
| `--no-banner` | Skip the startup banner |
| `--help, -h` | Show help |
| `--version` | Show version |

**Input routing:**

| Input | Action |
|-------|--------|
| `(expression)` | HQL code evaluation |
| `(js "code")` | JavaScript evaluation |
| `/command` | Slash commands |
| Everything else | AI conversation |

---

## hlvm ask

Interactive AI agent for task execution. Runs the full agent orchestration loop with tool calling, planning, and delegation.

```
hlvm ask "<query>"
```

**Options:**

| Flag | Description |
|------|-------------|
| `-p, --print` | Non-interactive output (defaults to `dontAsk` permission mode) |
| `--verbose` | Show agent header, tool labels, stats, and trace output |
| `--output-format <fmt>` | Output format: `text` (default), `json`, `stream-json` |
| `--usage` | Show token usage summary after execution |
| `--attach <path>` | Attach a file input (repeatable) |
| `--model <provider/model>` | Use a specific AI model |
| `--no-session-persistence` | Use an isolated hidden session for this run only |
| `--permission-mode <mode>` | Set permission mode (see below) |
| `--allowedTools <name>` | Allow specific tool (repeatable) |
| `--disallowedTools <name>` | Deny specific tool (repeatable) |
| `--dangerously-skip-permissions` | Alias for `--permission-mode bypassPermissions` |
| `--help, -h` | Show help |

**Examples:**

```bash
# Interactive (default)
hlvm ask "list files in src/"

# Non-interactive
hlvm ask -p "analyze code quality"

# Permission modes
hlvm ask --permission-mode acceptEdits "fix the bug"
hlvm ask --permission-mode dontAsk "analyze code"

# Tool permissions
hlvm ask --allowedTools write_file "fix bug"
hlvm ask --disallowedTools shell_exec "analyze code"

# Structured output
hlvm ask --output-format stream-json "count test files"   # NDJSON events
hlvm ask --output-format json "count test files"           # Single JSON result

# Model selection and attachments
hlvm ask --model openai/gpt-4o "summarize this codebase"
hlvm ask --attach ./screenshot.png "describe this UI issue"

# Isolated session
hlvm ask --no-session-persistence "hello"
```

### Output Formats

| Format | Description |
|--------|-------------|
| `text` | Human-readable streaming text (default) |
| `json` | Single JSON object with the final result |
| `stream-json` | Newline-delimited JSON events (NDJSON) |

**`stream-json` events:**

```jsonl
{"type":"token","text":"Hello"}
{"type":"agent_event","event":{"type":"tool_start",...}}
{"type":"final","text":"...","stats":{...},"meta":{...}}
```

**`json` output:**

```json
{"type":"result","result":"...","stats":{...},"meta":{...}}
```

### Permission Modes

| Mode | L0 (Read) | L1 (Write) | L2 (Destructive) |
|------|-----------|------------|-------------------|
| `default` | Auto-approve | Prompt | Prompt |
| `acceptEdits` | Auto-approve | Auto-approve | Prompt |
| `plan` | Auto-approve | Prompt after plan | Prompt after plan |
| `bypassPermissions` | Auto-approve | Auto-approve | Auto-approve |
| `dontAsk` | Auto-approve | Auto-deny | Auto-deny |

**Tool safety levels:**
- **L0**: Safe read-only (`read_file`, `list_files`, `search_code`)
- **L1**: Mutations (`write_file`, `edit_file`, `shell_exec`)
- **L2**: High-risk (destructive shell commands, delete operations)

**Priority order:** deny > allow > mode > default

---

## hlvm chat

Plain one-turn LLM chat. No agent orchestration, no tool calling.

```
hlvm chat "<query>"
```

**Options:**

| Flag | Description |
|------|-------------|
| `--model <provider/model>` | Use a specific AI model |
| `--help, -h` | Show help |

**Examples:**

```bash
hlvm chat "hello"
hlvm chat --model openai/gpt-4o "summarize this repo"
```

---

## hlvm model

Manage AI models. Inspired by Ollama's CLI.

```
hlvm model [command]
```

**Subcommands:**

| Command | Description |
|---------|-------------|
| _(none)_ | Show current default model and availability |
| `list` | List all available models (grouped by provider) |
| `set <name>` | Set default model (persisted to `~/.hlvm/config.json`) |
| `show <name>` | Show model details (params, capabilities, size) |
| `pull <name>` | Download a model (Ollama only) |
| `rm <name>` | Remove a model (Ollama only) |

**Examples:**

```bash
hlvm model                                         # Show current default
hlvm model list                                    # List all models
hlvm model set claude-code/claude-haiku-4-5-20251001  # Set default
hlvm model show llama3.1:8b                        # Model details
hlvm model pull ollama/llama3.2:latest             # Download
hlvm model rm llama3.2:latest                      # Remove
```

The `set` command persists to the same config SSOT used by the REPL model picker, `hlvm ask`, and the `ai()` API.

---

## hlvm ai

> **Hint:** Prefer `hlvm model` for model management. `hlvm ai` commands still work but will show deprecation hints.

AI model setup and management.

```
hlvm ai <command>
```

**Subcommands:**

| Command | Description |
|---------|-------------|
| `setup` | Ensure the default model is installed |
| `pull <model>` | Download a model (Ollama only) |
| `list` | List installed models |
| `downloads` | Show active model downloads |
| `browse` | Interactive model browser (TUI) |
| `model` | Show current default model |

**Examples:**

```bash
hlvm ai setup                        # Ensure default model ready
hlvm ai pull ollama/llama3.2:latest  # Download a model
hlvm ai list                         # List installed models
hlvm ai browse                       # Interactive model picker
hlvm ai model                        # Show current model
```

---

## hlvm serve

Start the HTTP runtime host. Used by GUI clients and host-backed CLI surfaces.

```
hlvm serve
```

Starts on port **11435**.

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/eval` | Evaluate code (HQL or JS) |
| `GET` | `/health` | Health check |

**Examples:**

```bash
hlvm serve

# Health check
curl http://localhost:11435/health

# Evaluate HQL
curl -X POST http://localhost:11435/eval \
  -H "Content-Type: application/json" \
  -d '{"code":"(+ 1 2)"}'

# Evaluate JavaScript
curl -X POST http://localhost:11435/eval \
  -H "Content-Type: application/json" \
  -d '{"code":"let a = 10"}'
```

Input starting with `(` is treated as code (HQL or JS via `(js ...)`). All other input is routed to AI conversation.

---

## hlvm hql

HQL language toolchain commands.

### hlvm hql init

Initialize a new HQL project.

```
hlvm hql init [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `-y, --yes` | Use default values without prompting |
| `--help, -h` | Show help |

**What gets created:**
- `hql.json` — Package configuration
- `mod.hql` — Sample code (if doesn't exist)
- `README.md` — Minimal template (if doesn't exist)
- `.gitignore` — HQL-specific entries

**Examples:**

```bash
hlvm hql init        # Interactive: prompts for name, version, entry point
hlvm hql init -y     # Quick: auto-generates configuration
```

### hlvm hql compile

Compile HQL to JavaScript or native binary.

```
hlvm hql compile <file.hql> [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--target <target>` | Compilation target (default: `js`) |
| `-o, --output <path>` | Output file path |
| `--release` | Production build (minified, optimized) |
| `--no-sourcemap` | Disable source map generation |
| `--verbose, -v` | Enable verbose logging |
| `--time` | Show performance timing |
| `--debug` | Show detailed error info |
| `--help, -h` | Show help |

**Targets:**

| Target | Description |
|--------|-------------|
| `js` | JavaScript output (default) |
| `native` | Binary for current platform |
| `all` | All platforms |
| `linux` | Linux x86_64 binary |
| `macos` | macOS ARM64 binary (M1/M2/M3/M4) |
| `macos-intel` | macOS x86_64 binary (Intel) |
| `windows` | Windows x86_64 binary |

**Examples:**

```bash
hlvm hql compile app.hql                        # Dev build
hlvm hql compile app.hql --release              # Production build (minified)
hlvm hql compile app.hql --release --no-sourcemap  # Smallest output
hlvm hql compile app.hql --target native        # Native binary
hlvm hql compile app.hql --target all           # All platforms
hlvm hql compile app.hql --target linux         # Cross-compile to Linux
hlvm hql compile app.hql --target native -o myapp  # Custom output name
```

### hlvm hql publish

Publish an HQL package to JSR and/or NPM.

```
hlvm hql publish [file] [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `-r, --registry <name>` | Target registry: `jsr`, `npm`, or `all` (default: `all`) |
| `-v, --version <ver>` | Explicit version (skips auto-bump) |
| `-y, --yes` | Auto-accept defaults (no prompts) |
| `--dry-run` | Preview without publishing |
| `--verbose` | Enable verbose logging |
| `--help, -h` | Show help |

**Examples:**

```bash
hlvm hql publish                # Auto-bump + publish to both registries
hlvm hql publish -y             # Non-interactive
hlvm hql publish -r jsr         # JSR only
hlvm hql publish -r npm         # NPM only
hlvm hql publish -v 1.0.0       # Explicit version
hlvm hql publish --dry-run      # Preview only
hlvm hql publish src/lib.hql    # Explicit entry file
```

**Workflow:**
1. Checks for `hql.json` (prompts to create if missing)
2. Auto-bumps patch version (unless `--version` specified)
3. Builds and publishes to selected registries
4. Updates `hql.json` with new version

---

## hlvm mcp

Model Context Protocol server management.

```
hlvm mcp <command>
```

**Subcommands:**

| Command | Description |
|---------|-------------|
| `add <name> -- <cmd...>` | Add a stdio MCP server |
| `add <name> --url <url>` | Add an HTTP MCP server |
| `list` | List configured servers |
| `remove <name>` | Remove a server |
| `login <name>` | OAuth authentication for HTTP server |
| `logout <name>` | Remove stored OAuth token |

**Options:**

| Flag | Description |
|------|-------------|
| `--env KEY=VALUE` | Environment variable (repeatable, for `add`) |

**Examples:**

```bash
hlvm mcp add github -- npx -y @modelcontextprotocol/server-github
hlvm mcp add db --url http://localhost:8080
hlvm mcp add sentry --env SENTRY_TOKEN=abc123 -- npx @sentry/mcp-server
hlvm mcp list
hlvm mcp remove github
hlvm mcp login notion
hlvm mcp logout notion
```

---

## hlvm ollama

Ollama server forwarding. Starts the local Ollama server.

```
hlvm ollama serve
```

Requires Ollama to be installed on your system. Download from [ollama.ai](https://ollama.ai).

---

## hlvm upgrade

Check for updates and show upgrade instructions.

```
hlvm upgrade [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `-c, --check` | Check for updates without installing |
| `--help, -h` | Show help |

---

## hlvm uninstall

Remove HLVM from the system.

```
hlvm uninstall [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `-y, --yes` | Skip confirmation prompt |
| `--help, -h` | Show help |

**What gets removed:**
- `~/.hlvm/bin/hlvm` — The binary
- `~/.hlvm/` — Config and cache directory

You will need to manually remove the PATH entry from your shell config.

---

## Model Identification

Models use `<provider>/<model-name>` format:

```
ollama/llama3.1:8b         # Local Ollama
ollama/llama3.2:latest     # Local Ollama
openai/gpt-4o              # OpenAI
anthropic/claude-3-5-sonnet # Anthropic
google/gemini-2.0-flash    # Google
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `HLVM_DIR` | Override HLVM config directory (default: `~/.hlvm`) |
| `HLVM_AGENT_ENGINE` | Select agent engine: `sdk` or `legacy` |
| `HLVM_DISABLE_AI_AUTOSTART` | Skip default model download |
| `HLVM_FORCE_SETUP` | Force first-run setup |
| `HLVM_ASK_FIXTURE_PATH` | Testing fixture path (internal) |
| `HLVM_REPL_PORT` | Override REPL server port |

---

## Configuration Files

| File | Description |
|------|-------------|
| `hql.json` | HQL package metadata (name, version, exports) |
| `~/.hlvm/` | Global config and cache directory |
| `.hlvm/prompt.md` | Per-project agent instructions |

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General failure |
