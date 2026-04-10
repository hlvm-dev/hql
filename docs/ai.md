# AI API Reference

The `ai` object is the primary interface for LLM interaction in HQL. It follows
the callable-function-with-methods pattern (like axios or chalk) — `ai` itself
is a function you can call directly, AND it has methods attached as properties.

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

| Key           | Type        | Default          | Description                                   |
| ------------- | ----------- | ---------------- | --------------------------------------------- |
| `prompt`      | string      | (required)       | The user message                              |
| `data`        | any         | —                | Context data, JSON-stringified into prompt    |
| `schema`      | object      | —                | Expected response shape (triggers JSON parse) |
| `model`       | string      | default provider | e.g. `"ollama/llama3.2"`, `"openai/gpt-4"`    |
| `system`      | string      | —                | System prompt prepended as system message     |
| `temperature` | number      | provider default | Sampling temperature (0.0–2.0)                |
| `signal`      | AbortSignal | —                | Cancellation signal                           |

---

## `data` vs `schema` — The Core Concepts

**`data`** and **`schema`** serve opposite purposes:

|                  | `data`                                     | `schema`                                                   |
| ---------------- | ------------------------------------------ | ---------------------------------------------------------- |
| **Direction**    | **Input** — what the LLM sees              | **Output** — what the LLM returns                          |
| **What it does** | Appends `\n\nData:\n{json}` to your prompt | Sends schema to vendor API for native constrained decoding |
| **Return type**  | `string` (free-form text)                  | `object` (parsed JSON)                                     |
| **Purpose**      | Give the LLM context to work with          | Force the LLM to return structured data                    |

### The Four Modes

```
ai(prompt)                    → text in, text out
ai(prompt, {data})            → data in, text out
ai(prompt, {schema})          → text in, structured out
ai(prompt, {data, schema})    → data in, structured out   ← the power combo
```

### How the prompt is assembled

```
┌─────────────────────────────────────────────────────┐
│ system: "You are a pirate"     ← from {system}      │  (optional system message)
├─────────────────────────────────────────────────────┤
│ user:                                                │
│   "Classify this review"       ← your prompt         │
│                                                      │
│   Data:                        ← from {data}         │
│   {"text":"Great!","rating":5}                       │
├─────────────────────────────────────────────────────┤
│ output: Output.object(zodSchema) ← from {schema}    │  (native constrained decoding)
└─────────────────────────────────────────────────────┘
```

---

## Examples — Real E2E Verified Outputs

Every example below was verified against Claude Haiku 4.5 with real LLM
responses.

### Basic prompt — text in, text out

```lisp
(ai "What is 2+2? Reply with ONLY the number."
  {model: "claude-code/claude-haiku-4-5-20251001"})
```

```
"4"
```

### System prompt — persona control

```lisp
(ai "Say hello"
  {model: "claude-code/claude-haiku-4-5-20251001"
   system: "You are a pirate. Always say 'Arrr'."})
```

```
"Arrr, ahoy there, matey! Hello to ye! Welcome aboard!"
```

### `data` only — give context, get text back

```lisp
(ai "What is the person's name? Reply with ONLY the name."
  {model: "claude-code/claude-haiku-4-5-20251001"
   data: {person: {name: "Alice" age: 30}}})
```

```
"Alice"
```

The LLM sees:
`"What is the person's name?...\n\nData:\n{\"person\":{\"name\":\"Alice\",\"age\":30}}"`

It reads the data and extracts the answer. The response is a plain string.

### `schema` only — get structured JSON from LLM's knowledge

```lisp
(ai "Analyze sentiment of: 'I love sunny days'"
  {model: "claude-code/claude-haiku-4-5-20251001"
   schema: {sentiment: "positive|negative|neutral"
            confidence: "number 0-1"}})
```

```json
{ "sentiment": "positive", "confidence": 0.95 }
```

No `data` here — the LLM uses its own understanding. But `schema` forces a
structured JSON response instead of free text.

