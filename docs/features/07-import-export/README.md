# Import/Export Feature Documentation

**Implementation:** Transpiler module system
**Coverage:** ✅ 100%

## Overview

HQL provides a comprehensive module system for code organization and
reusability:

1. **Local imports** - Import from relative file paths (.hql files)
2. **Namespace imports** - Import entire module as namespace
3. **Aliased imports** - Rename imports with `as` keyword
4. **Re-exports** - Export items imported from other modules
5. **TypeScript imports** - Import from .ts files
6. **Remote imports** - Import from JSR, HTTPS, and NPM
7. **Dynamic imports** - Runtime module loading (v2.0)

All imports are statically analyzed and resolved at compile time (except dynamic imports).

## Syntax

### Basic Import - Named Exports

```lisp
; Import single item
(import [functionName] from "./module.hql")

; Import multiple items
(import [func1, func2, const1] from "./module.hql")

; Use imported items
(func1 arg1 arg2)
```

### Aliased Imports

```lisp
; Rename imports with 'as'
(import [longFunctionName as short, anotherFunc as af] from "./module.hql")

; Use aliased names
(short arg)
(af arg)
```

### Namespace Import

```lisp
; Import entire module as namespace
(import moduleName from "./module.hql")

; Access via dot notation
(moduleName.function arg)
(moduleName.constant)
```

### Re-Exports

```lisp
; In middleware.hql:
(import [func1, func2] from "./original.hql")
(export func1)
(export func2)

; In consumer.hql:
(import [func1] from "./middleware.hql")  ; Gets func1 from original via middleware
```

### TypeScript File Imports

```lisp
; Import from .ts files
(import [tsFunction, TS_CONSTANT] from "./module.ts")

(tsFunction arg)
TS_CONSTANT
```

### Remote Imports

```lisp
; JSR (Deno registry)
(import [assertEquals] from "jsr:@std/assert")

; HTTPS (direct URL)
(import [assertEquals] from "https://deno.land/std@0.208.0/assert/mod.ts")

; NPM (Node packages)
(import [default] from "npm:chalk@4.1.2")
(var chalk default)
```

### Dynamic Import (v2.0)

Dynamic imports enable runtime module loading for code splitting and conditional loading:

```lisp
; Basic dynamic import
(let module (await (import-dynamic "./heavy-module.hql")))
(module.process data)

; Conditional loading
(async fn load-feature [name]
  (let path (+ "./" name ".hql"))
  (await (import-dynamic path)))

; With destructuring (in async context)
(async fn setup []
  (let {default as config} (await (import-dynamic "./config.hql")))
  (print config.version))

; Lazy loading based on condition
(when needsFeature
  (let feature (await (import-dynamic "./optional-feature.hql")))
  (feature.init))

; Error handling
(try
  (let mod (await (import-dynamic "./maybe-missing.hql")))
  (mod.run)
  (catch e
    (print "Module not found:" e)))
```

**Compilation:**

```lisp
(import-dynamic "./module.hql")
; Compiles to:
import("./module.mjs")
```

**Characteristics:**
- Returns a Promise that resolves to module namespace
- Path can be computed at runtime
- Enables code splitting for performance
- Useful for optional dependencies
- Must be used with `await` in async context

## Implementation Details

### Local Imports (.hql files)

**Compilation:**

```lisp
(import [add, subtract] from "./math.hql")

; Compiles to:
import { add, subtract } from "./math.hql.js";
```

**Characteristics:**

- ✅ Relative paths supported (`./`, `../`)
- ✅ .hql extension required in source
- ✅ Resolves to .js in compiled output
- ✅ Static analysis at compile time
- ✅ Circular imports supported

### Namespace Imports

**Compilation:**

```lisp
(import math from "./math.hql")
(math.add 1 2)

; Compiles to:
import * as math from "./math.hql.js";
math.add(1, 2);
```

**Characteristics:**

- ✅ Single identifier for entire module
- ✅ Dot notation for member access
- ✅ Prevents naming conflicts
- ✅ Common in large codebases

### Aliased Imports

**Compilation:**

```lisp
(import [longName as short] from "./module.hql")

; Compiles to:
import { longName as short } from "./module.hql.js";
```

**Characteristics:**

- ✅ Rename to avoid conflicts
- ✅ Shorten long names
- ✅ Multiple aliases in one import
- ✅ Original name not accessible

### Re-Exports

**Compilation:**

```lisp
; middleware.hql
(import [func] from "./original.hql")
(export func)

; Compiles to:
export { func } from "./original.hql.js";
```

**Characteristics:**

- ✅ Aggregate exports from multiple modules
- ✅ Create public API facade
- ✅ Hide internal structure
- ✅ Common in library entry points

### TypeScript Imports

**Compilation:**

```lisp
(import [tsFunc] from "./module.ts")

; Compiles to:
import { tsFunc } from "./module.ts";
```

**Characteristics:**

- ✅ Direct TypeScript interop
- ✅ No transpilation needed
- ✅ TypeScript types preserved
- ✅ Works with Deno's TS support

### Remote Imports (JSR)

**Compilation:**

