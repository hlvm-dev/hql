# HQL Transpilation & Bundling System

```
                  HQL TRANSPILATION & BUNDLING SYSTEM
                  ==================================

┌──────────────┐         (1) Input File
│  transpileCLI │◄───────────────────────── [input.hql/ts/js]
└──────┬───────┘
       │
       ▼
┌──────────────────────────────┐
│  processEntryFile            │
│                              │
│  ┌─────────┐   ┌──────────┐  │
│  │ HQL     │   │ JS/TS    │  │
│  │ files   │   │ files    │  │
│  └────┬────┘   └─────┬────┘  │
└───────┼──────────────┼───────┘
        │              │
        ▼              ▼
┌────────────┐   ┌───────────────┐
│ transpileToJavascript │   │ Process       │
│ (to TS)    │   │ HQL imports   │
└──────┬─────┘   └───────┬───────┘
       │                 │
       ▼                 │
┌─────────────────┐      │
│ Cache TS output │◄─────┘
└────────┬────────┘
         │
         ▼
┌─────────────────────────────┐
│  resolveHqlImport           │◄────┐
│                             │     │
│  1. Check externalPatterns  │     │  Import
│  2. Check cachedMapping     │     │  resolution
│  3. Try resolution strategies│     │  process
│  4. Return as external      │     │
└─────────────┬───────────────┘     │
              │                     │
              │     ┌───────────────┴───┐
              │     │ importPathMap     │
              │     │ (Caching system)  │
              │     └───────────────────┘
              ▼
┌─────────────────────────────┐
│  bundleWithEsbuild          │
│                             │
│  ┌─────────────────┐        │
│  │ createHqlPlugin │        │
│  └────────┬────────┘        │
│           │                 │
│           ▼                 │
│  ┌─────────────────┐        │
│  │ build.onResolve │        │
│  │ ◄──resolveHqlImport      │
│  └─────────────────┘        │
│                             │
│  ┌─────────────────┐        │
│  │ build.onLoad    │        │
│  │ ◄──loadHqlFile  │        │
│  └─────────────────┘        │
└─────────────┬───────────────┘
              │
              ▼
         [output.js]
```

## Process Flow

This diagram shows the HQL transpilation and bundling process:

1. `transpileCLI` takes an input file (HQL, TS, or JS)
2. `processEntryFile` branches based on file type
3. HQL files are transpiled to JavaScript via `transpileToJavascript`
4. JS/TS files have their HQL imports processed
5. All outputs are cached in the temp file tracker system
6. When resolving imports, `resolveHqlImport`:
   - Checks if the import should be treated as external (like .js files)
   - Looks for cached mappings in the `importPathMap`
   - Tries various resolution strategies
   - Registers mappings for future use
7. `bundleWithEsbuild` uses esbuild with custom plugins:
   - `build.onResolve` handles path resolution
   - `build.onLoad` handles loading and processing HQL files
8. Final bundled JS output is produced

## Import Resolution

The import resolution system is a critical part of the bundling process. The
system:

- Maps HQL imports to their cached JavaScript versions
- Handles JavaScript imports by marking them as external
- Maintains a cache of resolved paths to avoid redundant processing
- Silently handles external files (like .js files) without emitting warnings

## Cache System

The cache system is used to:

- Store intermediate transpilation results
- Avoid redundant processing of the same files
- Map original file paths to their transpiled versions
- Track dependencies between files

This system greatly improves performance for repeated builds and ensures
consistent output.
