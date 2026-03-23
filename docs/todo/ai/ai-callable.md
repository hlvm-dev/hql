# `ai` — Callable AI Function

**Status**: TODO
**File**: `src/hlvm/api/ai.ts`
**Depends on**: Existing provider infrastructure (unchanged)

---

## What It Is

`globalThis.ai` is currently a plain object with methods (`ai.chat`, `ai.models`, `ai.status`).
This change makes `ai` **callable as a function** while preserving all existing methods as properties.

In JavaScript, functions are objects — you can attach properties to them. So `ai("prompt")` works AND `ai.chat(messages)` still works. No breaking changes.

## Signature

```
ai(prompt: string) → Promise<string>
ai(prompt: string, options: object) → Promise<string | object>
```

### Options Map

| Key           | Type     | Default          | Description                              |
|---------------|----------|------------------|------------------------------------------|
| `data`        | any      | —                | Context data, JSON-stringified into prompt |
| `schema`      | object   | —                | JSON Schema object (from `generable`)    |
| `model`       | string   | default provider | e.g. `"gpt-4"`, `"ollama/llama3.2"`     |
| `system`      | string   | —                | System prompt                            |
| `temperature` | number   | provider default | 0.0–2.0                                  |

## Usage in HQL

```lisp
;; Level 1: Simple prompt → string
(ai "what is the capital of France")
;; => "Paris"

;; Level 2: With data context → string
(def article "Long article text...")
(ai "summarize in 3 bullets" {data: article})
;; => "• Point 1\n• Point 2\n• Point 3"

;; Level 3: With generable schema → typed object
(generable Sentiment {
  sentiment: (case "positive" "negative" "neutral")
  score:     {type: number  min: 0  max: 1}})

(def result (await (ai "analyze" {data: "I love this!" schema: Sentiment})))
result.sentiment  ;; "positive"
result.score      ;; 0.92

;; Level 4: With model override
(ai "translate to Korean" {data: "hello" model: "gpt-4"})

;; Level 5: With system prompt
(ai "be concise" {data: text system: "You are a technical writer"})

;; Level 6: Composition with existing code
(def reviews ["great product" "terrible" "it's okay"])
(def analyzed (await (concurrentMap
  (fn [r] (ai "analyze" {data: r schema: Sentiment}))
  reviews)))

;; Level 7: Pipeline with threading
(-> article
    ((fn [t] (ai "extract facts" {data: t})))
    ((fn [f] (ai "which is most surprising?" {data: f}))))

;; Level 8: Error handling
(try
  (ai "analyze" {data: text schema: Sentiment})
  (catch e (print "Failed:" e.message)))
```

## Infrastructure Methods (Unchanged)

These continue to work exactly as before:

```lisp
(ai.chat [{role: "user" content: "Hello"}])           ;; AsyncGenerator<string>
(ai.chatStructured [{role: "user" content: "Hi"}])     ;; Promise<{content, toolCalls}>
(ai.models.list)                                        ;; Promise<ModelInfo[]>
(ai.models.listAll)                                     ;; Promise<ModelInfo[]>
(ai.models.get "llama3.2")                              ;; Promise<ModelInfo | null>
(ai.models.catalog)                                     ;; Promise<ModelInfo[]>
(ai.models.pull "llama3.2")                             ;; AsyncGenerator<PullProgress>
(ai.models.remove "llama3.2")                           ;; Promise<boolean>
(ai.status)                                             ;; Promise<ProviderStatus>
```

## Internal Flow

### Step 1: Build messages array

```
messages = []

if options.system:
  messages.push({role: "system", content: options.system})

userContent = prompt
if options.data:
  userContent += "\n\nData:\n" + JSON.stringify(options.data, null, 2)
if options.schema:
  userContent += "\n\nRespond in JSON matching this exact schema:\n" + JSON.stringify(options.schema)

messages.push({role: "user", content: userContent})
```

### Step 2: Call provider

```
provider = getProviderOrThrow(options.model)

if options.schema:
  // Structured output — request JSON format
  result = collect(provider.chat(messages, {format: "json", temperature: options.temperature}))
  return JSON.parse(result)
else:
  // Plain string
  result = collect(provider.chat(messages, {temperature: options.temperature}))
  return result
```

Where `collect` drains the AsyncGenerator into a single string.

### Step 3: Return

- No schema → `string`
- With schema → parsed `object` matching the schema

## Implementation in `ai.ts`

Current `createAiApi()` returns a plain object (line 108). Change to:

```typescript
function createAiApi() {
  // ... existing helpers (getProviderOrThrow, resolveModelName, etc.) ...

  // The callable function
  const aiFn = async function (
    prompt: string,
    options?: { data?: unknown; schema?: Record<string, unknown>; model?: string; system?: string; temperature?: number },
  ): Promise<string | Record<string, unknown>> {
    const provider = getProviderOrThrow(options?.model);

    // Build messages
    const messages: Message[] = [];
    if (options?.system) {
      messages.push({ role: "system", content: options.system });
    }
    let userContent = prompt;
    if (options?.data !== undefined) {
      userContent += "\n\nData:\n" + JSON.stringify(options.data, null, 2);
    }
    if (options?.schema) {
      userContent += "\n\nRespond in JSON matching this exact schema:\n" + JSON.stringify(options.schema);
    }
    messages.push({ role: "user", content: userContent });

    // Call provider
    const opts = toProviderOptions({
      model: options?.model,
      format: options?.schema ? "json" : undefined,
      temperature: options?.temperature,
    });
    let result = "";
    for await (const chunk of provider.chat(messages, opts)) {
      result += chunk;
    }

    // Parse if schema
    if (options?.schema) {
      return JSON.parse(result);
    }
    return result;
  };

  // Attach infrastructure methods as properties
  aiFn.chat = async function* (...) { /* existing */ };
  aiFn.chatStructured = async function (...) { /* existing */ };
  aiFn.models = { /* existing */ };
  aiFn.status = (...) => { /* existing */ };

  return aiFn;
}
```

## Error Cases

| Situation                        | Error Type        | Message                                              |
|----------------------------------|-------------------|------------------------------------------------------|
| No provider available            | `RuntimeError`    | "No default AI provider configured"                  |
| Provider API fails               | `RuntimeError`    | "AI completion failed: {provider error}"             |
| Schema response isn't valid JSON | `ValidationError` | "AI returned invalid JSON for structured output"     |
| Empty response                   | `RuntimeError`    | "AI returned empty response"                         |

## Test Plan

1. `ai("prompt")` returns a string (mock provider)
2. `ai("prompt", {data: ...})` includes data in the user message
3. `ai("prompt", {schema: ...})` sets `format: "json"` and parses response
4. `ai("prompt", {model: "gpt-4"})` routes to correct provider
5. `ai("prompt", {system: "..."})` prepends system message
6. `ai.chat(...)` still works (backward compat)
7. `ai.models.list()` still works (backward compat)
8. `ai.status()` still works (backward compat)
9. Invalid JSON response with schema → ValidationError
10. No provider configured → RuntimeError
