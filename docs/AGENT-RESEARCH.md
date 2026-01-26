# Agentic CLI Research and Reference Architecture

This memo captures competitor patterns, emerging standards, and a long-term
reference architecture for a serious goal-driven AI agent CLI in HQL.

## Executive summary
- There is no formal, industry-wide standard for agentic CLI implementation.
  The field converges on shared patterns: tool schemas, permission gating,
  iterative execution loops, retrieval, and evaluation.
- MCP is the closest thing to a cross-tool standard for tool and resource
  integration, and it is already adopted across multiple agent CLIs.
- The most successful tools prioritize safe execution (explicit approval for
  mutating actions), strong tool coverage, and evaluation infrastructure.

## Competitor highlights (evidence-based)
### Claude Code
- Positioned as an "agentic coding tool" that "lives in your terminal." (R1)
- Emphasizes taking action: can edit files, run commands, and create commits;
  MCP extends it with external tools. (R1)

### Gemini CLI
- Described as an open-source AI agent for the terminal. (R2)
- Architecture splits CLI UI from core orchestration and tools. (R3)
- Tool execution is schema-driven and includes explicit user approval for
  mutating operations; read-only operations may not require confirmation. (R3)
- Built-in tools include filesystem, shell, and web; confirmations and
  sandboxing are first-class. (R4)
- MCP integration includes tool discovery and execution with schema validation.
  (R5)

### OpenCode
- Open source AI coding agent, available via terminal, desktop app, or IDE
  extension. (R6)
- Encourages plan-first workflows before making changes. (R6)
- Built-in tool suite plus custom tools defined in config. (R7)
- Permission system: allow/ask/deny for each action and tool. (R8)
- MCP support for local/remote servers; MCP tools become available alongside
  built-in tools. (R9)
- Specialized agent configurations supported. (R10)

### Aider
- "AI pair programming in your terminal." (R11)
- Designed for editing code in a local git repo. (R12)
- Tightly integrated with git, including auto-commit workflows. (R13)
- Uses a repository map to provide code context to LLMs. (R14)

### OpenHands
- CLI experience intended to feel familiar to Claude Code or Codex, and can be
  powered by multiple LLMs. (R15)
- Provides a broader platform (SDK, CLI, GUI, cloud) for agentic workflows. (R15)

### Open Interpreter
- Runs code locally (Python, JavaScript, shell, etc.) and requires user
  approval before execution. (R16)

## Emerging standards and de facto patterns
### Tooling and interoperability
- MCP is positioned as an ecosystem protocol for exposing tools and data, and
  for connecting clients to servers. (R17)
- Gemini CLI and OpenCode both document MCP integration, tool discovery, and
  execution as part of their core architecture. (R5, R9)
- Claude Code explicitly calls out MCP for external tools. (R1)

### Safety and permissions
- OpenCode uses per-action permission rules (allow/ask/deny). (R8)
- Gemini CLI requires user approval for filesystem/shell mutation, while
  allowing read-only operations without confirmation. (R3)
- Open Interpreter asks for approval before running code. (R16)

### Planning and iterative execution
- OpenCode recommends plan-first workflows. (R6)
- ReAct formalizes the "reason-act-observe" loop that underpins agentic
  execution. (R18)
- Reflexion and Self-Refine show iterative self-correction as a standard
  reliability pattern for agents. (R19, R20)
- Tree-of-Thoughts formalizes deliberate multi-step planning. (R21)

### Context and retrieval
- Aider's repository map is an example of lightweight, structured context for
  codebases. (R14)
- Gemini CLI includes memory and todo tools as first-class capabilities. (R4)

### Evaluation and benchmarking
- SWE-bench and SWE-agent provide realistic software engineering benchmarks for
  autonomous systems. (R22, R23)
- AgentBench targets general agent evaluation across tasks. (R24)

## Research foundations (selected papers)
- ReAct: synergizes reasoning and acting via tool use. (R18)
- Toolformer: models can learn when and how to use tools. (R25)
- MRKL: modular architecture combining LLMs with external tools and knowledge.
  (R26)
