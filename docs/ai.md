# AI API Reference

The `ai` object is the primary interface for LLM interaction in HQL. It follows the callable-function-with-methods pattern (like axios or chalk) — `ai` itself is a function you can call directly, AND it has methods attached as properties.

Available on `globalThis` after REPL initialization. No imports needed.

---

## Quick Reference

```
ai(prompt)                              → Promise<string>
ai(prompt, {data, schema, ...})         → Promise<string | object>
ai.chat(messages, options?)             → AsyncGenerator<string>
ai.chatStructured(messages, options?)   → Promise<{content, toolCalls}>
ai.agent(prompt, options?)              → Promise<string>
agent(prompt, options?)                 → same as ai.agent (top-level alias)
ai.models.list(provider?)              → Promise<ModelInfo[]>
ai.models.listAll(options?)            → Promise<ModelInfo[]>
ai.models.get(name, provider?)         → Promise<ModelInfo | null>
ai.models.catalog(provider?)           → Promise<ModelInfo[]>
ai.models.pull(name, provider?)        → AsyncGenerator<PullProgress>
ai.models.remove(name, provider?)      → Promise<boolean>
ai.status(provider?)                   → Promise<ProviderStatus>
```

---

## `ai(prompt, options?)`

Single LLM call. Returns a string or parsed object depending on options.

### Parameters

| Key           | Type     | Default          | Description                              |
|---------------|----------|------------------|------------------------------------------|
| `prompt`      | string   | (required)       | The user message                         |
| `data`        | any      | —                | Context data, JSON-stringified into prompt |
| `schema`      | object   | —                | Expected response shape (triggers JSON parse) |
| `model`       | string   | default provider | e.g. `"ollama/llama3.2"`, `"openai/gpt-4"` |
| `system`      | string   | —                | System prompt prepended as system message |
| `temperature` | number   | provider default | Sampling temperature (0.0–2.0)           |
| `signal`      | AbortSignal | —             | Cancellation signal                      |

### Examples

```lisp
;; Simple prompt → string
(ai "what is the capital of France")
;; => "Paris"

;; With data context
(def article "Long article text here...")
(ai "summarize in 3 bullets" {data: article})
;; => "- Point 1\n- Point 2\n- Point 3"

;; Structured output via schema
(ai "classify" {data: "I love this!" schema: {sentiment: "string" score: "number"}})
;; => {sentiment: "positive", score: 0.92}

;; System prompt
(ai "be concise" {data: text system: "You are a technical writer"})

;; Model override
(ai "translate to Korean" {data: "hello" model: "openai/gpt-4"})

;; Temperature control
(ai "write a creative story" {temperature: 0.9})
```

### How It Works

1. Build messages array:
   - If `system` provided → prepend `{role: "system", content: system}`
   - User message = `prompt` + optional `"\n\nData:\n" + JSON.stringify(data)` + optional schema instruction
2. Call `provider.chat(messages, options)` — streams response
3. Collect all chunks into a single string via `collectAsyncGenerator`
4. If `schema` provided → strip markdown code fences → `JSON.parse` → return object
5. No schema → return string

### Schema Handling (v1)

Schema enforcement is prompt-based: the schema object is appended as a JSON instruction in the user message. The LLM is asked to respond with raw JSON only.

- Markdown code fences (`\`\`\`json ... \`\`\``) are stripped before parsing
- `JSON.parse` failure throws `ValidationError`
- For reliable structured output with complex schemas, use a frontier model (Claude, GPT-4)

### Errors

| Situation                    | Error Type        | Message                                    |
|------------------------------|-------------------|--------------------------------------------|
| No provider available        | `RuntimeError`    | "No default AI provider configured"        |
| Unknown model/provider       | `RuntimeError`    | "No provider found for model: ..."         |
| Schema response isn't JSON   | `ValidationError` | "AI response is not valid JSON: ..."       |

---

## `ai.chat(messages, options?)`

Streaming chat completion. Returns an `AsyncGenerator` that yields string chunks as they arrive from the provider.

