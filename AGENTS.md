# HQL Project Guidelines

## Critical Rule

**MUST**: Always use HQL syntax and features - do NOT confuse with Clojure or other Lisp dialects.

HQL is its own language. Refer to `docs/` as the source of truth for all syntax and features.

## Core AST & Metadata

- Use `SExp` from `src/s-exp/types.ts` as the single AST source of truth.
- `HQLNode` is an alias; do not introduce parallel AST shapes.
- Source locations live in `_meta`; use `extractMeta`, `copyMeta`, or `extractPosition`.
- Do not add or rely on `node.position` on AST nodes.
- Use `sexpToString` / `sexpToJs` for S-expression serialization and conversion.
- `src/s-exp/macro-reader.ts` only normalizes S-expressions (e.g., `js-get` rewrite); avoid rebuilding AST nodes.