### `data` + `schema` — the power combo

```lisp
(ai "Classify each review as positive or negative"
  {model: "claude-code/claude-haiku-4-5-20251001"
   data: {reviews: [{text: "Amazing product!" rating: 5}
                    {text: "Terrible, broke on day one" rating: 1}]}
   schema: {results: [{text: "string" sentiment: "positive|negative"}]}})
```

```json
{
  "results": [
    { "text": "Amazing product!", "sentiment": "positive" },
    { "text": "Terrible, broke on day one", "sentiment": "negative" }
  ]
}
```

Data goes IN, structured JSON comes OUT.

---

## Schema Language

The schema is a plain JSON object that describes the shape of the response. The
LLM is instructed to return JSON matching this structure exactly.

### Type descriptors

| Descriptor                      | Meaning                | Example output            |
| ------------------------------- | ---------------------- | ------------------------- |
| `"string"`                      | Any string             | `"Tokyo"`                 |
| `"number"`                      | Any number             | `13960000`                |
| `"number 1-10"`                 | Number with hint range | `8`                       |
| `"number grams"`                | Number with unit hint  | `0.5`                     |
| `"boolean"`                     | true or false          | `false`                   |
| `"positive\|negative\|neutral"` | Enum — pick one        | `"positive"`              |
| `["string"]`                    | Array of strings       | `["Spring", "Autumn"]`    |
| `[{...}]`                       | Array of objects       | `[{name: "x", ...}, ...]` |
| `{key: "type"}`                 | Nested object          | `{lat: 35.6, lng: 139.6}` |

### Nesting — unlimited depth

```lisp
(ai "Describe Tokyo as a travel destination"
  {model: "claude-code/claude-haiku-4-5-20251001"
   schema: {city: "string"
            country: "string"
            population: "number"
            coordinates: {lat: "number" lng: "number"}
            bestSeasons: ["string"]
            topAttractions: [{name: "string"
                              category: "string"
                              rating: "number 1-5"}]}})
```

```json
{
  "city": "Tokyo",
  "country": "Japan",
  "population": 13960000,
  "coordinates": { "lat": 35.6762, "lng": 139.6503 },
  "bestSeasons": ["Spring", "Autumn"],
  "topAttractions": [
    { "name": "Senso-ji Temple", "category": "Historical", "rating": 4.8 },
    { "name": "Shibuya Crossing", "category": "Landmark", "rating": 4.5 }
  ]
}
```

### Arrays of complex objects

```lisp
(ai "List 3 famous scientists and their key contributions"
  {model: "claude-code/claude-haiku-4-5-20251001"
   schema: {scientists: [{name: "string"
                          nationality: "string"
                          field: "string"
                          born: "number"
                          contributions: ["string"]
                          isAlive: "boolean"}]}})
```

```json
{
  "scientists": [
    {
      "name": "Albert Einstein",
      "nationality": "German",
      "field": "Physics",
      "born": 1879,
      "contributions": ["Theory of Relativity", "E=mc2"],
      "isAlive": false
    },
    {
      "name": "Marie Curie",
      "nationality": "Polish",
      "field": "Physics/Chemistry",
      "born": 1867,
      "contributions": ["Radioactivity", "Discovered Polonium & Radium"],
      "isAlive": false
    },
    {
      "name": "Stephen Hawking",
      "nationality": "British",
      "field": "Physics",
      "born": 1942,
      "contributions": ["Black Hole Radiation", "A Brief History of Time"],
      "isAlive": false
    }
  ]
}
```

### Data + nested schema — real-world pattern

```lisp
(ai "Analyze each food item for nutrition"
  {model: "claude-code/claude-haiku-4-5-20251001"
   data: {items: [{name: "Apple" servingSize: "1 medium"}
                  {name: "Pizza slice" servingSize: "1 slice"}
                  {name: "Broccoli" servingSize: "1 cup"}]}
   schema: {analysis: [{name: "string"
                        calories: "number"
                        healthRating: "number 1-10"
                        macros: {protein: "number grams"
                                 carbs: "number grams"
                                 fat: "number grams"}
                        tags: ["string"]}]}})
```

