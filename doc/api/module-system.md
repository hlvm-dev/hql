# HQL Module System

This document explains how the HQL runtime resolves modules, tracks circular
imports, and exposes exports to user code. It complements the specs in
`doc/specs/hql_module.md` with concrete runtime detail.

---

## Import Syntax Recap

```lisp
;; Named imports (vector style)
(import [foo bar] from "./lib/math.hql")

;; Namespace import
(import math from "./lib/math.hql")

;; Aliases
(import [foo as foo2, bar] from "./lib/math.hql")
```

The transpiler enforces the opinionated vector syntax described in the spec—no
string-based exports, no bare `import foo` forms.

---

## Resolution Algorithm

1. **Entry file**: The runtime starts from the file passed to `run`/`runFile`
   and records `currentFile` so relative paths stay accurate.
2. **Local vs remote**: Local imports (relative paths) are processed
   sequentially to preserve evaluation order; remote imports (`npm:`, `jsr:`,
   `https://`) are fetched in parallel.
3. **Caching**: Resolved modules are cached in `.hql-cache` for reuse within the
   same session.
4. **Environment registration**: Each module is registered in the `Environment`
   as a stable object so circular imports see live bindings rather than copies.

---

## Circular Dependencies

The runtime now supports circular import graphs out-of-the-box. The flow is:

1. **Pre-registration**: When a module detects it is importing something that is
   already in progress, it pre-registers an empty export object containing the
   correct keys.
2. **Shared live object**: `Environment#importModule` reuses the same object on
   every call, so once the original module finishes evaluating, all importers
   observe the updated values.
3. **Compiler support**: The runtime compiler caches the output path for each
   HQL module immediately. If another module requires it while compilation is
   still running, the cached path is returned instantly (no deadlock), and the
   original compilation eventually writes the file.

```lisp
;; a.hql
(var base 10)
(import [inc] from "./b.hql")
(fn a-func [] (inc base))
(export [base])
(export [a-func])

;; b.hql
(import [base] from "./a.hql")
(fn inc [value] (+ value base))
(export [inc])
```

```
(import [a-func] from "./a.hql")
(a-func) ;; → 20
```

The associated tests (`test/syntax-circular.test.ts`) cover single-hop and
multi-hop cycles.

---

## Export Semantics

- Vector exports simply expose existing bindings.
- String exports (`(export "name" expression)`) evaluate the expression at
  compile time; failures fall back to looking up the binding in the runtime
  environment.
- Exports are recorded in the global symbol table so tooling/linters can
  introspect available bindings.

---

## Interaction with the Build Tool

`core/build.ts` relies on the same module resolution logic as the runtime. This
means:

- Build outputs preserve circular dependencies without manual shims.
- Metadata generation correctly tracks which files participate in the graph.
- Subsequent builds reuse cached `.mjs` files, improving performance.

---

## Tips

- Keep exports at the top level—conditional exports are discouraged because the
  transpiler expects static analysis to succeed.
- Use namespace imports when you want to expose multiple members while avoiding
  name collisions.
- For remote modules, prefer explicit version pinning (`npm:lodash@4`) so builds
  remain reproducible.