```lisp
;; Streaming output
(for [chunk (ai.chat [{role: "user" content: "tell me a story"}])]
  (print chunk))

;; With options
(ai.chat [{role: "system" content: "You are helpful"}
           {role: "user" content: "Hi"}]
  {model: "ollama/llama3.2"})
```

### Parameters

- `messages` — Array of `{role: "system"|"user"|"assistant", content: string}`
- `options` — `ChatOptions` (model, signal, raw provider options, tools, etc.)

---

## `ai.chatStructured(messages, options?)`

Non-streaming chat that returns structured tool calls alongside text content. Used for native function calling with providers that support it.

```lisp
(def result (ai.chatStructured [{role: "user" content: "what's the weather?"}]
  {tools: [...]}))
result.content    ;; "Let me check..."
result.toolCalls  ;; [{name: "get_weather", arguments: {city: "Seoul"}}]
```

### Returns

```typescript
{ content: string, toolCalls: ToolCall[] }
```

Throws `ValidationError` if the provider doesn't support native tool calling.

---

## `ai.agent(prompt, options?)` / `agent(prompt, options?)`

Runs the full ReAct agent loop — the agent can use tools, read files, execute commands, and reason through multi-step tasks. Returns the final answer as a string.

`agent` is a top-level alias for `ai.agent` — they are the same function.

### Parameters

| Key      | Type     | Default  | Description                          |
|----------|----------|----------|--------------------------------------|
| `prompt` | string   | (required) | Task description                   |
| `data`   | any      | —        | Context data appended to query       |
| `model`  | string   | default  | Model to use for the agent           |
| `tools`  | string[] | all      | Allowlist of tool names              |
| `signal` | AbortSignal | —     | Cancellation signal                  |

### Examples

```lisp
;; Simple task
(agent "list all TypeScript files in src/ and count them")
;; => "There are 47 TypeScript files in src/..."

;; With data
(ai.agent "analyze this error" {data: errorLog})

;; Restricted tools
(ai.agent "read the README" {tools: ["read_file"]})
```

### How It Works

1. Builds query: `prompt` + optional data injection
2. Dynamic imports `runAgentQuery` (avoids circular deps)
3. Runs the ReAct loop: think → act (tool call) → observe → repeat
4. Returns `result.text` — the agent's final answer

The agent runs non-interactively (`noInput: true`, `callbacks: {}`).

---

## `ai.models`

Model management interface.

```lisp
;; List local models
(ai.models.list)
(ai.models.list "ollama")

;; List from all providers
(ai.models.listAll)
(ai.models.listAll {includeCloud: true})

;; Get model info
(ai.models.get "llama3.2")
(ai.models.get "gpt-4" "openai")

;; Browse available models (catalog/registry)
(ai.models.catalog)
(ai.models.catalog "openai")

;; Pull a model (Ollama)
(for [progress (ai.models.pull "llama3.2")]
  (print progress.status progress.completed "/" progress.total))

;; Remove a model
(ai.models.remove "old-model")
```

---

## `ai.status(provider?)`

Check provider availability.

```lisp
(ai.status)           ;; default provider
;; => {available: true}

(ai.status "ollama")
;; => {available: true}

(ai.status "nonexistent")
;; => {available: false, error: "Provider 'nonexistent' not found"}
```

---

## Async Higher-Order Functions

Five async HOFs for composing AI calls over collections. Available on `globalThis` via stdlib.

All handle `null`/`undefined` input gracefully (return `[]` or `init` for reduce).

### `asyncMap(fn, coll)` — Sequential

Maps an async function over a collection one element at a time. Each call completes before the next starts. Rate-limit safe.

```lisp
(def results (await (asyncMap
  (fn [r] (ai "analyze sentiment" {data: r}))
  reviews)))
;; Processes reviews[0], waits, then reviews[1], waits, ...
```

### `concurrentMap(fn, coll)` — Parallel

