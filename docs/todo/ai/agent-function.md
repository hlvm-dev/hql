# `agent` — Agent Loop Function

**Status**: IMPLEMENTED (as `ai.agent` method + `globalThis.agent` alias)
**File**: `src/hlvm/api/index.ts`
**Depends on**: `runAgentQuery()` from `src/hlvm/agent/agent-runner.ts`

---

## What It Is

A function that runs the **full HLVM agent loop** — multi-turn LLM conversation with tool access (file read/write, web search, shell execution, etc.). This is the same engine that powers the REPL's natural language mode, but **callable from HQL code**.

The key difference from `ai`: the `ai` function makes a single LLM call and returns. The `agent` function runs an iterative loop where the LLM can call tools, observe results, call more tools, and eventually produce a final answer.

## Signature

```
agent(prompt: string) → Promise<string>
agent(prompt: string, options: object) → Promise<string>
```

### Options Map

| Key     | Type     | Default          | Description                                    |
|---------|----------|------------------|------------------------------------------------|
| `data`  | any      | —                | Context data, JSON-stringified into the prompt |
| `model` | string   | default provider | Model override                                 |
| `tools` | [string] | all tools        | Tool allowlist (restrict available tools)       |

## How It Differs from `ai`

| Aspect        | `ai`                    | `agent`                              |
|---------------|-------------------------|--------------------------------------|
| LLM calls     | 1                       | Many (iterative ReAct loop)          |
| Tools         | None                    | Full toolset (file, web, shell, etc.)|
| Side effects  | None                    | Yes (creates files, runs commands)   |
| Use case      | Think / compute         | Do / act                             |
| Speed         | Fast (~1-3s)            | Slow (~10-60s)                       |
| Returns       | string or object        | string (final answer)                |
| Determinism   | High                    | Lower (tool results vary)            |

## How It Differs from REPL NL Mode

When you type bare text in the REPL (no `(` prefix), it goes to agent conversation mode. The `agent` function provides the **same capability from code**, with one critical advantage: **deterministic data injection**.

In NL mode:
```
show me a chart of the sentiment data
```
The agent has to GUESS what "sentiment data" means — search files, ask questions. Non-deterministic.

In code mode with `agent`:
```lisp
(agent "create a bar chart of sentiment distribution" {data: analyzed})
```
The data is **explicitly injected** as JSON. No guessing. The agent receives the exact data.

## Usage in HQL

```lisp
;; 1. Simple action — agent uses tools freely
(agent "find all TODO comments in the codebase and list them")
;; => "Found 12 TODOs:\n1. src/app.ts:42 — TODO: add validation\n..."

;; 2. With data — agent acts ON specific data
(def analyzed [{sentiment: "positive" score: 0.9}
               {sentiment: "negative" score: 0.2}])
(agent "create a visualization and save to charts/" {data: analyzed})
;; => "Created bar chart at charts/sentiment.png"

;; 3. Restricted tools — limit what the agent can do
(agent "summarize the README" {tools: ["read_file"]})
;; Agent can only read files, not write or execute

;; 4. Model override for complex tasks
(agent "refactor this to use async/await" {data: code model: "claude-sonnet"})

;; 5. Pipeline: ai → ai → agent
(generable Sentiment {
  sentiment: (case "positive" "negative" "neutral")
  score:     number})

(def extracted (await (concurrentMap
  (fn [r] (ai "analyze" {data: r schema: Sentiment}))
  reviews)))
(def summary (ai "what are the key patterns?" {data: extracted}))
(agent "write a report and save to reports/sentiment.md"
  {data: {analysis: extracted summary: summary}})
```

## Internal Flow

### Step 1: Build the prompt

```
fullPrompt = prompt
if options.data:
  fullPrompt += "\n\nData:\n" + JSON.stringify(options.data, null, 2)
```

### Step 2: Call `runAgentQuery()`

```typescript
const { runAgentQuery } = await import("../agent/agent-runner.ts");
const result = await runAgentQuery({
  query: fullPrompt,
  model: options?.model,
  toolAllowlist: options?.tools,
  callbacks: {},           // no streaming callbacks in code mode
  permissionMode: "auto",  // inherits REPL's current permission setting
});
```

### Step 3: Return

```
return result.text;  // the agent's final text response
```

The dynamic `import()` avoids circular dependency issues (index.ts → agent-runner.ts → orchestrator → registry → index.ts).

## Implementation in `index.ts`

Add to `registerApis()`:

```typescript
export function registerApis(options?: RegisterApisOptions): void {
  // ... existing registrations ...

  global.agent = async function (
    prompt: string,
    opts?: { data?: unknown; model?: string; tools?: string[] },
  ): Promise<string> {
    const { runAgentQuery } = await import("../agent/agent-runner.ts");

    let fullPrompt = prompt;
    if (opts?.data !== undefined) {
      fullPrompt += "\n\nData:\n" + JSON.stringify(opts.data, null, 2);
    }

    const result = await runAgentQuery({
      query: fullPrompt,
      model: opts?.model,
      toolAllowlist: opts?.tools,
      callbacks: {},
    });

    return result.text;
  };
}
```

## Error Cases

| Situation                      | Error Type     | Message                                    |
|--------------------------------|----------------|--------------------------------------------|
| No provider available          | `RuntimeError` | "No default AI provider configured"        |
| Agent loop fails               | `RuntimeError` | "Agent execution failed: {error}"          |
| Invalid tool name in allowlist | (silent)       | Tool simply not available to agent         |
| Agent produces no output       | `RuntimeError` | "Agent returned empty response"            |

## Test Plan

1. `agent("prompt")` calls `runAgentQuery` with correct query (mock runner)
2. `agent("prompt", {data: ...})` appends JSON data to prompt
3. `agent("prompt", {model: "gpt-4"})` passes model to runner
4. `agent("prompt", {tools: ["read_file"]})` passes tool allowlist
5. Return value is `result.text` from runner
6. Agent error propagates as RuntimeError
7. `globalThis.agent` is registered after `registerApis()` call