```lisp
(import [assertEquals] from "jsr:@std/assert")

; Compiles to:
import { assertEquals } from "jsr:@std/assert";
```

**Characteristics:**

- ✅ Deno registry (jsr.io)
- ✅ Versioned packages
- ✅ TypeScript by default
- ✅ Fast, cached downloads

### Remote Imports (HTTPS)

**Compilation:**

```lisp
(import [assertEquals] from "https://deno.land/std@0.208.0/assert/mod.ts")

; Compiles to:
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
```

**Characteristics:**

- ✅ Direct URL imports
- ✅ Versioned via URL
- ✅ Cached by Deno
- ✅ No package.json needed

### Remote Imports (NPM)

**Compilation:**

```lisp
(import [default] from "npm:chalk@4.1.2")

; Compiles to:
import _default from "npm:chalk@4.1.2";
```

**Characteristics:**

- ✅ Node.js package ecosystem
- ✅ Version specifications
- ✅ CommonJS/ESM compatibility
- ✅ Deno's npm: specifier

## Features Covered

✅ Import single function from local module ✅ Import multiple functions from
local module ✅ Import constants from local module ✅ Import variables from
local module ✅ Import with alias (as keyword) ✅ Namespace import (import
module as namespace) ✅ Import and chain function calls ✅ Import class and
instantiate ✅ Import class and chain methods ✅ Import and use in expressions
✅ Import constants in computations ✅ Import from multiple modules ✅ Re-export
function through middleware ✅ Re-export multiple items ✅ Re-export value
through middleware ✅ Import function from TypeScript file ✅ Import multiple
functions from TypeScript file ✅ Import constant from TypeScript file ✅ Import
from JSR (single function) ✅ Import from JSR (multiple functions) ✅ Import
from HTTPS URL ✅ Import multiple from HTTPS URL ✅ Import default export from
NPM (chalk) ✅ Import default export from NPM (ms) ✅ Use NPM import in variable
assignment ✅ Dynamic import with await ✅ Dynamic import with computed path
✅ Dynamic import with error handling

## Test Coverage



### Section 1: Local Imports

- Import single function
- Import multiple functions
- Import constants
- Import variables
- Import with alias
- Namespace import
- Chained function calls
- Import class and instantiate
- Import class and chain methods
- Import and use in expression
- Import constants in computation
- Import from multiple modules

### Section 2: Re-Exports

- Import function through re-export
- Import multiple items through re-export
- Import value through re-export

### Section 3: TypeScript Imports

- Import function from .ts file
- Import multiple functions from .ts file
- Import constant from .ts file

### Section 4: Remote Imports

- Import from JSR (single)
- Import from JSR (multiple)
- Import from HTTPS URL
- Import multiple from HTTPS
- Import NPM default (chalk)
- Import NPM default (ms)
- Use NPM import in assignment

### Section 5: Dynamic Imports (v2.0)

- Dynamic import with await
- Dynamic import with computed path
- Conditional module loading
- Error handling for missing modules
- Dynamic import in async functions

## Use Cases

### 1. Code Organization (Local Imports)

```lisp
; math.hql
(export (fn add [a b] (+ a b)))
(export (fn subtract [a b] (- a b)))

; main.hql
(import [add, subtract] from "./math.hql")
(add 10 5)
```

### 2. Avoid Name Conflicts (Aliases)

```lisp
(import [map as arrayMap] from "./array-utils.hql")
(import [map as objectMap] from "./object-utils.hql")

(arrayMap [1, 2, 3] double)
(objectMap { a: 1 } increment)
```

### 3. Library Facade (Re-Exports)

```lisp
; public-api.hql
(import [func1] from "./internal/module1.hql")
(import [func2] from "./internal/module2.hql")
(export func1)
(export func2)
```

### 4. TypeScript Interop

```lisp
; Use existing TypeScript code
(import [validate, parse] from "./validator.ts")

(var result (parse input))
(validate result)
```

### 5. Use Standard Library (JSR)

```lisp
; Test utilities
(import [assertEquals, assertExists] from "jsr:@std/assert")

(assertEquals actual expected)
(assertExists value)
```

### 6. Direct URL Imports (HTTPS)

```lisp
; No package manager needed
(import [assertEquals] from "https://deno.land/std@0.208.0/assert/mod.ts")
```

### 7. Node.js Packages (NPM)

```lisp
; Use npm ecosystem
(import [default] from "npm:chalk@4.1.2")
(var chalk default)
(chalk.red "Error message")
```

## Comparison with Other Languages

### JavaScript/TypeScript ES Modules

```javascript
// JavaScript
import { add, subtract } from "./math.js";
import * as math from "./math.js";
import { add as sum } from "./math.js";

// HQL (same concept)
(import [add, subtract] from "./math.hql")
(import math from "./math.hql")
(import [add as sum] from "./math.hql")
```

### Python Imports

```python
# Python
from math import add, subtract
import math
from math import add as sum

# HQL
(import [add, subtract] from "./math.hql")
(import math from "./math.hql")
(import [add as sum] from "./math.hql")
```

### Node.js CommonJS

