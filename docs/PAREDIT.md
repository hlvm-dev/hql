# Paredit: Structural Editing for HQL

Paredit (parenthesis editing) provides powerful structural editing commands that manipulate S-expressions as complete units, ensuring your code always remains balanced.

## Overview

Unlike traditional text editing where you insert/delete individual characters, paredit operates on **expressions**. This means:

- Parentheses always stay balanced
- You manipulate code semantically, not textually
- Fewer keystrokes for common refactoring operations

## Quick Reference

All shortcuts use **Ctrl+key** combinations that work reliably in Terminal.app and most terminals.

| Operation | Shortcut | Description |
|-----------|----------|-------------|
| **Slurp Forward** | `Ctrl+]` | Pull next sexp INTO list: `(a│) b` → `(a│ b)` |
| **Slurp Backward** | `Ctrl+O` | Pull prev sexp INTO list: `a (│b)` → `(a │b)` |
| **Barf Forward** | `Ctrl+\` | Push last sexp OUT: `(a│ b)` → `(a│) b` |
| **Barf Backward** | `Ctrl+P` | Push first sexp OUT: `(a │b)` → `a (│b)` |
| **Wrap** | `Ctrl+Y` | Surround with parens: `│foo` → `(│foo)` |
| **Splice** | `Ctrl+G` | Remove enclosing parens: `((│a))` → `(│a)` |
| **Raise** | `Ctrl+^` | Replace parent with sexp: `(x (│y))` → `(│y)` |
| **Kill Sexp** | `Ctrl+X` | Delete sexp at cursor: `(a │b c)` → `(a │ c)` |
| **Transpose** | `Ctrl+T` | Swap with previous: `(a │b)` → `(b │a)` |

> **Note:** `Ctrl+^` means `Ctrl+Shift+6` on US keyboards.

---

## Slurp & Barf

These operations expand or contract list boundaries by moving delimiters.

### Slurp Forward (`Ctrl+Shift+)`)

"Eat" the next expression into your current list by moving the closing delimiter right.

```
BEFORE                      AFTER
──────                      ─────
(+ 1 2|) 3                  (+ 1 2| 3)
       ↑                            ↑
       ) moves right ───────────────┘
```

**Use Case:** Adding a forgotten argument:

```clojure
;; Oops, forgot the third argument
(+ 10 20|) 30

