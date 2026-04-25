# HLVM CLI Reference

Complete reference for the `hlvm` command-line interface.

## Quick Reference

| Command            | Description                                      |
| ------------------ | ------------------------------------------------ |
| `hlvm run`         | Execute HQL or JavaScript code                   |
| `hlvm repl`        | Interactive shell (REPL)                         |
| `hlvm ask`         | AI agent task execution                          |
| `hlvm chat`        | Plain one-turn AI chat                           |
| `hlvm model`       | Model management (list, set, show, pull, rm)     |
| `hlvm ai`          | AI model setup (prefer `hlvm model`)             |
| `hlvm serve`       | HTTP runtime host                                |
| `hlvm hql init`    | Initialize an HQL project                        |
| `hlvm hql compile` | Compile HQL to JS or native binary               |
| `hlvm hql publish` | Publish an HQL package                           |
| `hlvm mcp`         | MCP server management                            |
| `hlvm ollama`      | Explicit compatibility bridge to system Ollama   |
| `hlvm update`      | Check for updates and install the latest release |
| `hlvm uninstall`   | Remove HLVM from system                          |

---

## hlvm run

Execute HQL or JavaScript code from a file or inline expression.

```
hlvm run <target.hql|target.js>    Run a file
hlvm run '<expression>'            Run an HQL S-expression
```

**Options:**

| Flag                 | Description                               |
| -------------------- | ----------------------------------------- |
| `--verbose, -v`      | Enable verbose logging                    |
| `--time`             | Show performance timing                   |
| `--print`            | Print transpiled JS without executing     |
| `--debug`            | Show detailed debug info and stack traces |
| `--log <namespaces>` | Filter logging to specified namespaces    |
| `--help, -h`         | Show help                                 |

**Examples:**

```bash
hlvm run '(+ 1 1)'            # Auto-prints: 2
hlvm run hello.hql             # Run file
hlvm run app.js                # Run JavaScript
```

Single S-expressions auto-print their result. File targets support `.hql`,
`.js`, and `.ts`.

---

## hlvm repl

Start the interactive shell. With no arguments, `hlvm` starts the REPL by
default.

```
hlvm repl [options]
```

**Options:**

| Flag          | Description                                    |
| ------------- | ---------------------------------------------- |
| `--ink`       | Force Ink REPL (requires interactive terminal) |
| `--no-banner` | Skip the startup banner                        |
| `--port <N>`  | Use a dedicated runtime port for dev/test isolation |
| `--help, -h`  | Show help                                      |
| `--version`   | Show version                                   |

**Input routing:**

| Input           | Action                |
| --------------- | --------------------- |
| `(expression)`  | HQL code evaluation   |
| `(js "code")`   | JavaScript evaluation |
| `/command`      | Slash commands        |
| Everything else | AI conversation       |

---

## hlvm ask

Interactive AI agent for task execution. Runs the full agent orchestration loop
with tool calling and planning.

```
hlvm ask "<query>"
```

**Options:**

| Flag                             | Description                                                    |
| -------------------------------- | -------------------------------------------------------------- |
| `-p, --print`                    | Non-interactive output (defaults to `dontAsk` permission mode) |
| `--verbose`                      | Show agent header, tool labels, stats, and trace output        |
| `--output-format <fmt>`          | Output format: `text` (default), `json`, `stream-json`         |
| `--usage`                        | Show token usage summary after execution                       |
| `--attach <path>`                | Attach a file input (repeatable)                               |
| `--model <provider/model>`       | Use a specific AI model                                        |
| `--port <N>`                     | Use a dedicated runtime port for dev/test isolation            |
| `--no-session-persistence`       | Use an isolated hidden session for this run only               |
| `--permission-mode <mode>`       | Set permission mode (see below)                                |
| `--allowedTools <name>`          | Allow specific tool (repeatable)                               |
| `--disallowedTools <name>`       | Deny specific tool (repeatable)                                |
| `--dangerously-skip-permissions` | Alias for `--permission-mode bypassPermissions`                |
| `--max-turns <N>`                | Maximum agent loop iterations (headless safety cap)            |
| `--help, -h`                     | Show help                                                      |

