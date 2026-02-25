# 22. Comments

## Overview

HQL supports three comment styles: line comments, block comments, and Lisp-style semicolons. Comments are stripped during tokenization and do not appear in the compiled output.

## Syntax

### Line Comments (`//`)

```clojure
// This is a line comment
(let x 10) // Inline comment after code
```

**Compilation:** Stripped entirely. Not present in JavaScript output.

### Block Comments (`/* */`)

```clojure
/* This is a
   multi-line block comment */

(let x /* inline block */ 10)
```

**Compilation:** Stripped entirely. Block comments can span multiple lines and can appear between tokens.

### Lisp-Style Comments (`;;`)

```clojure
;; This is a Lisp-style comment
;; Preferred convention in .hql files
(fn add [a b]
  ;; Add two numbers
  (+ a b))
```

**Compilation:** Treated identically to `//` — stripped during tokenization.

**Note:** Single semicolon `;` is also treated as a comment prefix, but the double-semicolon `;;` is the established convention.

### Shebang Line

```clojure
#!/usr/bin/env hlvm
;; Rest of the program
(print "Hello!")
```

**Compilation:** The shebang line (`#!`) is recognized and stripped if it appears as the very first line of a file. This enables HQL scripts to be executed directly on Unix-like systems.

## Conventions

| Style | Usage |
|-------|-------|
| `;;` | Primary comment style in .hql files (Lisp convention) |
| `//` | Also supported, familiar to JavaScript developers |
| `/* */` | Multi-line comments, temporarily disabling code blocks |
| `#!/usr/bin/env hlvm` | Shebang for executable scripts |

## Nesting

Block comments do **not** nest:

```clojure
/* outer /* inner */ still outside */
;; The above is a syntax issue — "still outside */" is not commented
```

## Implementation

**Source:** Tokenizer (`src/hql/transpiler/tokenizer/`)

Comments are consumed during the tokenization phase and never reach the parser or IR transformation stages. All three styles produce no tokens.

## Summary

| Form | Description | Multi-line |
|------|-------------|------------|
| `// text` | Line comment | No |
| `;; text` | Lisp-style line comment | No |
| `/* text */` | Block comment | Yes |
| `#!/usr/bin/env hlvm` | Shebang (first line only) | No |
