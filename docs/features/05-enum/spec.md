````markdown
# HQL Enumerations (Core Design with Lisp Syntax)

This document outlines the design for basic, type-safe enumerations in HQL,
using a Lisp-style syntax implemented as a core compiler feature for optimal
tooling support (LSP, autocompletion).

## 1. Goal

To define a clear, Lisp-native syntax for simple enumerations (groups of named
constants like `macOS` under a type like `OsType`). This improves code clarity
and provides runtime type safety. The design enables intuitive dot-notation
access (`OsType.macOS`) and potential shorthand access (`.macOS`), supported by
IDE autocompletion.

## 2. Implementation Approach (Core Compiler Feature)

This design adopts the approach of implementing `(enum ...)` as a **core
language feature**.

- **Mechanism:** The HQL compiler (parser, AST/IR stages, code generator) is
  modified to directly recognize and understand the `(enum ...)` S-expression
  syntax. Specific internal representations (e.g., `EnumDefinitionNode`,
  `EnumCaseNode` in the AST/IR) are created.
- **Rationale:** This provides the most explicit and analyzable structure for
  Language Server Protocols (LSPs) and other tools, leading to reliable
  autocompletion, type hinting, and potential future static analysis. It treats
  enums as a fundamental part of the language.
- **Alternatives Not Chosen:** Implementing via the Syntax Transformer stage or
  solely via Macros would obscure the enum's semantic meaning earlier in the
  pipeline, making robust tooling integration significantly more challenging.

## 3. Declaration Syntax

The definition uses an `(enum ...)` S-expression form, recognized by the
compiler.

```hql
;; Define a simple enumeration
(enum OsType
  (case macOS)
  (case windowOS)
  (case linux)
)

;; Define an enum with Raw Values
(enum StatusCodes
  (case ok 200)
  (case notFound 404)
)

;; Define an enum with Associated Values
(enum Barcode
  (case upc system manufacturer product check)
  (case qrCode value)
)
```
````

- **S-expression Validity:** This syntax is a pure S-expression (lists, symbols,
  literals). The basic parser can read it.
- **Compiler Understanding:** The compiler's later stages (beyond basic parsing)
  are modified to recognize `(enum ...)` and understand its meaning – defining a
  distinct enum type with cases.

## 4. Usage Examples

Access involves dot notation; shorthand may be possible with type inference.

```hql
;; Assign simple case
(let currentOS OsType.macOS)

;; Compare simple case
(if (=== currentOS OsType.linux) (print "Linux!"))

;; Use raw value enum
(let status StatusCodes.notFound)
; (status.rawValue) ; Hypothetical access to raw value => 404

;; Create associated value case
(let code (Barcode.qrCode "hql-data"))

;; Use with enum values
(fn processStatus [code] (print code))
(processStatus StatusCodes.ok) ; Explicit enum value
```

## 5. Dot Notation & Autocompletion Roles

```hql
;; Define a simple OS enum.
(enum OS
  (case macOS)
  (case iOS)
  (case linux)
)

;; A function that “installs” based on the OS.
(fn install [os]
  (cond
    ((=== os OS.macOS) (print "Installing on macOS"))
    ((=== os OS.iOS)   (print "Installing on iOS"))
    ((=== os OS.linux) (print "Installing on Linux"))
    (else            (print "Unsupported OS"))
  )
)

;; Positional calls
(install OS.macOS)
(install OS.iOS)
(install OS.linux)
```

## 6. Summary

Using `(enum TypeName (case caseName) ...)` syntax implemented as a **core
compiler feature** provides a flexible, Lisp-native way to define enums. This
approach creates an explicit internal structure (AST/IR) that LSPs can reliably
analyze, enabling robust dot-notation autocompletion (`TypeName.` and
`.caseName`) crucial for developer productivity. No newline at end of file