**Examples:**

```bash
# Interactive (default)
hlvm ask "list files in src/"

# Non-interactive print mode
hlvm ask -p "analyze code quality"

# Permission modes
hlvm ask --permission-mode acceptEdits "fix the bug"
hlvm ask --permission-mode dontAsk "analyze code"

# Unlock shell execution explicitly (required in non-interactive mode)
hlvm ask --allowedTools shell_exec --allowedTools write_file \
  --permission-mode dontAsk \
  "write a python script to generate a chart and run it"

# Block a specific tool
hlvm ask --disallowedTools shell_exec "analyze code"

# Generate a file from multiple sources
hlvm ask --allowedTools shell_exec --allowedTools write_file \
  --allowedTools read_file --permission-mode dontAsk \
  "read all PDFs in ./reports/, summarize them, and write summary.md"

# Generate a PPTX presentation
hlvm ask --allowedTools shell_exec --allowedTools write_file \
  --permission-mode dontAsk \
  "create a 5-slide dark-themed presentation about MCP, save to ~/Desktop/mcp.pptx, then open it"

# Mutate an existing PPTX in place and reload PowerPoint
hlvm ask --allowedTools shell_exec --allowedTools read_file \
  --permission-mode dontAsk \
  "open ~/Desktop/mcp.pptx with python-pptx, change slide 1 title to 'New Title', save it, then run: osascript -e 'tell application \"Microsoft PowerPoint\" to quit saving no' && sleep 2 && open ~/Desktop/mcp.pptx"

# Structured output for scripting
hlvm ask --output-format stream-json "count test files"   # NDJSON events
hlvm ask --output-format json "count test files"           # Single JSON result

# Model selection
hlvm ask --model openai/gpt-4o "summarize this codebase"
hlvm ask --model claude-code/claude-sonnet-4-6 "review this PR"

# Attach files (images, PDFs, docs)
hlvm ask --attach ./screenshot.png "describe this UI issue"
hlvm ask --attach ./report.pdf --attach ./data.csv \
  "summarize the report and cross-reference with the data"

# Isolated session (no memory of previous conversations)
hlvm ask --no-session-persistence "hello"

# Cap agent loop iterations (useful for automation)
hlvm ask --max-turns 5 "refactor this file"
```

### Output Formats

| Format        | Description                              |
| ------------- | ---------------------------------------- |
| `text`        | Human-readable streaming text (default)  |
| `json`        | Single JSON object with the final result |
| `stream-json` | Newline-delimited JSON events (NDJSON)   |

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

| Mode                | L0 (Read)    | L1 (Write)        | L2 (Destructive)  |
| ------------------- | ------------ | ----------------- | ----------------- |
| `default`           | Auto-approve | Prompt            | Prompt            |
| `acceptEdits`       | Auto-approve | Auto-approve      | Prompt            |
| `plan`              | Auto-approve | Prompt after plan | Prompt after plan |
| `bypassPermissions` | Auto-approve | Auto-approve      | Auto-approve      |
| `dontAsk`           | Auto-approve | Auto-deny         | Auto-deny         |

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

| Flag                       | Description             |
| -------------------------- | ----------------------- |
| `--model <provider/model>` | Use a specific AI model |
| `--help, -h`               | Show help               |

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

| Command       | Description                                              |
| ------------- | -------------------------------------------------------- |
| _(none)_      | Show current default model and availability              |
| `list`        | List all available models (grouped by provider)          |
| `set <name>`  | Set default model (persisted to `~/.hlvm/settings.json`) |
| `show <name>` | Show model details (params, capabilities, size)          |
| `pull <name>` | Download a model (Ollama only)                           |
| `rm <name>`   | Remove a model (Ollama only)                             |

**Examples:**

```bash
hlvm model                                         # Show current default
hlvm model list                                    # List all models
hlvm model set claude-code/claude-haiku-4-5-20251001  # Set default
hlvm model show llama3.1:8b                        # Model details
hlvm model pull ollama/llama3.2:latest             # Download
hlvm model rm llama3.2:latest                      # Remove
```

The `set` command persists to the same config SSOT used by the REPL model
picker, `hlvm ask`, and the `ai()` API.