```json
{
  "analysis": [
    {
      "name": "Apple",
      "calories": 95,
      "healthRating": 8,
      "macros": { "protein": 0.5, "carbs": 25, "fat": 0.3 },
      "tags": ["fruit", "fiber"]
    },
    {
      "name": "Pizza slice",
      "calories": 285,
      "healthRating": 4,
      "macros": { "protein": 12, "carbs": 36, "fat": 10 },
      "tags": ["processed", "carbs"]
    },
    {
      "name": "Broccoli",
      "calories": 55,
      "healthRating": 9,
      "macros": { "protein": 3.7, "carbs": 11, "fat": 0.6 },
      "tags": ["vegetable", "vitamin-c"]
    }
  ]
}
```

### Booleans + enums + constraints

```lisp
(ai "Evaluate Python as a programming language"
  {model: "claude-code/claude-haiku-4-5-20251001"
   schema: {language: "string"
            isCompiled: "boolean"
            isOpenSource: "boolean"
            typingSystem: "static|dynamic|gradual"
            yearCreated: "number"
            popularityRank: "number 1-20"
            paradigms: ["string"]
            pros: ["string"]
            cons: ["string"]}})
```

```json
{
  "language": "Python",
  "isCompiled": false,
  "isOpenSource": true,
  "typingSystem": "dynamic",
  "yearCreated": 1991,
  "popularityRank": 1,
  "paradigms": ["object-oriented", "procedural", "functional"],
  "pros": ["Easy to learn", "Large ecosystem", "Versatile"],
  "cons": ["Slow execution", "GIL limitations", "Mobile development"]
}
```

### Recursive-like structures (org chart)

```lisp
(ai "Create a company org chart: CEO, 2 departments, each with a manager and 2 employees"
  {model: "claude-code/claude-haiku-4-5-20251001"
   schema: {company: "string"
            ceo: {name: "string"
                  title: "string"
                  departments: [{name: "string"
                                 manager: {name: "string" title: "string"}
                                 employees: [{name: "string" role: "string"}]}]}}})
```

```json
{
  "company": "TechVision Solutions",
  "ceo": {
    "name": "Sarah Chen",
    "title": "CEO",
    "departments": [
      {
        "name": "Engineering",
        "manager": { "name": "James Miller", "title": "VP Engineering" },
        "employees": [
          { "name": "Alex Kim", "role": "Senior Developer" },
          { "name": "Priya Patel", "role": "DevOps Engineer" }
        ]
      },
      {
        "name": "Marketing",
        "manager": { "name": "Lisa Wang", "title": "VP Marketing" },
        "employees": [
          { "name": "Tom Brown", "role": "Content Strategist" },
          { "name": "Emma Davis", "role": "SEO Analyst" }
        ]
      }
    ]
  }
}
```

### Many-field stress test (RPG character)

```lisp
(ai "Describe a fictional character for a fantasy RPG game"
  {model: "claude-code/claude-haiku-4-5-20251001"
   schema: {name: "string"
            race: "human|elf|dwarf|orc"
            class: "warrior|mage|rogue|healer"
            level: "number 1-100"
            hitPoints: "number"
            stats: {strength: "number 1-20"
                    intelligence: "number 1-20"
                    dexterity: "number 1-20"
                    wisdom: "number 1-20"
                    charisma: "number 1-20"}
            inventory: [{item: "string"
                         quantity: "number"
                         isEquipped: "boolean"}]
            backstory: "string"}})
```

```json
{
  "name": "Kael Shadowblade",
  "race": "elf",
  "class": "rogue",
  "level": 18,
  "hitPoints": 142,
  "stats": {
    "strength": 14,
    "intelligence": 16,
    "dexterity": 19,
    "wisdom": 13,
    "charisma": 15
  },
  "inventory": [
    { "item": "Shadow Dagger", "quantity": 2, "isEquipped": true },
    { "item": "Lockpick Set", "quantity": 1, "isEquipped": true },
    { "item": "Health Potion", "quantity": 5, "isEquipped": false }
  ],
  "backstory": "Once a noble's son in the elven city of Silvervale, Kael turned to the shadows after..."
}
```

