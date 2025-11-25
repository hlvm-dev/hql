// Shared core implementations
// Re-exports from stdlib to make them available to TypeScript code
// This eliminates duplication between REPL and transpiled code
//
// The actual implementation is in stdlib/js/internal/range-core.js
// so that both pure JS (stdlib) and TypeScript (helpers) can use it

export { rangeCore } from "../lib/stdlib/js/internal/range-core.js";