```javascript
// CommonJS (old)
const { add, subtract } = require("./math");

// HQL (ESM-style)
(import [add, subtract] from "./math.hql")
```

## Related Specs

- Complete module system specification available in project specs
- Transpiler import/export transformers in module system
- Circular import resolution in module loader

## Examples

See `examples.hql` for executable examples.

## Transform Pipeline

```
HQL Import/Export Syntax
  ↓
S-expression Parser
  ↓
Import/Export Transformers
  ↓
Module Resolution (paths, JSR, HTTPS, NPM)
  ↓
IR Nodes (ImportDeclaration, ExportDeclaration)
  ↓
ESTree (JavaScript AST)
  ↓
JavaScript ES Modules
```

## Best Practices

### Use Named Exports (Not Default)

```lisp
; ✅ Good: Named exports (explicit)
(export (fn add [a b] (+ a b)))
(import [add] from "./math.hql")

; ⚠️ Avoid: Default exports (less clear)
(export default add)
(import [default] from "./math.hql")
```

### Group Related Imports

```lisp
; ✅ Good: Grouped by source
(import [add, subtract, multiply] from "./math.hql")
(import [validate, parse] from "./utils.hql")

; ❌ Avoid: Scattered imports
(import [add] from "./math.hql")
(import [validate] from "./utils.hql")
(import [subtract] from "./math.hql")
```

### Use Aliases for Conflicts

```lisp
; ✅ Good: Clear aliases
(import [map as arrayMap] from "./array.hql")
(import [map as objectMap] from "./object.hql")

; ❌ Avoid: No aliases (naming conflict)
(import [map] from "./array.hql")
(import [map] from "./object.hql")  ; Error!
```

### Prefer Relative Paths for Local

```lisp
; ✅ Good: Relative path (explicit)
(import [util] from "./utils.hql")
(import [helper] from "../helpers.hql")

; ❌ Avoid: Absolute paths (fragile)
(import [util] from "/absolute/path/utils.hql")
```

## Edge Cases Tested

✅ Import single and multiple items ✅ Import with aliases (rename) ✅ Namespace
imports (entire module) ✅ Import classes and instantiate ✅ Method chaining on
imported classes ✅ Using imports in expressions ✅ Multiple imports from
different modules ✅ Re-exports through middleware ✅ TypeScript file imports ✅
Remote imports (JSR, HTTPS, NPM) ✅ NPM default exports ✅ Circular imports
(supported)

## Common Patterns

### 1. Utility Module

```lisp
; utils.hql
(export (fn double [x] (* x 2)))
(export (fn triple [x] (* x 3)))

; main.hql
(import [double, triple] from "./utils.hql")
```

### 2. Barrel Exports (Re-exports)

```lisp
; index.hql (public API)
(import [func1] from "./internal/a.hql")
(import [func2] from "./internal/b.hql")
(export func1)
(export func2)
```

### 3. Test Utilities

```lisp
; tests/helpers.hql
(import [assertEquals] from "jsr:@std/assert")
(export (fn runTest [testFn] (testFn)))
```

### 4. External Library Usage

```lisp
; Using lodash from npm
(import [default] from "npm:lodash@4.17.21")
(var _ default)
(_.map [1, 2, 3] double)
```

## Performance Considerations

**Module Resolution:**

- ✅ Local imports: Instant (filesystem)
- ✅ JSR imports: Cached after first download
- ✅ HTTPS imports: Cached after first download
- ✅ NPM imports: Cached, but slower initial load

**Best Practices:**

- Prefer local imports for internal code
- Use JSR for Deno-first packages
- Use NPM for Node.js ecosystem
- Pin versions for remote imports (reproducibility)

## Security Considerations

**Remote Imports:**

- ✅ HTTPS ensures integrity (not HTTP)
- ✅ Deno caches and locks dependencies
- ✅ Review code before importing
- ✅ Pin versions to prevent supply chain attacks

**Safe Usage:**

- Always use HTTPS (not HTTP)
- Pin specific versions (not `@latest`)
- Review third-party code
- Use lockfiles for reproducibility

## Circular Import Support

HQL supports circular imports:

```lisp
; a.hql
(import [funcB] from "./b.hql")
(export (fn funcA [] (funcB)))

; b.hql
(import [funcA] from "./a.hql")
(export (fn funcB [] (funcA)))
```

**How it works:**

- Module cache prevents infinite loops
- Exports are hoisted
- Circular references resolved at runtime

## Summary

HQL's module system provides:

- ✅ **Local imports** (.hql files, relative paths)
- ✅ **Aliased imports** (rename with `as`)
- ✅ **Namespace imports** (entire module as object)
- ✅ **Re-exports** (aggregate from multiple sources)
- ✅ **TypeScript interop** (.ts file imports)
- ✅ **Remote imports** (JSR, HTTPS, NPM)
- ✅ **Circular import support** (module cache)
- ✅ **ES Module output** (standard JavaScript)

Choose the right import strategy:

- **Local**: Internal code organization
- **JSR**: Deno ecosystem packages
- **HTTPS**: Direct URL dependencies
- **NPM**: Node.js ecosystem
- **TypeScript**: Existing .ts code