### Schema handling internals

Schema enforcement uses native vendor constrained decoding via AI SDK (v2):

1. The schema descriptor is converted to a Zod schema (`schema-to-zod.ts`)
2. AI SDK's `generateText` + `Output.object()` sends the schema to the vendor
   API
3. The vendor constrains token sampling to produce guaranteed valid JSON
4. The result is parsed and validated by Zod automatically — no `JSON.parse`
   needed
5. Works across all SDK-supported providers (OpenAI, Anthropic, Google, Ollama)

---

## `ai.chat(messages, options?)`

Streaming chat completion. Returns an `AsyncGenerator` that yields string chunks
as they arrive.

```lisp
;; Streaming output
(for [chunk (ai.chat [{role: "user" content: "tell me a story"}]
                      {model: "claude-code/claude-haiku-4-5-20251001"})]
  (print chunk))
;; Prints chunks as they arrive: "Once" "upon" "a" "time" ...

;; Multi-turn with system message
(ai.chat [{role: "system" content: "You are helpful"}
           {role: "user" content: "Hi"}]
  {model: "ollama/llama3.2"})
```

### Parameters

- `messages` — Array of `{role: "system"|"user"|"assistant", content: string}`
- `options` — `ChatOptions` (model, signal, raw provider options, tools, etc.)

---

## `ai.chatStructured(messages, options?)`

Non-streaming chat that returns structured tool calls alongside text content.
Used for native function calling.

```lisp
(def result (ai.chatStructured
  [{role: "user" content: "Say hello"}]
  {model: "claude-code/claude-haiku-4-5-20251001"}))

result.content    ;; "Hello! How can I help you today?"
result.toolCalls  ;; []
```

### Returns

```typescript
{ content: string, toolCalls: ToolCall[] }
```

Throws `ValidationError` if the provider doesn't support native tool calling.

---

## `ai.agent(prompt, options?)` / `agent(prompt, options?)`

Runs the full ReAct agent loop — the agent can use tools, read files, execute
commands, and reason through multi-step tasks. Returns the final answer as a
string.

`agent` is a top-level alias for `ai.agent` — they are the same function
reference.

### Parameters

| Key      | Type        | Default    | Description                    |
| -------- | ----------- | ---------- | ------------------------------ |
| `prompt` | string      | (required) | Task description               |
| `data`   | any         | —          | Context data appended to query |
| `model`  | string      | default    | Model to use for the agent     |
| `tools`  | string[]    | all        | Allowlist of tool names        |
| `signal` | AbortSignal | —          | Cancellation signal            |

### Examples

```lisp
;; Factual question
(agent "What is the capital of South Korea? Reply in one sentence."
  {model: "claude-code/claude-haiku-4-5-20251001"})
;; => "The capital of South Korea is Seoul."

;; Math
(agent "What is 15 * 17? Reply with only the number."
  {model: "claude-code/claude-haiku-4-5-20251001"})
;; => "255"

;; File tasks (uses tools automatically)
(agent "list all TypeScript files in src/ and count them")

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
(ai.models.list "claude-code")  ;; => 18 models

;; List from all providers
(ai.models.listAll)
(ai.models.listAll {includeCloud: true})

;; Get model info
(ai.models.get "llama3.1:8b")          ;; found
(ai.models.get "nonexistent-model")     ;; null

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
(ai.status "claude-code")
;; => {available: true}

(ai.status "ollama")
;; => {available: true}

(ai.status "nonexistent")
;; => {available: false, error: "Provider 'nonexistent' not found"}
```

---

## Async Higher-Order Functions

Five async HOFs for composing AI calls over collections. Available on
`globalThis` via stdlib.

