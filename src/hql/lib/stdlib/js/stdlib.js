// stdlib.js - Compatibility shim
// Re-exports from the new modular structure
// This file exists for backwards compatibility with code that imports from stdlib.js
// CONSOLIDATED: All lazy sequences use seq-protocol.js (thunk-based, O(1) rest)

export * from "./index.js";
export { STDLIB_PUBLIC_API } from "./index.js";

// Export seq-protocol for testing lazy sequences properly
export {
  SEQ,
  LazySeq,
  lazySeq,
  isSeq,
  isLazySeq,
} from "./internal/seq-protocol.js";
