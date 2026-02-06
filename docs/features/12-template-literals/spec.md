# Template Literals Specification

## Syntax

```
`text ${expression} text`
```

- Delimited by backticks (`` ` ``)
- Interpolations use `${expression}` where `expression` is any valid HQL expression
- Backtick immediately followed by `(` or `[` is excluded (reserved for quasiquote syntax)

## Parsing

The tokenizer matches template literals with a regex that handles:
- Plain text characters
- Escape sequences (`\` followed by any character)
- `$` not followed by `{` (literal dollar sign)
- `${...}` interpolation blocks

The parser (`parseTemplateLiteral`) then:
1. Strips the surrounding backticks
2. Walks through the content character by character
3. On `${`: tracks brace depth to find the matching `}`
4. Parses the interpolation content as an HQL expression via `tokenize` + `parseExpression`
5. Handles escape sequences via `processSingleEscape`
6. Produces a `(template-literal "str1" expr1 "str2" ...)` s-expression

Optimization: if the template literal contains no interpolations, the parser returns a plain string literal instead of a template-literal form.

## IR Representation

```typescript
interface IRTemplateLiteral {
  type: IRNodeType.TemplateLiteral;
  quasis: IRNode[];      // String literal parts
  expressions: IRNode[]; // Interpolated expressions
}
```

Invariant: `quasis.length === expressions.length + 1` (matching JavaScript's template literal structure). Empty string literals are inserted as needed to maintain this invariant.

## Code Generation

Emits a JavaScript template literal:
```
`quasi0${expr0}quasi1${expr1}quasi2`
```

String parts (quasis) are emitted as raw text (not JSON-stringified). Expressions are generated in expression context.

## Escape Sequences

Handled during parsing (not in codegen). Supported escapes include:
- `\`` — literal backtick
- `\$` — literal dollar sign
- `\n` — newline
- `\t` — tab
- `\\` — backslash
- Other standard escapes via `processSingleEscape`

## Interpolation Expression Parsing

Inside `${}`, any valid HQL expression is accepted:

```lisp
`${42}`                          ;; number literal
`${name}`                        ;; variable reference
`${(+ 2 3)}`                     ;; function call
`${(* (+ 2 3) 4)}`              ;; nested expressions
`${(get arr 1)}`                 ;; array/object access
`${(? true "yes" "no")}`        ;; ternary
```

Brace depth is tracked so nested braces inside expressions (e.g., object literals) are handled correctly by the parser. Note: the tokenizer regex uses a simpler pattern for `${...}` that does not track nested braces, but the parser re-parses the content with full brace depth tracking.

## Type Coercion

Template literals follow JavaScript's `toString()` coercion rules at runtime. No special coercion is performed by the transpiler.

## Limitations

- No tagged template literals
- No raw template strings (`String.raw`)