All handle `null`/`undefined` input gracefully (return `[]` or `init` for
reduce).

### `asyncMap(fn, coll)` — Sequential

Maps an async function over a collection one element at a time. Each call
completes before the next starts. Rate-limit safe.

```lisp
(asyncMap
  (fn [fruit]
    (ai (str "What color is a " fruit "? ONLY the color, one word.")
        {model: "claude-code/claude-haiku-4-5-20251001"}))
  ["apple" "banana" "cherry"])
;; => ["Red", "Yellow", "Red"]
```

Processes apple → waits → banana → waits → cherry. Sequential order guaranteed.

### `concurrentMap(fn, coll)` — Parallel

Maps an async function with all calls fired simultaneously via `Promise.all`.
Maximum throughput.

```lisp
(concurrentMap
  (fn [animal]
    (ai (str "How many legs does a " animal " have? ONLY the number.")
        {model: "claude-code/claude-haiku-4-5-20251001"}))
  ["dog" "cat" "fish"])
;; => ["4", "4", "0"]
```

All 3 calls fire at once. ~2.6s total vs ~7s sequential for 3 items.

### `asyncFilter(fn, coll)` — Async Predicate

Filters a collection using an async predicate. Sequential evaluation.

```lisp
(asyncFilter
  (fn [lang]
    (-> (ai (str "Is \"" lang "\" a programming language? ONLY yes or no.")
            {model: "claude-code/claude-haiku-4-5-20251001"})
        (.trim) (.toLowerCase) (.startsWith "yes")))
  ["Python" "English" "Rust" "French"])
;; => ["Python", "Rust"]
```

English and French are filtered out. Python and Rust kept.

### `asyncReduce(fn, init, coll)` — Async Accumulator

Reduces a collection with an async function. Each step awaits before proceeding.

```lisp
(asyncReduce
  (fn [acc fact]
    (ai (str "Current summary: \"" acc "\". Add fact: \"" fact "\". Combined 1-sentence summary.")
        {model: "claude-code/claude-haiku-4-5-20251001"}))
  ""
  ["The Earth orbits the Sun"
   "Water boils at 100 degrees Celsius"
   "Light travels at 300000 km/s"])
;; => "The Earth orbits the Sun, water boils at 100 degrees Celsius, and light travels at 300,000 km/s."
```

3 facts accumulated into one running summary, step by step.

### `asyncFlatMap(fn, coll)` — Async Map + Flatten

Maps an async function that returns arrays, then flattens one level.

```lisp
(asyncFlatMap
  (fn [topic]
    (-> (ai (str "List exactly 3 " topic ". ONLY names, comma-separated.")
            {model: "claude-code/claude-haiku-4-5-20251001"})
        (.trim) (.split ",") (.map (fn [s] (.trim s)))))
  ["fruits" "planets"])
;; => ["Apple", "Banana", "Orange", "Mercury", "Venus", "Earth"]
```

2 topics → 3 items each → 6 items flat.

### Comparison

| Function        | Execution  | Use When                                      |
| --------------- | ---------- | --------------------------------------------- |
| `asyncMap`      | Sequential | Rate-limited APIs, order-dependent processing |
| `concurrentMap` | Parallel   | Max throughput, independent items             |
| `asyncFilter`   | Sequential | AI-powered filtering/classification           |
| `asyncReduce`   | Sequential | Accumulative summarization, chaining          |
| `asyncFlatMap`  | Sequential | One-to-many async expansion                   |

### Null safety

```lisp
(asyncMap identity null)       ;; => []
(concurrentMap identity null)  ;; => []
(asyncFilter identity null)    ;; => []
(asyncReduce + "init" null)    ;; => "init"
(asyncFlatMap vector null)     ;; => []
```

---

## Composition Patterns

### Pipeline: classify then summarize

