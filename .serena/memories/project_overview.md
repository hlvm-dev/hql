# HQL Project Overview

## Purpose
HQL is a Lisp dialect programming language that transpiles to JavaScript/TypeScript. It's a custom language (NOT Clojure) with its own syntax.

## Tech Stack
- **Runtime**: Deno
- **Language**: TypeScript
- **Build**: Deno compile + Make
- **Dependencies**: source-map, typescript npm packages

## Code Structure
- `src/` - Core source code
  - `src/cli/` - CLI implementation
  - `src/interpreter/` - HQL interpreter
  - `src/transpiler/` - HQL to JS transpilation
  - `src/runtime/` - Runtime support
  - `src/s-exp/` - S-expression parsing
  - `src/common/` - Shared utilities
  - `src/platform/` - Platform-specific code
  - `src/lib/` - Standard library
- `tests/` - Test suites
- `docs/` - Documentation (source of truth for HQL syntax)
- `packages/` - HQL packages
- `lsp/` - Language Server Protocol implementation

## Key Files
- `src/cli/cli.ts` - Main entry point
- `mod.ts` - Module exports
- `deno.json` - Deno configuration
