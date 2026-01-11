# HQL REPL Guide

The HQL REPL (Read-Eval-Print Loop) provides an interactive environment for exploring HQL and building AI-powered applications.

## Quick Start

```bash
# Standard REPL
hql repl

# Ink REPL (enhanced terminal UI)
hql repl --ink
```

## Features

### Memory Persistence

Variables defined with `def` and `defn` are automatically saved across sessions:

```lisp
hql> (def greeting "Hello, World!")
hql> (defn double [x] (* x 2))
```

On next session:
```lisp
hql> greeting
"Hello, World!"
hql> (double 21)
42
```

Memory commands:
```lisp
; List all saved bindings
(memory)

; Forget a specific binding
(forget "greeting")
```

### AI Integration

AI functions are auto-imported from `@hql/ai`:

```lisp
; Ask AI a question (streaming response)
(ask "What is functional programming?")

; Ask with content and instruction (variadic)
(ask paste-1 "Summarize this code")
(ask code-content "Find bugs in this" "Be concise")

; Multi-turn chat
(chat [
  {:role "user" :content "Hello"}
  {:role "assistant" :content "Hi! How can I help?"}
  {:role "user" :content "Explain recursion"}
])

; Generate code
(generate "a function that calculates fibonacci")

; Summarize text
(summarize long-text)
```

### Context System

**Status:** In Progress

#### Paste Variables

When you paste multi-line text, it's automatically captured as a variable:

```
hql> [Pasted text #1 +245 lines]
```

Access the content:
```lisp
; Reference by display name (auto-transformed)
(ask [Pasted text #1 +245 lines] "explain this")
; Transforms to: (ask paste-1 "explain this")

; Or use the variable directly
(ask paste-1 "what does this do?")
paste-1  ; Access raw content
```

#### Conversation Variables

Track conversation context:
```lisp
last-input     ; Last user command
last-response  ; Last AI response
conversation   ; Full conversation history
```

Use in follow-ups:
```lisp
(ask last-response "elaborate on that")
(ask conversation "summarize our discussion")
```

#### Persistence

Save context for later use:
```lisp
(def auth-code paste-1)     ; Save pasted code
(def summary last-response) ; Save AI response
```

### @ File Mentions

Reference files directly in your input:

```lisp
; Text files - content is inlined
hql> (ask @src/main.ts "review this code")

; Fuzzy search - type partial path
hql> @ma<tab>  ; Shows matches like src/main.ts

; Images and media (Ink REPL)
hql> (describe @screenshot.png)  ; Creates [Image #1] attachment
```

### Slash Commands

Control REPL behavior:

| Command | Description |
|---------|-------------|
| `/help` | Show help |
| `/clear` | Clear screen |
| `/reset` | Reset REPL state |
| `/exit` | Exit REPL |

### Mode Switching

Toggle between HQL and JavaScript using the `--js` flag:

```bash
# Start in JavaScript mode
hql repl --js
```

## Keyboard Shortcuts

### Basic Navigation

| Key | Action |
|-----|--------|
| Tab | Autocomplete |
| Ctrl+C | Cancel / Exit |
| Ctrl+L | Clear screen |
| Up/Down | Navigate history |
| Ctrl+A | Move to line start |
| Ctrl+E | Move to line end |

### S-Expression Navigation

| Key | Action |
|-----|--------|
| Alt+Up | Move to previous sexp |
| Alt+Down | Move to next sexp |
| Ctrl+Up | Move up to parent (enclosing paren) |

### Paredit (Structural Editing)

The REPL includes full paredit support for manipulating S-expressions structurally. See [PAREDIT.md](PAREDIT.md) for detailed documentation.

| Action | Shortcut | Example |
|--------|----------|---------|
| Slurp Forward | `Ctrl+]` | `(a│) b` → `(a│ b)` |
| Slurp Backward | `Ctrl+O` | `a (│b)` → `(a │b)` |
| Barf Forward | `Ctrl+\` | `(a│ b)` → `(a│) b` |
| Barf Backward | `Ctrl+P` | `(a │b)` → `a (│b)` |
| Wrap | `Ctrl+Y` | `│foo` → `(│foo)` |
| Splice | `Ctrl+G` | `((│a))` → `(│a)` |
| Raise | `Ctrl+^` | `(x (│y))` → `(│y)` |
| Kill Sexp | `Ctrl+X` | `(a │b c)` → `(a │ c)` |
| Transpose | `Ctrl+T` | `(a │b)` → `(b │a)` |

## Examples

### Basic Exploration

```lisp
hql> (+ 1 2 3)
6

hql> (def nums [1 2 3 4 5])
hql> (map (fn [x] (* x 2)) nums)
[2, 4, 6, 8, 10]

hql> (filter (fn [x] (> x 2)) nums)
[3, 4, 5]
```

### AI-Powered Development

```lisp
; Ask about code
hql> (ask @src/parser.ts "What parsing strategy does this use?")

; Generate and iterate
hql> (generate "a sorting function in HQL")
hql> (ask last-response "add error handling")

; Code review with pasted content
hql> [Pasted text #1 +50 lines]
hql> (ask paste-1 "find potential bugs and suggest fixes")
```

### Multi-file Analysis

```lisp
; Compare files
hql> (ask @old.ts @new.ts "what changed between these versions?")

; Aggregate context
hql> (def context (str @types.ts "\n\n" @impl.ts))
hql> (ask context "are there any type mismatches?")
```

### Persistent Workflows

```lisp
; Save important context
hql> (def project-context @README.md)
hql> (def api-spec @api/schema.ts)

; Use across sessions
hql> (memory)
["project-context", "api-spec", ...]

hql> (ask project-context "summarize the project goals")
```

## Configuration

The REPL stores data in:
- `~/.hql/memory.json` - Persisted variables
- `~/.hql/history` - Command history

## Tips

1. **Use paste variables** for large code blocks instead of inline strings
2. **Save AI responses** with `(def name last-response)` for reference
3. **Chain operations** by referencing previous results
4. **Use @ mentions** for quick file access without leaving the REPL
5. **Switch to JS mode** for quick JavaScript experiments

---

## Implementation Notes

### Context System Status

| Feature | Status |
|---------|--------|
| `paste-1`, `paste-2`, ... | Done |
| `last-input`, `last-response` | Done |
| `conversation` | Done |
| `[Pasted text #N]` syntax transform | Done |
| Persistence via `def` | Done |

**Future considerations:**
- AI-powered context compression
- Automatic context relevance extraction
- Smart naming suggestions

### Source Files

- `src/cli/repl/context.ts` - Context management (29 tests)
- `src/cli/repl/attachment.ts` - Attachment handling (70 tests)
- `src/cli/repl/evaluator.ts` - REPL evaluation
