# Import/Export

## Overview

HQL provides a module system based on ES module semantics. Imports are statically analyzed and resolved at compile time. The transpiler emits standard JavaScript ES module `import`/`export` statements.

Supported import sources:

- Local `.hql` files (transpiled to JavaScript)
- Local `.js`, `.mjs`, `.cjs` files (processed for nested HQL imports)
- Local `.ts`, `.tsx` files (transpiled via esbuild, then processed)
- Remote modules via `npm:`, `jsr:`, `http://`, `https://` specifiers
- Embedded `@hlvm/*` stdlib packages

## Import Syntax

### Named Import

```lisp
(import [add] from "./math.hql")
(import [add, subtract, multiply] from "./math.hql")
```

Compiles to:

```javascript
import { add } from "./math.hql";
import { add, subtract, multiply } from "./math.hql";
```

### Aliased Import

```lisp
(import [longName as short] from "./module.hql")
(import [add as sum, multiply as times] from "./math.hql")
```

Compiles to:

```javascript
import { longName as short } from "./module.hql";
import { add as sum, multiply as times } from "./math.hql";
```

### Namespace Import

```lisp
(import math from "./math.hql")
(math.add 1 2)
```

Compiles to:

```javascript
import * as math from "./math.hql";
math.add(1, 2);
```

### Simple Import (side-effect only)

```lisp
(import "./setup.hql")
```

Compiles to:

```javascript
import "./setup.hql";
```

### Default Import

```lisp
(import [default] from "npm:chalk@4.1.2")
(var chalk default)
```

Compiles to:

```javascript
import { default as _default } from "npm:chalk@4.1.2";
```

The `default` keyword is preserved in the imported name for default exports.

### Dynamic Import

```lisp
(import-dynamic "./module.hql")
```

Compiles to:

```javascript
import("./module.hql")
```

Returns a Promise. Use with `await` in async context:

```lisp
(let mod (await (import-dynamic "./heavy-module.hql")))
```

## Export Syntax

### Declaration Export

```lisp
(export (fn add [a b] (+ a b)))
(export (let PI 3.14159))
(export (var counter 0))
(export (class Calculator ...))
(export (enum Color ...))
```

Compiles to:

```javascript
export function add(a, b) { return a + b; }
export let PI = 3.14159;
export var counter = 0;
export class Calculator { ... }
```

Supported declaration keywords (from `ALL_DECLARATION_BINDING_KEYWORDS_SET`): `fn`, `function`, `defn`, `class`, `enum`, `let`, `var`, `const`, `def`.

### Vector Export

```lisp
(export [add, subtract])
(export [add as sum, subtract as diff])
```

Compiles to:

```javascript
export { add, subtract };
export { add as sum, subtract as diff };
```

Macros in the export vector are automatically filtered out at compile time (macros are compile-time only).

### Single Export

```lisp
(export myFunction)
```

Compiles to:

```javascript
export { myFunction };
```

### Default Export

```lisp
(export default myValue)
(export default (fn handler [] "ok"))
```

Compiles to:

```javascript
export default myValue;
export default function handler() { return "ok"; }
```

## Remote Imports

### JSR (Deno registry)

```lisp
(import [assertEquals] from "jsr:@std/assert")
```

Compiles to:

```javascript
import { assertEquals } from "jsr:@std/assert";
```

### HTTPS (direct URL)

```lisp
(import [assertEquals] from "https://deno.land/std@0.208.0/assert/mod.ts")
```

Passed through as-is to the output.

### NPM

```lisp
(import [default] from "npm:chalk@4.1.2")
```

For NPM modules, the runtime tries multiple CDN sources as fallback: direct `npm:` import, `esm.sh`, and `cdn.skypack.dev`.

## Macro Handling

Macros (`macro` definitions) are compile-time constructs. The import/export system handles them specially:

- Macros in import vectors are automatically skipped during JS codegen (they don't produce runtime `import` statements)
- Macros in export vectors are filtered out at compile time
- If all imports/exports in a statement are macros, the entire statement is omitted from output
- User-defined macros can be imported and are tracked in the global macro registry

## Hyphenated Identifiers

HQL identifiers with hyphens are sanitized for JavaScript compatibility via `sanitizeIdentifier()`:

```lisp
(import [my-func] from "./util.hql")
```

The hyphenated name is converted to a valid JavaScript identifier in the output.

## Circular Import Support

HQL handles circular imports by:

1. Detecting in-progress files via `inProgressFiles` set
2. Pre-registering exports with placeholder values for the circular module
3. Filling in actual values after full processing
4. Circular imports involving macros are rejected with an error (macros must be expanded at compile-time)

## Import Resolution

For local files, paths are resolved via `path().resolve(baseDir, modulePath)`:

- For nested imports (inside an imported module): `baseDir` is the importing file's directory
- For top-level imports: `baseDir` is the project root (or explicitly provided base directory)

Resolved paths are cached in an import map. Content-based caching (SHA-256 hashing) avoids redundant processing; cached files are stored in `.hql_cache`.

Security: relative import paths are validated to prevent path traversal outside the project directory. Null bytes in paths are rejected.

## Test Coverage

Tested in `tests/unit/organized/syntax/import-export/import-export.test.ts`:

- Named import (single and multiple)
- Import with alias (`as`)
- Namespace import
- Import constants and variables
- Chained function calls with imports
- Import class and instantiate / chain methods
- Import from multiple modules
- Re-exports through middleware module
- TypeScript file imports (function, multiple, constant)
- JSR imports (single, multiple)
- HTTPS URL imports (single, multiple)
- NPM default imports (chalk, ms)
