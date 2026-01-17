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
// Backward-Compatible Flat Exports
// =============================================================================

// These exports maintain compatibility with existing code that uses:
//   import { readTextFile } from "../platform/platform.ts"
// New code should prefer:
//   import { getPlatform } from "../platform/platform.ts"
//   getPlatform().fs.readTextFile(path)

// --- File System Operations ---

export function stat(path: string): Promise<PlatformFileInfo> {
  return activePlatform.fs.stat(path);
}

export function readTextFile(path: string): Promise<string> {
  return activePlatform.fs.readTextFile(path);
}

export function writeTextFile(
  path: string,
  data: string,
  options?: { append?: boolean; create?: boolean; mode?: number },
): Promise<void> {
  return activePlatform.fs.writeTextFile(path, data, options);
}

export function writeTextFileSync(path: string, data: string): void {
  return activePlatform.fs.writeTextFileSync(path, data);
}

export function readTextFileSync(path: string): string {
  return activePlatform.fs.readTextFileSync(path);
}

export function mkdir(
  path: string,
  opts?: { recursive?: boolean },
): Promise<void> {
  return activePlatform.fs.mkdir(path, opts);
}

export function ensureDir(path: string): Promise<void> {
  return activePlatform.fs.ensureDir(path);
}

export function readDir(path: string): AsyncIterable<PlatformDirEntry> {
  return activePlatform.fs.readDir(path);
}

export function makeTempDir(
  options?: PlatformMakeTempDirOptions,
): Promise<string> {
  return activePlatform.fs.makeTempDir(options);
}

export function remove(
  path: string,
  options?: PlatformRemoveOptions,
): Promise<void> {
  return activePlatform.fs.remove(path, options);
}

export function removeSync(
  path: string,
  options?: PlatformRemoveOptions,
): void {
  return activePlatform.fs.removeSync(path, options);
}

export function exists(path: string): Promise<boolean> {
  return activePlatform.fs.exists(path);
}

export function copyFile(src: string, dest: string): Promise<void> {
  return activePlatform.fs.copyFile(src, dest);
}

// --- Path Operations ---

export function join(...segments: string[]): string {
  return activePlatform.path.join(...segments);
}

export function dirname(path: string): string {
  return activePlatform.path.dirname(path);
}

export function basename(path: string, ext?: string): string {
  return activePlatform.path.basename(path, ext);
}

export function extname(path: string): string {
  return activePlatform.path.extname(path);
}

export function isAbsolute(path: string): boolean {
  return activePlatform.path.isAbsolute(path);
}

export function resolve(...segments: string[]): string {
  return activePlatform.path.resolve(...segments);
}

export function normalize(path: string): string {
  return activePlatform.path.normalize(path);
}

export function relative(from: string, to: string): string {
  return activePlatform.path.relative(from, to);
}

export function fromFileUrl(url: string | URL): string {
  return activePlatform.path.fromFileUrl(url);
}

export function toFileUrl(path: string): URL {
  return activePlatform.path.toFileUrl(path);
}

// --- Environment Operations ---

export function getEnv(key: string): string | undefined {
  return activePlatform.env.get(key);
}

export function setEnv(key: string, value: string): void {
  return activePlatform.env.set(key, value);
}

// --- Process Operations ---

export function cwd(): string {
  return activePlatform.process.cwd();
}

export function execPath(): string {
  return activePlatform.process.execPath();
}

export function getArgs(): string[] {
  return activePlatform.process.args();
}

export function exit(code: number): never {
  return activePlatform.process.exit(code);
}

// --- Command Operations ---

export function runCmd(options: {
  cmd: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdin?: "piped" | "inherit" | "null";
  stdout?: "piped" | "inherit" | "null";
  stderr?: "piped" | "inherit" | "null";
}): PlatformCommandProcess {
  return activePlatform.command.run(options);
}

// --- Other Operations ---

export function openUrl(url: string): Promise<void> {
  return activePlatform.openUrl(url);
}
