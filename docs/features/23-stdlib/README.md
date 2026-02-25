# 23. Standard Library

HQL includes a comprehensive standard library with 107+ functions for functional programming. Approximately 96% of the stdlib is self-hosted (written in HQL itself).

## Key Features

- Lazy-by-default sequence operations
- Clojure-inspired API (first, rest, cons, map, filter, reduce)
- Chunked sequences for performance
- Transducers for composable transformations
- Rich predicate and type-checking functions

## Files

- [spec.md](spec.md) - Complete function reference
- [examples.hql](examples.hql) - Usage examples

## Sources

- `src/hql/lib/stdlib/stdlib.hql` - Self-hosted functions (HQL)
- `src/hql/lib/stdlib/js/core.js` - Primitive functions (JavaScript)
