/**
 * Platform Abstraction Layer
 *
 * This module provides the public API for platform operations.
 * It re-exports types and provides backward-compatible convenience functions.
 *
 * For new code, prefer using getPlatform().fs.readTextFile() over readTextFile().
 * The flat exports are maintained for backward compatibility.
 */

// Re-export all types
export type {
  OperatingSystem,
  Platform,
  PlatformBuild,
  PlatformCommand,
  PlatformCommandOptions,
  PlatformCommandProcess,
  PlatformCommandResult,
  PlatformDirEntry,
  PlatformEnv,
  PlatformFileInfo,
  PlatformFs,
  PlatformMakeTempDirOptions,
  PlatformPath,
  PlatformProcess,
  PlatformRemoveOptions,
  PlatformStdin,
  PlatformStdout,
  PlatformTerminal,
  PlatformWriteOptions,
  SignalType,
} from "./types.ts";

// Re-export error types
export { PlatformError, PlatformErrorCode } from "./errors.ts";

// Import and re-export the implementation
import { DenoPlatform } from "./deno-platform.ts";
export { DenoPlatform };

import type {
  Platform,
  PlatformCommandProcess,
  PlatformDirEntry,
  PlatformFileInfo,
  PlatformMakeTempDirOptions,
  PlatformRemoveOptions,
} from "./types.ts";

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
 * Prefer using this over the flat exports for new code.
 */
export function getPlatform(): Platform {
  return activePlatform;
}

// =============================================================================
// All platform operations are now accessed via getPlatform()
// =============================================================================
//
// Usage:
//   import { getPlatform } from "../platform/platform.ts"
//   const p = getPlatform();
//   await p.fs.readTextFile(path);
//   p.path.join(...paths);
//   p.env.get("HOME");
//   p.process.cwd();
//