---

## hlvm ai

> **Hint:** Prefer `hlvm model` for model management. `hlvm ai` commands still
> work but will show deprecation hints.

AI model setup and management.

```
hlvm ai <command>
```

**Subcommands:**

| Command        | Description                           |
| -------------- | ------------------------------------- |
| `setup`        | Ensure the default model is installed |
| `pull <model>` | Download a model (Ollama only)        |
| `list`         | List installed models                 |
| `downloads`    | Show active model downloads           |
| `browse`       | Interactive model browser (TUI)       |
| `model`        | Show current default model            |

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

| Method | Path                 | Description                              |
| ------ | -------------------- | ---------------------------------------- |
| `POST` | `/api/chat`          | Submit chat, eval, or agent turns        |
| `GET`  | `/api/chat/messages` | Read active conversation messages        |
| `GET`  | `/api/chat/stream`   | Subscribe to active conversation updates |
| `GET`  | `/health`            | Health check                             |

**Examples:**

```bash
hlvm serve

# Health check
curl http://localhost:11435/health

# Evaluate HQL
curl -X POST http://localhost:11435/api/chat \
  -H "Content-Type: application/json" \
  -d '{"mode":"eval","messages":[{"role":"user","content":"(+ 1 2)"}]}'

# Chat
curl -X POST http://localhost:11435/api/chat \
  -H "Content-Type: application/json" \
  -d '{"mode":"chat","messages":[{"role":"user","content":"hello"}]}'
```

GUI-visible top-level submission uses `POST /api/chat`. Internal compatibility
endpoints may still exist, but they are not part of the public runtime-host
contract.

---

## hlvm hql

HQL language toolchain commands.

### hlvm hql init

Initialize a new HQL project.

```
hlvm hql init [options]
```

**Options:**

| Flag         | Description                          |
| ------------ | ------------------------------------ |
| `-y, --yes`  | Use default values without prompting |
| `--help, -h` | Show help                            |

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

| Flag                  | Description                            |
| --------------------- | -------------------------------------- |
| `--target <target>`   | Compilation target (default: `js`)     |
| `-o, --output <path>` | Output file path                       |
| `--release`           | Production build (minified, optimized) |
| `--no-sourcemap`      | Disable source map generation          |
| `--verbose, -v`       | Enable verbose logging                 |
| `--time`              | Show performance timing                |
| `--debug`             | Show detailed error info               |
| `--help, -h`          | Show help                              |

**Targets:**

| Target        | Description                      |
| ------------- | -------------------------------- |
| `js`          | JavaScript output (default)      |
| `native`      | Binary for current platform      |
| `all`         | All platforms                    |
| `linux`       | Linux x86_64 binary              |
| `macos`       | macOS ARM64 binary (M1/M2/M3/M4) |
| `macos-intel` | macOS x86_64 binary (Intel)      |
| `windows`     | Windows x86_64 binary            |

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

| Flag                    | Description                                              |
| ----------------------- | -------------------------------------------------------- |
| `-r, --registry <name>` | Target registry: `jsr`, `npm`, or `all` (default: `all`) |
| `-v, --version <ver>`   | Explicit version (skips auto-bump)                       |
| `-y, --yes`             | Auto-accept defaults (no prompts)                        |
| `--dry-run`             | Preview without publishing                               |
| `--verbose`             | Enable verbose logging                                   |
| `--help, -h`            | Show help                                                |

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

| Command                               | Description                                      |
| ------------------------------------- | ------------------------------------------------ |
| `add <name> <commandOrUrl> [args...]` | Add a stdio or remote MCP server                 |
| `add-json <name> <json>`              | Add an MCP server from a JSON config             |
| `get <name>`                          | Show details for one MCP server                  |
| `list`                                | List configured servers                          |
| `remove <name>`                       | Remove a server                                  |
| `login <name>`                        | OAuth authentication for a remote MCP server     |
| `logout <name>`                       | Remove stored OAuth token                        |

**Options:**

