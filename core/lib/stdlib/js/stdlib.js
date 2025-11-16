// stdlib.js - Compatibility shim
// Re-exports from the new modular structure
// This file exists for backwards compatibility with code that imports from stdlib.js

export * from "./index.js";
export { STDLIB_PUBLIC_API } from "./index.js";
export { LazySeq } from "./internal/lazy-seq.js";