;; Press Ctrl+Shift+)
(+ 10 20| 30)    ; Now all three are added together
```

### Slurp Backward (`Ctrl+Shift+(`)

"Eat" the previous expression into your current list by moving the opening delimiter left.

```
BEFORE                      AFTER
──────                      ─────
square (|x y)               (square |x y)
       ↑                    ↑
       ( moves left ────────┘
```

**Use Case:** Including a function name:

```clojure
;; Function name should be inside
map (fn [x] (* x x)|)

;; Press Ctrl+Shift+(
(map fn [x] (* x x)|)    ; Now map is the function being called
```

### Barf Forward (`Ctrl+Shift+}`)

"Spit out" the last expression from your list by moving the closing delimiter left.

```
BEFORE                      AFTER
──────                      ─────
(+ 1 2| 3)                  (+ 1 2|) 3
         ↑                        ↑
         ) moves left ────────────┘
```

**Use Case:** Removing an extra argument:

```clojure
;; Too many arguments in the function
(+ 10 20| 30 40)

;; Press Ctrl+Shift+} twice
(+ 10 20|) 30 40    ; 30 and 40 are now outside
```

### Barf Backward (`Ctrl+Shift+{`)

"Spit out" the first expression from your list by moving the opening delimiter right.

```
BEFORE                      AFTER
──────                      ─────
(foo bar| baz)              foo (bar| baz)
↑                               ↑
( moves right ──────────────────┘
```

**Use Case:** Extracting an element:

```clojure
;; "result" should be a separate binding name
(let [(result (compute x)|])

;; Press Ctrl+Shift+{
(let [result (compute x)|])    ; Better structure
```

---

## Wrap, Splice & Raise

These operations add, remove, or replace structural nesting.

### Wrap (`Alt+(`)

Surround the expression at cursor with parentheses.

```
BEFORE                      AFTER
──────                      ─────
|foo bar baz                (|foo) bar baz
↑                           ↑   ↑
cursor                      new parens around "foo"
```

**Use Cases:**

```clojure
;; Wrap a value to make it a function call
|x                  ; Press Alt+(
(|x)                ; Ready to add arguments

;; Wrap to create a list
|1 2 3              ; Press Alt+(
(|1) 2 3            ; First element wrapped

;; Wrap an entire expression
|(+ 1 2) 3          ; Press Alt+(
(|(+ 1 2)) 3        ; Nested expression
```

### Splice (`Alt+s`)

Remove the enclosing parentheses, merging contents with the parent.

```
BEFORE                      AFTER
──────                      ─────
(outer (inner| x))          (outer inner| x)
       └────────┘                  ↑
       these parens removed ───────┘
```

**Use Cases:**

```clojure
;; Remove unnecessary nesting
(+ 1 (|2) 3)        ; Press Alt+s
(+ 1 |2 3)          ; Cleaner

;; Flatten a structure
(list (|a b c))     ; Press Alt+s
(list |a b c)       ; Contents merged into parent
```

### Raise (`Alt+r`)

Replace the parent expression with the current expression. Everything else in the parent is deleted.

```
BEFORE                      AFTER
──────                      ─────
(if true                    (|do-this)
  (|do-this)                ↑
  (do-that))                only this remains
└───────────┘
entire parent replaced
```

**Use Cases:**

```clojure
;; Simplify conditional - keep only one branch
(if always-true
  (compute| result)    ; Keep this
  (fallback))          ; Delete this

;; Press Alt+r
(compute| result)      ; The entire if is replaced

;; Extract from let binding
(let [x 10]
  (process| x))        ; Press Alt+r

(process| x)           ; let wrapper removed
```

---

## Kill & Transpose

Operations for deleting and reordering expressions.

### Kill Sexp (`Ctrl+Shift+K`)

Delete the entire s-expression at or after the cursor.

```
BEFORE                      AFTER
──────                      ─────
(foo |bar baz)              (foo | baz)
     ───                         ↑
     deleted                     bar is gone
```

**Use Cases:**

```clojure
;; Remove an argument
(+ 1 |2 3 4)        ; Press Ctrl+Shift+K
(+ 1 | 3 4)         ; "2" deleted

;; Remove a nested expression
(+ 1 |(* 2 3) 4)    ; Press Ctrl+Shift+K
(+ 1 | 4)           ; Entire (* 2 3) deleted

;; Clean up a list
(list |:unused :keep :this)
(list | :keep :this)
```

### Transpose (`Ctrl+Shift+T`)

Swap the current expression with the previous one.

```
BEFORE                      AFTER
──────                      ─────
(a |b c)                    (b a| c)
 ↑  ↑                        ↑  ↑
 └──┴── swapped ─────────────┴──┘
```

**Use Cases:**

```clojure
;; Fix argument order
(- |5 10)           ; Should be 10 - 5
;; Press Ctrl+Shift+T
(- 10 5|)           ; Now correct

;; Reorder list elements
(list :b| :a :c)    ; Press Ctrl+Shift+T
(list :a :b| :c)    ; Swapped

;; Reorder function calls
(foo) |(bar)        ; Press Ctrl+Shift+T
(bar) (foo)|        ; Order changed
```

---

## Practical Workflows

### Building an Expression from Scratch

```clojure
;; Start with just values
+ 1 2 3

;; 1. Wrap the operator (Alt+( at +)
(+) 1 2 3

;; 2. Slurp all arguments (Ctrl+Shift+) × 3)
(+ 1) 2 3
(+ 1 2) 3
(+ 1 2 3)          ; Done!
```

### Refactoring a Conditional

```clojure
;; Original: complex nested if
(if condition
  (if nested-condition
    (result|)
    (other))
  (fallback))

;; Want to extract just (result)
;; Press Alt+r twice:
;; First raise: replaces inner if
;; Second raise: replaces outer if
(result|)
```

### Restructuring Arguments

```clojure
;; Original: arguments in wrong order
(create-user email| name age)

;; Want: (create-user name email age)
;; 1. Transpose email with name (Ctrl+Shift+T)
(create-user name email| age)    ; Done!
```

### Wrapping in a Function Call

```clojure
;; Original value
|42

;; Want to wrap in (identity 42)
;; 1. Wrap (Alt+()
(|42)

;; 2. Type function name
(identity| 42)

;; Or with existing expression:
|(+ 1 2)

;; 1. Wrap (Alt+()
(|(+ 1 2))

;; 2. Slurp backward to add function name typed before
inc (|(+ 1 2))    ; Type "inc", then Ctrl+Shift+(
(inc |(+ 1 2))    ; Now inc is called on the sum
```

---

## Tips & Best Practices

### 1. Think in Expressions, Not Characters

Instead of deleting characters one by one, use Kill Sexp to remove entire expressions:

```clojure
;; Bad: Delete 7 characters one by one
(+ 1 2 (- 3 4) 5)
       ^^^^^^^

;; Good: One Ctrl+Shift+K
(+ 1 2 | 5)
```

### 2. Slurp/Barf for Boundary Adjustments

When an expression is on the wrong side of a delimiter, slurp or barf it:

```clojure
;; Instead of copy-paste
(foo) bar    ; bar should be inside

;; Just slurp forward
(foo bar)
```

### 3. Raise for Simplification

When you want to keep only part of a complex expression:

```clojure
;; Instead of manual deletion
(when condition
  (do
    (setup)
    (main-work|)    ; This is all you need
    (cleanup)))

;; Raise twice to get just (main-work)
```

### 4. Wrap + Slurp for New Containers

To wrap multiple expressions in a new list:

```clojure
a b c        ; Want (a b c)

;; 1. Wrap first (Alt+()
(a) b c

;; 2. Slurp the rest (Ctrl+Shift+) × 2)
(a b c)      ; Done!
```

---

## Navigation Shortcuts

These complement paredit for efficient movement:

| Shortcut | Operation |
|----------|-----------|
| `Alt+Up` | Move to previous sexp |
| `Alt+Down` | Move to next sexp |
| `Ctrl+Up` | Move up one level (to parent open paren) |

---

## Troubleshooting

### Alt/Option Key Not Working

On macOS Terminal or iTerm2, you may need to configure the Option key:

- **Terminal.app:** Preferences → Profiles → Keyboard → "Use Option as Meta key"
- **iTerm2:** Preferences → Profiles → Keys → Left/Right Option Key → "Esc+"

### Shortcuts Conflicting with Terminal

Some shortcuts may conflict with terminal emulator bindings. Check your terminal's keyboard settings if a shortcut doesn't work.

### Operation Returns Nothing

Paredit operations return `null` (do nothing) when:
- You're at the top level (not inside any list)
- There's nothing to slurp/barf/kill
- The operation would create invalid syntax

This is by design—paredit never leaves you with unbalanced delimiters.
