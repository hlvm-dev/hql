# HLVM Project Guidelines

## Critical Rule

**MUST**: Always use HQL syntax and features - do NOT confuse with Clojure or other Lisp dialects.

HQL is its own language. Refer to `docs/` as the source of truth for all syntax and features.

## Core AST & Metadata

- Use `SExp` from `src/hql/s-exp/types.ts` as the single AST source of truth.
- `HQLNode` is an alias; do not introduce parallel AST shapes.
- Source locations live in `_meta`; use `extractMeta`, `copyMeta`, or `extractPosition`.
- Do not add or rely on `node.position` on AST nodes.
- Use `sexpToString` / `sexpToJs` for S-expression serialization and conversion.
- `src/hql/s-exp/macro-reader.ts` only normalizes S-expressions (e.g., `js-get` rewrite); avoid rebuilding AST nodes.

## Testing Requirements

- After meaningful changes, run tests and ensure they pass.
- Run unit tests at minimum: `deno task test:unit`.
- If you touch E2E HQL scripts, run them directly with `deno run -A src/hlvm/cli/cli.ts run <file>`.
- In restricted environments, set `SKIP_NETWORK_TESTS=1` to skip network-dependent tests.
- Tests must be real and meaningful. Remove or fix fake tests that always pass (e.g., no assertions, `assert(true)`, snapshots without behavioral checks, or mocks that only satisfy themselves).