| Flag                       | Description                                               |
| -------------------------- | --------------------------------------------------------- |
| `-t, --transport <type>`   | `stdio`, `http`, or `sse` for `add` (defaults to `stdio`) |
| `-e, --env KEY=VALUE`      | Environment variable (repeatable, for `add`)              |
| `-H, --header "Name: v"`   | HTTP/SSE header (repeatable, for `add`)                   |
| `--client-id <id>`         | OAuth client ID (for `add`)                               |
| `--client-secret`          | OAuth client secret input toggle (for `add` / `add-json`) |
| `--callback-port <port>`   | OAuth callback port (for `add`)                           |

**Examples:**

```bash
hlvm mcp add github -- npx -y @modelcontextprotocol/server-github
hlvm mcp add db --transport http http://localhost:8080
hlvm mcp add-json gh '{"type":"stdio","command":"npx","args":["-y","@pkg"]}'
hlvm mcp add sentry --env SENTRY_TOKEN=abc123 -- npx @sentry/mcp-server
hlvm mcp get github
hlvm mcp list
hlvm mcp remove github
hlvm mcp login notion
hlvm mcp logout notion
```

Notes:

- Servers persist to `~/.hlvm/mcp.json`. Inherited sources (Cursor, Windsurf,
  Zed, Codex CLI, Gemini CLI, Claude Code plugins) are read-only from HLVM.
- Bare-URL `hlvm mcp add <name> https://...` defaults to stdio and warns with
  the `--transport http|sse` alternatives.
- Remote `add-json` configs must include explicit `"type":"http"` or
  `"type":"sse"`; `{ "url": "..." }` alone is invalid.
- `list` and `get` show live MCP connection status.
- `hlvm mcp <subcommand> --help` shows subcommand-specific help.

See [MCP.md](./MCP.md) for the full MCP surface, configuration model, and
runtime behavior.

---

## hlvm ollama

Explicit compatibility bridge to a system Ollama installation.

```
hlvm ollama serve
```

This command is never used by HLVM's embedded runtime, bootstrap, or
`--model auto` pipeline. It requires Ollama to be installed on your system.
Download from [ollama.ai](https://ollama.ai).

---

## hlvm update

Check for updates and install the latest release.

```
hlvm update [options]
```

**Options:**

| Flag          | Description                          |
| ------------- | ------------------------------------ |
| `-c, --check` | Check for updates without installing |
| `--help, -h`  | Show help                            |

---

## hlvm uninstall

Remove HLVM from the system.

```
hlvm uninstall [options]
```

**Options:**

| Flag         | Description              |
| ------------ | ------------------------ |
| `-y, --yes`  | Skip confirmation prompt |
| `--help, -h` | Show help                |

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

Supported user-facing environment variables:

| Variable               | Description                                |
| ---------------------- | ------------------------------------------ |
| `HLVM_FORCE_SETUP`     | Force first-run setup                      |
| `HLVM_NO_UPDATE_CHECK` | Disable the startup update check           |

HLVM's state lives at `~/.hlvm/` — this is fixed and not configurable. HLVM runs
as a single user-level daemon, shared by the CLI, the macOS GUI, and any
messaging-channel receivers; there is no per-directory isolation at the user
contract.

Runtime port isolation:

```bash
hlvm --port 18442 ask "test against an isolated runtime"
hlvm ask --port 18442 "same isolation, command-local form"
hlvm repl --port 18442
```

The default `11435` port is the shared product runtime. Use `--port` only for
source-mode work, E2E tests, or diagnostics where touching the GUI runtime would
be wrong. HLVM does not silently auto-increment ports because that would split
runtime state without making the isolation explicit.

Internal equivalent used by tests and spawned runtime hosts:

| Variable         | Description |
| ---------------- | ----------- |
| `HLVM_REPL_PORT` | Environment form of `--port` for explicit dev/test isolation only |

---

## Configuration Files

| File                    | Description                                         |
| ----------------------- | --------------------------------------------------- |
| `~/.hlvm/settings.json` | Unified config: model, theme, permission mode, etc. |
| `~/.hlvm/`              | Global config and cache directory                   |
| `hql.json`              | HQL package metadata (name, version, exports)       |

---

## Exit Codes

| Code | Meaning         |
| ---- | --------------- |
| `0`  | Success         |
| `1`  | General failure |