- Reflexion: verbal reinforcement / self-reflection for agent improvement. (R19)
- Self-Refine: iterative refinement with model self-feedback. (R20)
- Tree of Thoughts: deliberate multi-step planning and search. (R21)
- SWE-bench / SWE-agent / AgentBench: evaluation baselines for tool-using
  agents. (R22, R23, R24)

## Reference architecture for HQL (long-term)
### High-level flow
User goal
  -> Goal intake (fast parser + LLM parser)
  -> Planner (task decomposition, risk classification)
  -> Executor loop (ReAct: act -> observe -> adjust)
  -> Tool registry (internal tools + MCP tools)
  -> Safety gate (allow/ask/deny + dry run)
  -> Observations (logs, diffs, status)
  -> Memory + retrieval (repo map, RAG)
  -> Response + optional HQL script output

### Core components
1. Goal intake
   - Hybrid parser: fast path for common patterns, LLM path for complex goals.
   - Explicit clarifications for ambiguous or risky requests.

2. Planner
   - Generates step-by-step plan with risk and tool requirements.
   - Presents plan for review when actions are mutating or destructive.

3. Executor loop
   - ReAct-style loop with observation and retry.
   - Error classification (tool error, environment error, model error).

4. Tooling layer
   - Internal tools with JSON-schema style definitions.
   - MCP client for external tools and resources.
   - Tool sandboxing where possible.

5. Safety and permissions
   - Policy rules (allow/ask/deny) per tool and per scope.
   - Dry-run support for file ops and destructive actions.
   - Explicit approval prompts for mutation (filesystem, shell, git).

6. Context and memory
   - Repository map (lightweight code index).
   - RAG-based retrieval across project docs, history, and prior tasks.
   - Preference memory for user-specific meanings (for example, "recent").

7. Editing subsystem
   - Diff-based edits, patch application, line-range edits.
   - Git-aware editing and rollback.

8. Observability and evaluation
   - Structured logs for tool calls, approvals, and outcomes.
   - Benchmark harness aligned to SWE-bench-style tasks.
   - Scenario tests for file ops, git workflows, and safety regressions.

### Implementation guardrails (fit for HQL)
- Use existing SSOT entry points for logging, HTTP, and filesystem access.
- Keep tool logic centralized; avoid duplicated implementations across layers.
- Build tool schemas once and reuse for planning, validation, and execution.

## Long-term roadmap (serious, non-MVP)
1. Foundation: tool registry + permission system + shell/filesystem tools
   - Build canonical tool schemas and permission policies.
   - Add safe patch editing and diff output.

2. Agent loop + planning
   - Plan generation, review UI, and ReAct execution.
   - Error recovery and retry logic.

3. Context and retrieval
   - Repository map and indexing.
   - RAG memory and preference storage.

4. Extensibility and standardization
   - MCP client + server support for external tools.
   - Tool SDK for user-defined tools.

5. Evaluation and production hardening
   - Benchmark harness, regressions, and audit logs.
   - Safety defaults, rollback support, and dry-run by default.

## References
R1  https://code.claude.com/docs/en/overview
R2  https://github.com/google-gemini/gemini-cli
R3  https://github.com/google-gemini/gemini-cli/blob/main/docs/architecture.md
R4  https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/index.md
R5  https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md
R6  https://opencode.ai/docs/
R7  https://opencode.ai/docs/tools/
R8  https://opencode.ai/docs/permissions/
R9  https://opencode.ai/docs/mcp-servers/
R10 https://opencode.ai/docs/agents/
R11 https://aider.chat/docs/
R12 https://aider.chat/docs/usage.html
R13 https://aider.chat/docs/git.html
R14 https://aider.chat/docs/repomap.html
R15 https://github.com/OpenHands/OpenHands
R16 https://github.com/OpenInterpreter/open-interpreter
R17 https://modelcontextprotocol.io/
R18 https://arxiv.org/abs/2210.03629
R19 https://arxiv.org/abs/2303.11366
R20 https://arxiv.org/abs/2303.17651
R21 https://arxiv.org/abs/2305.10601
R22 https://arxiv.org/abs/2310.06770
R23 https://arxiv.org/abs/2405.15793
R24 https://arxiv.org/abs/2308.03688
R25 https://arxiv.org/abs/2302.04761
R26 https://arxiv.org/abs/2205.00445
