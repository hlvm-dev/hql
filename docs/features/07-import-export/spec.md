# Import/Export Specification

## Supported Import Sources

| Source | Format | Processing |
|--------|--------|-----------|
| HQL files | `.hql` | Parsed, macro-expanded, transpiled to JS |
| JavaScript files | `.js`, `.mjs`, `.cjs` | Checked for nested HQL imports, cached |
| TypeScript files | `.ts`, `.tsx` | Transpiled to JS via esbuild, then processed |
| NPM modules | `npm:package` | Imported via Deno's `npm:` specifier, fallback to esm.sh/skypack CDNs |
| JSR modules | `jsr:@scope/pkg` | Imported directly from JSR registry |
| HTTP(S) modules | `https://...`, `http://...` | Imported directly from URL |
| Embedded stdlib | `@hlvm/*` | Loaded from embedded package content |

## Import Forms

### Named Import (vector style)

```
(import [symbol1, symbol2] from "module-path")
```

The `from` keyword is required. Symbols are listed in a vector `[...]`. Commas between symbols are optional (treated as whitespace by the parser).

### Named Import with Alias

```
(import [symbol1, symbol2 as alias2] from "module-path")
```

The `as` keyword renames the import in local scope.

### Namespace Import

```
(import name from "module-path")
```

When the second element is a bare symbol (not a vector), this produces `import * as name from "..."`.

### Simple Import (side-effect)

```
(import "module-path")
```

No specifiers. Produces `import "module-path";`. Used for modules imported for side effects only.

### Dynamic Import

```
(import-dynamic "module-path")
(import-dynamic some-variable)
```

Produces `import("module-path")` or `import(some_variable)`. This is a separate form from `import` -- it uses the keyword `import-dynamic`. The argument can be a string literal or any expression. Returns a Promise.

## Export Forms

### Declaration Export

```
(export (fn name [params] body))
(export (let name value))
(export (var name value))
(export (const name value))
(export (class Name ...))
(export (enum Name ...))
```

The inner form must be a declaration (function, variable, class, or enum). Validated against `ALL_DECLARATION_BINDING_KEYWORDS_SET` which includes: `fn`, `function`, `defn`, `class`, `enum`, `let`, `var`, `const`, `def`.

### Vector Export

```
(export [name1, name2])
(export [name1 as alias1, name2])
```

Exports previously defined symbols by name. Supports `as` aliases. Macros in the vector are silently filtered out.

### Single Export

```
(export name)
```

Exports a single previously defined symbol. Produces `export { name };`.

### Default Export

```
(export default expression)
```

Produces `export default <expression>;`. The expression is transformed recursively.

## Macro Filtering

Both import and export processing check whether symbols are macros:

- **Import**: macros are skipped from the JS `import` statement. If all symbols in an import are macros, the entire import declaration is omitted.
- **Export**: macros are skipped from the JS `export` statement. If all symbols are macros, the entire export declaration is omitted.

Macro detection uses both the symbol table (`currentSymbolTable`) and the global macro registry (`globalMacroRegistry`).

## Import Resolution (Runtime)

The `processImports()` function in `imports.ts` handles runtime import resolution during the interpreter/macro-expansion phase:

1. Import expressions are categorized as remote or local
2. Remote imports are processed in parallel via `Promise.all`
3. Local imports are processed sequentially
4. For each import, the module type determines the loading strategy:
   - HQL: parse, expand macros, process nested imports, collect exports
   - JS: check for nested HQL imports, process if found, dynamic `import()`
   - TS: transpile to JS via esbuild, then load as JS
   - Remote (npm/jsr/http): dynamic `import()` with CDN fallback for npm

### Path Resolution

For local files, paths are resolved via `path().resolve(baseDir, modulePath)`:

- For nested imports (inside an imported module): `baseDir` is the importing file's directory
- For top-level imports: `baseDir` is the project root (or explicitly provided base directory)

### Security

- Relative paths are validated against the project base directory (no path traversal)
- Null bytes in paths are rejected
- Remote URLs and package specifiers (`npm:`, `jsr:`, `@hlvm/`) bypass path validation

## Circular Import Handling

1. Each file being processed is tracked in an `inProgressFiles` set
2. When a circular dependency is detected, the system:
   - Reads and parses the target file to find export definitions
   - Checks if any exports are macros (circular macro imports are rejected with an error)
   - Pre-registers empty exports with placeholder values
   - Returns, allowing the importing file to complete
3. Placeholder values are filled in when the target file finishes processing

## Caching

- File content is cached via SHA-256 content hashing
- Cached transpiled files are stored in `.hql_cache` directory
- Import path mappings are cached to avoid redundant resolution
- File line caches are maintained for error reporting (LRU, limit 2000 files)
- Module IDs use hash-based naming (`__module_{basename}_{hash}`) to prevent collisions

## Identifier Sanitization

All imported and exported identifiers pass through `sanitizeIdentifier()` to produce valid JavaScript names. The `default` keyword is preserved as-is for default imports.
