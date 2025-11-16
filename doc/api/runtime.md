# HQL Runtime API

The HQL runtime exposes a small set of TypeScript-friendly helpers for
compiling, macro-expanding, and executing HQL source. These functions live in
the top-level `mod.ts` entry point (importable via `import hql from "./mod.ts"`
or using the named exports below).

## Overview

| Function                 | Description                                              |
| ------------------------ | -------------------------------------------------------- |
| `run`                    | Transpile an HQL string and return the last expression.  |
| `runFile`                | Execute an HQL file on disk, resolving relative imports. |
| `transpile`              | Convert HQL into raw JavaScript code string.  |
| `macroexpand`            | Expand all macros in a source string.                    |
| `macroexpand1`           | Expand only the outer-most macro call.                   |
| `hqlEval`                | Evaluate HQL directly from the initialized runtime.      |
| `resetRuntime`           | Reset user-defined macros and runtime state.             |
| `getMacros` / `hasMacro` | Inspect runtime macro registry.                          |

All helpers accept optional `baseDir`/`currentFile` options so they can resolve
relative imports exactly the same way the CLI does.

---

## `run(source, options?)`

Compile and execute a snippet of HQL. Returns a Promise that resolves to the
value of the last expression in the snippet.

```ts
import { run } from "./mod.ts";

const result = await run(`
  (let greeting "Hello")
  (let subject "World")
  (+ greeting ", " subject "!")
`);
console.log(result); // "Hello, World!"
```

**Options**

| Option        | Type     | Description                                                                |
| ------------- | -------- | -------------------------------------------------------------------------- |
| `baseDir`     | string   | Working directory used for resolving relative imports (defaults to `cwd`). |
| `currentFile` | string   | Virtual file path for error reporting/import resolution.                   |
| `adapter`     | (js)⇒any | Optional hook to run custom evaluators (e.g. inside tests/REPL).           |

> `run` automatically detects ESM `import`/`export` statements. When present, it
> wires the compiled code through a temporary `.mjs` file inside `.hql-cache/rt`
> so standard dynamic imports keep working.

---

## `runFile(filePath, options?)`

Execute an HQL file on disk. This helper first attempts the fast `run()` path
and, if an ESM-style import graph requires bundling, automatically falls back to
`transpileCLI`.

```ts
import { runFile } from "./mod.ts";

const value = await runFile("./examples/pipeline.hql");
console.log(value);
```

---

## `transpile(source, options?)`

Return the raw JavaScript emitted by the transpiler **without** executing it.
Useful for tooling, debugging, or snapshot tests.

```ts
import { transpile } from "./mod.ts";

const js = await transpile("(map (fn (x) (* x 2)) [1 2 3])");
console.log(js);
```

**Returned structure**

```ts
interface TranspileResult {
  code: string; // Raw JS/TS code
  sourceMap?: string; // Optional sourcemap if enabled
}
```

---

## Macro utilities

### `macroexpand(source, options?)`

Expands all macros inside `source` and returns the resulting forms as strings.

```ts
import { macroexpand } from "./mod.ts";

const [expanded] = await macroexpand(`
  (let x 3)
  (when (> x 0)
    (print x))
`);
console.log(expanded);
```

### `macroexpand1(source, options?)`

Like `macroexpand` but expands only the outer-most call (useful for macro
debugging).

---

## Runtime inspection

The default export (`import hql from "./mod.ts"`) exposes additional helpers
that mirror the named ones above. After running HQL code you can introspect
macros:

```ts
import hql from "./mod.ts";

await hql.run("(defmacro twice [x] `(+ ~x ~x))");
console.log(await hql.hasMacro("twice")); // true
console.log(await hql.getMacros()); // Map of runtime macros
await hql.resetRuntime(); // Clear macros/state
```

---

## Error handling

All helpers throw rich `HQLError` instances on failure. They include file/line
information derived from the transpiler so stack traces point back to the HQL
source.

```ts
try {
  await run("(let x 0) (/ 10 x)");
} catch (err) {
  console.error(err.message); // "Division by zero"
  console.error(err.sourceLocation); // { filePath: ..., line: ..., column: ... }
}
```

---

## Notes

- `.hql-cache/rt` is automatically managed; the runtime writes temporary modules
  there when imports are present.
- All helpers are safe to call concurrently; the transpiler caches intermediate
  results to avoid rebuilding the same module twice.
- The exported helpers are the same ones the CLI uses internally, so scripts and
  editors can embed HQL execution without relying on the CLI binary.
