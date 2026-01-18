/**
 * Platform Abstraction Layer
 *
 * This module provides the public API for platform operations.
 * All platform operations are accessed via getPlatform().
 *
 * Usage:
 *   const p = getPlatform();
 *   await p.fs.readTextFile(path);
 *   p.path.join(...paths);
 *   p.env.get("HOME");
 *   p.process.cwd();
 */

// Re-export only types that are actually used externally
// (Other types can be imported directly from ./types.ts if needed)
export type {
  Platform,
  PlatformCommandProcess,
} from "./types.ts";

// Import and re-export the implementation
import { DenoPlatform } from "./deno-platform.ts";
export { DenoPlatform };

import type { Platform } from "./types.ts";

// =============================================================================
// Platform Singleton
// =============================================================================

let activePlatform: Platform = DenoPlatform;

/**
 * Set the active platform implementation.
 * Use this for testing or to swap to a different runtime.
 */
export function setPlatform(platform: Platform): void {
  activePlatform = platform;
}

/**
 * Get the active platform implementation.
 */
export function getPlatform(): Platform {
  return activePlatform;
}
