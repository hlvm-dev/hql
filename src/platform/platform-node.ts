/**
 * Platform Abstraction Layer — Node.js/Bun Entry Point
 *
 * This is the Node.js/Bun equivalent of platform.ts.
 * The npm build script swaps platform.ts → platform-node.ts so that
 * getPlatform() returns NodePlatform instead of DenoPlatform.
 *
 * Usage is identical:
 *   const p = getPlatform();
 *   await p.fs.readTextFile(path);
 */

export type {
  Platform,
  PlatformCommandProcess,
} from "./types.ts";

import { NodePlatform } from "./node-platform.ts";
export { NodePlatform };

import type { Platform } from "./types.ts";

// =============================================================================
// Platform Singleton
// =============================================================================

let activePlatform: Platform = NodePlatform;

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
