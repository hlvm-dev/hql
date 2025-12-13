// index.js - Public API exports for HQL stdlib
// Auto-injected into HQL runtime

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AUTO-DISCOVERY: Import all core functions at once
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// To add a new stdlib function:
// 1. Define and export it in core.js
// 2. That's it! Auto-available everywhere ✨
//
// No manual import lists. No manual STDLIB_PUBLIC_API entries.
// Just add to core.js and it works.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import * as Core from "./core.js";

// Export LazySeq class for advanced users (instanceof checks)
export { LazySeq } from "./internal/lazy-seq.js";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PUBLIC API - Auto-discovered from core.js
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// All exported functions from core.js are automatically available
// in HQL without imports (except __hql_* internal helpers).
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const STDLIB_PUBLIC_API = Object.fromEntries(
  Object.entries(Core).filter(([name, value]) =>
    typeof value === "function" && !name.startsWith("__hql_")
  )
);

// Add alias for backwards compatibility
STDLIB_PUBLIC_API.rangeGenerator = Core.range;

// Re-export all functions from core.js for direct import
// This includes both public API and __hql_* runtime helpers
export * from "./core.js";

// Backwards compatibility alias
export const rangeGenerator = Core.range;