```lisp
(def reviews ["great product" "terrible quality" "it's okay"])

(def sentiments (await (asyncMap
  (fn [r] (ai "classify" {data: r
                           model: "claude-code/claude-haiku-4-5-20251001"
                           schema: {sentiment: "string" score: "number"}}))
  reviews)))

(def summary (ai "summarize these results"
  {data: sentiments model: "claude-code/claude-haiku-4-5-20251001"}))
```

### Batch structured extraction

```lisp
(asyncMap
  (fn [sentence]
    (ai "Extract the key facts"
      {model: "claude-code/claude-haiku-4-5-20251001"
       data: {sentence: sentence}
       schema: {subject: "string"
                location: "string"
                keyFact: "string"
                numericValue: "number"}}))
  ["The Eiffel Tower in Paris was built in 1889"
   "Mount Fuji in Japan is 3776 meters tall"
   "The Great Wall of China spans over 20000 km"])
;; => [
;;   {subject: "Eiffel Tower", location: "Paris", keyFact: "built in 1889", numericValue: 1889},
;;   {subject: "Mount Fuji", location: "Japan", keyFact: "3776 meters tall", numericValue: 3776},
;;   {subject: "The Great Wall of China", location: "China", keyFact: "spans over 20000 km", numericValue: 20000}
;; ]
```

### Concurrent batch processing

```lisp
(def translations (await (concurrentMap
  (fn [text] (ai "translate to Korean" {data: text model: "claude-code/claude-haiku-4-5-20251001"}))
  paragraphs)))
```

### Filter + Map chain

```lisp
(def negative (await (asyncFilter
  (fn [r]
    (-> (ai "is this negative? reply yes/no" {data: r model: "claude-code/claude-haiku-4-5-20251001"})
        (.trim) (.toLowerCase) (.startsWith "yes")))
  reviews)))

(def fixes (await (asyncMap
  (fn [r] (ai "suggest how to address this complaint" {data: r model: "claude-code/claude-haiku-4-5-20251001"}))
  negative)))
```

### Accumulative summary

```lisp
(def final (await (asyncReduce
  (fn [summary chunk]
    (ai "incorporate this new information into the running summary"
      {data: {summary: summary newInfo: chunk}
       model: "claude-code/claude-haiku-4-5-20251001"}))
  "No information yet."
  dataChunks)))
```

---

## Provider Model Strings

Format: `provider/model-name`

| Provider    | Example                                 | Notes                                |
| ----------- | --------------------------------------- | ------------------------------------ |
| Ollama      | `ollama/llama3.1:8b`                    | Local, colons are part of model name |
| OpenAI      | `openai/gpt-4`                          | Requires API key                     |
| Anthropic   | `anthropic/claude-sonnet-4-20250514`    | Requires API key                     |
| Google      | `google/gemini-pro`                     | Requires API key                     |
| Claude Code | `claude-code/claude-haiku-4-5-20251001` | Max subscription, no API key         |

If no provider prefix is given, the default provider is used.

---

## Errors

| Situation                  | Error Type        | Message                                         |
| -------------------------- | ----------------- | ----------------------------------------------- |
| No provider available      | `RuntimeError`    | "No default AI provider configured"             |
| Unknown model/provider     | `RuntimeError`    | "No provider found for model: ..."              |
| Schema response isn't JSON | `ValidationError` | "AI response is not valid JSON: ..."            |
| No tool calling support    | `ValidationError` | "Provider does not support native tool calling" |

---

## Source Files

| File                                   | What                             |
| -------------------------------------- | -------------------------------- |
| `src/hlvm/api/ai.ts`                   | Core `ai` callable + all methods |
| `src/hlvm/api/index.ts`                | `agent` alias + `registerApis()` |
| `src/common/stream-utils.ts`           | `collectAsyncGenerator` utility  |
| `src/hql/lib/stdlib/js/core.js`        | 5 async HOFs                     |
| `tests/unit/api/ai-callable.test.ts`   | 17 behavioral unit tests         |
| `tests/unit/stdlib/async-hofs.test.ts` | 15 async HOF unit tests          |