Maps an async function over a collection with all calls fired simultaneously via `Promise.all`. Maximum throughput, but may hit rate limits on large collections.

```lisp
(def results (await (concurrentMap
  (fn [r] (ai "translate" {data: r}))
  sentences)))
;; All translations start at once, resolve in parallel
```

### `asyncFilter(fn, coll)` — Async Predicate

Filters a collection using an async predicate. Sequential evaluation.

```lisp
(def relevant (await (asyncFilter
  (fn [doc] (ai "is this relevant to quantum physics? reply true/false" {data: doc}))
  documents)))
```

### `asyncReduce(fn, init, coll)` — Async Accumulator

Reduces a collection with an async function. Each step awaits before proceeding.

```lisp
(def summary (await (asyncReduce
  (fn [acc item] (ai "combine these summaries" {data: {previous: acc current: item}}))
  ""
  sections)))
```

### `asyncFlatMap(fn, coll)` — Async Map + Flatten

Maps an async function that returns arrays, then flattens one level.

```lisp
(def allTags (await (asyncFlatMap
  (fn [article] (ai "extract tags as JSON array" {data: article schema: {tags: "string[]"}}))
  articles)))
;; Each article yields multiple tags, all flattened into one array
```

### Comparison

| Function | Execution | Use When |
|----------|-----------|----------|
| `asyncMap` | Sequential | Rate-limited APIs, order-dependent processing |
| `concurrentMap` | Parallel | Max throughput, independent items |
| `asyncFilter` | Sequential | AI-powered filtering/classification |
| `asyncReduce` | Sequential | Accumulative summarization, chaining |
| `asyncFlatMap` | Sequential | One-to-many async expansion |

---

## Composition Patterns

### Pipeline: Analyze then Summarize

```lisp
(def reviews ["great product" "terrible quality" "it's okay"])

(def sentiments (await (asyncMap
  (fn [r] (ai "classify" {data: r schema: {sentiment: "string" score: "number"}}))
  reviews)))

(def summary (ai "summarize these results" {data: sentiments}))
```

### Concurrent Batch Processing

```lisp
(def translations (await (concurrentMap
  (fn [text] (ai "translate to Korean" {data: text}))
  paragraphs)))
```

### Filter + Map Chain

```lisp
(def negative (await (asyncFilter
  (fn [r] (let [s (await (ai "is this negative? reply true/false" {data: r}))]
    (= s "true")))
  reviews)))

(def fixes (await (asyncMap
  (fn [r] (ai "suggest how to address this complaint" {data: r}))
  negative)))
```

### Accumulative Summary

```lisp
(def final (await (asyncReduce
  (fn [summary chunk]
    (ai "incorporate this new information into the running summary"
      {data: {summary: summary newInfo: chunk}}))
  "No information yet."
  dataChunks)))
```

---

## Provider Model Strings

Format: `provider/model-name`

| Provider | Example | Notes |
|----------|---------|-------|
| Ollama | `ollama/llama3.1:8b` | Local, colons are part of model name |
| OpenAI | `openai/gpt-4` | Requires API key |
| Anthropic | `anthropic/claude-sonnet-4-20250514` | Requires API key |
| Google | `google/gemini-pro` | Requires API key |
| Claude Code | `claude-code/claude-haiku-4-5-20251001` | Max subscription, no API key |

If no provider prefix is given, the default provider is used (typically Ollama).

---

## Source Files

| File | What |
|------|------|
| `src/hlvm/api/ai.ts` | Core `ai` callable + all methods |
| `src/hlvm/api/index.ts` | `agent` alias + `registerApis()` |
| `src/common/stream-utils.ts` | `collectAsyncGenerator` utility |
| `src/hql/lib/stdlib/js/core.js` | 5 async HOFs |
| `tests/unit/api/ai-callable.test.ts` | 19 behavioral tests (mock provider) |
| `tests/unit/common/stream-utils.test.ts` | 3 stream utility tests |
| `tests/unit/stdlib/async-hofs.test.ts` | 15 async HOF tests |
