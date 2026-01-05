# HQL Memory Persistence

> *"Programming as a living system, not a series of disposable sessions."*

## Vision

HQL Memory brings a **Smalltalk-inspired "living system" experience** to a text-based, git-friendly workflow. When you define values or functions in the REPL, they persist across sessions - your development environment remembers what you've built.

This is part of HQL's broader philosophy:
- **HQL = Brain** - Pure, cross-platform language logic
- **HLVM = Experience** - Premium native macOS interface
- **Together = Power** - Each works independently, but together they're greater

Think of it like a game:
- **HQL functions** = items/potions you collect
- **HLVM** = inventory UI to organize them
- **Shortcuts** = your hotbar
- **Problems** = monsters to defeat

Your memory persists between gaming sessions. So should your programming environment.

---

## How It Works

### The `def` and `defn` Keywords

HQL introduces two new keywords for persistent definitions:

```hql
; Define a persistent value
(def api-key "sk-xxx")

; Define a persistent function
(defn greet [name]
  (str "Hello " name))
```

These work exactly like `const` and `fn`, but with one key difference: **they automatically persist to `~/.hql/memory.hql`**.

### Persistence Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         REPL Session                            │
│                                                                 │
│   > (def api-key "sk-xxx")                                      │
│   > (defn greet [name] (str "Hello " name))                     │
│                                                                 │
│         │                                                       │
│         │ auto-persist on definition                            │
│         ▼                                                       │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  ~/.hql/memory.hql                                      │   │
│   │                                                         │   │
│   │  ; HQL Memory - auto-persisted definitions              │   │
│   │  (def api-key "sk-xxx")                                 │   │
│   │  (defn greet [name] (str "Hello " name))                │   │
│   │                                                         │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│         │                                                       │
│         │ load on next REPL startup                             │
│         ▼                                                       │
│                                                                 │
│   Environment restored. api-key and greet exist.                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Value Serialization (def)

For `def`, we store the **evaluated value**, not the original expression:

```hql
; You type:
(def result (+ 1 2))

; Stored in memory.hql:
(def result 3)

; You type:
(def timestamp (js/Date.now))

; Stored in memory.hql:
(def timestamp 1704500000000)
```

This prevents side effects on reload - API calls, file reads, etc. won't re-execute.

### Function Storage (defn)

For `defn`, we store the **original source code**:

```hql
; You type:
(defn greet [name] (str "Hello " name))

; Stored in memory.hql (unchanged):
(defn greet [name] (str "Hello " name))
```

---

## What Persists vs What Doesn't

| Keyword | Persists | Reason |
|---------|----------|--------|
| `def` | **Yes** | Global immutable binding - your "constants" |
| `defn` | **Yes** | Named function definition - your "tools" |
| `let` | No | Local binding - temporary |
| `var` | No | Local mutable binding - temporary |
| `const` | No | Local constant - use `def` for persistence |
| `fn` | No | Local function - use `defn` for persistence |

### Design Philosophy

- **`def`/`defn`** = Top-level, global, persistent (Clojure-inspired)
- **`let`/`var`/`const`** = Local, temporary, session-only
- **Scripts don't persist** - They're isolated, reproducible units

---

## File Location and Format

### Location

```
~/.hql/memory.hql
```

The `~/.hql/` directory is also used for:
- `.update-check` - Update timestamp cache
- `.runtime/` - Embedded AI runtime (Ollama)

### Format

Plain HQL code - human-readable, git-friendly, editable:

```hql
; HQL Memory - auto-persisted definitions
; Edit freely - compacted on REPL startup

(def api-key "sk-xxx")

(def config {"timeout": 5000, "retries": 3})

(defn greet [name] (str "Hello " name))

(defn add [x y] (+ x y))
```

You can edit this file manually. Invalid syntax is skipped with warnings.

---

## REPL Commands

### `.memory`

Show memory file location and statistics:

```
hql> .memory
Memory:
  Location: /Users/you/.hql/memory.hql
  Definitions: 4
  Size: 256 bytes
  Names: api-key, config, greet, add
```

### `.forget <name>`

Remove a specific definition from memory:

```
hql> .forget api-key
Removed 'api-key' from memory.
Note: The binding still exists in this session. Use .reset to clear all bindings.
```

### `.compact`

Manually trigger memory compaction:

```
hql> .compact
Compacted memory: 6 → 4 definitions.
```

---

## Compaction

### Why Compaction?

When you redefine a value, both versions are saved:

```hql
; Session 1:
(def x 1)

; Session 2:
(def x 10)

; memory.hql now has both:
(def x 1)
(def x 10)
```

### Automatic Compaction

On REPL startup, compaction runs automatically:
1. Parses all definitions
2. Keeps only the **latest** definition for each name
3. Rewrites the file

After compaction:
```hql
(def x 10)  ; only latest
```

### Manual Compaction

Use `.compact` during a session to trigger it manually.

---

## Usage in Scripts

`def` and `defn` also work in regular HQL scripts:

```hql
; my-script.hql
(def PI 3.14159)
(defn circle-area [r] (* PI r r))
(print (circle-area 5))
```

But **scripts don't trigger persistence** - that's REPL-only behavior. Scripts are meant to be isolated and reproducible.

---

## Architecture Decisions

### Why def/defn (not a new API)?

The goal is **invisible persistence**. Using existing syntax patterns means:
- No new API to learn
- Existing mental models apply
- Feels like a "living system," not a feature

### Why Values Not Expressions (for def)?

Storing evaluated values prevents side effects:

```hql
; If we stored the expression:
(def data (http-get "https://api.com"))  ; Would call API every startup!

; By storing the value:
(def data {"cached": "response"})  ; No API call on startup
```

### Why REPL Only (for persistence)?

Scripts are **reproducible units**. They should not depend on hidden state. Memory persistence is specifically for **interactive development**.

### Inspiration: Smalltalk

Smalltalk pioneered the "living system" concept where development environment and runtime are unified. HQL Memory brings this philosophy to a modern, text-based, version-control-friendly workflow.

---

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Circular references | Skip, don't persist |
| Very large values | Persist as-is (consider size) |
| Syntax errors in memory.hql | Skip line, warn, continue |
| File doesn't exist | Create on first def/defn |
| Permission error | Warn, continue without persistence |
| Function as def value | Skip (use defn instead) |
| Loading re-triggers persistence | Prevented by isLoadingMemory flag |

---

## Troubleshooting

### Reset Memory

To start fresh:

```bash
rm ~/.hql/memory.hql
```

### Memory Not Loading

Check for syntax errors:

```bash
cat ~/.hql/memory.hql
```

Malformed expressions are skipped with warnings on startup.

### Values Not Persisting

Some values cannot be serialized:
- Functions (use `defn` instead of `def fn`)
- Circular references
- `undefined` values

---

## Integration with HLVM

When HLVM runs HQL in REPL mode, memory persistence is automatically available. This enables:

1. **Define once, use forever** - Functions you create persist
2. **Cross-session state** - Your development context carries over
3. **Portable brain** - `~/.hql/memory.hql` can be synced across machines

The HLVM experience layer provides visual management, while HQL's memory system handles the persistence logic.
