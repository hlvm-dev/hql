/**
 * Platform Types and Interfaces
 *
 * This file defines all platform-agnostic types and interfaces for the HLVM platform layer.
 * Only src/platform/deno-platform.ts should import Deno types directly.
 */

// =============================================================================
// File System Types
// =============================================================================

export interface PlatformFileInfo {
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
}

export interface PlatformDirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
}

export interface PlatformRemoveOptions {
  recursive?: boolean;
}

export interface PlatformMakeTempDirOptions {
  prefix?: string;
  suffix?: string;
}

export interface PlatformWriteOptions {
  append?: boolean;
  create?: boolean;
  mode?: number;
}

// =============================================================================
// Process/Command Types
// =============================================================================

export interface PlatformCommandResult {
  success: boolean;
  code: number;
  signal?: string | number;
}

export interface PlatformCommandProcess {
  status: Promise<PlatformCommandResult>;
  stdout?: unknown;
  stderr?: unknown;
  kill?(signal?: string | number): void;
  /** Detach the process so parent can exit without waiting for it */
  unref?(): void;
}

export interface PlatformCommandOptions {
  cmd: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdin?: "piped" | "inherit" | "null";
  stdout?: "piped" | "inherit" | "null";
  stderr?: "piped" | "inherit" | "null";
}

/** Result from command.output() - complete command execution with captured output */
export interface PlatformCommandOutput {
  code: number;
  success: boolean;
  stdout: Uint8Array;
  stderr: Uint8Array;
}

// =============================================================================
// Terminal/IO Sub-Interfaces
// =============================================================================

export interface PlatformStdin {
  /** Read bytes from stdin into buffer, returns bytes read or null on EOF */
  read(buffer: Uint8Array): Promise<number | null>;
  /** Check if stdin is connected to a terminal (TTY) */
  isTerminal(): boolean;
  /** Set raw mode (no line buffering, no echo) */
  setRaw(raw: boolean): void;
}

export interface PlatformStdout {
  /** Write bytes to stdout synchronously, returns bytes written */
  writeSync(data: Uint8Array): number;
  /** Write bytes to stdout asynchronously, returns bytes written */
  write(data: Uint8Array): Promise<number>;
}

export interface PlatformTerminal {
  stdin: PlatformStdin;
  stdout: PlatformStdout;
  /** Get console size in columns and rows */
  consoleSize(): { columns: number; rows: number };
}

// =============================================================================
// File System Sub-Interface
// =============================================================================

export interface PlatformFs {
  // Text file operations
  readTextFile(path: string): Promise<string>;
  readTextFileSync(path: string): string;
  writeTextFile(path: string, data: string, options?: PlatformWriteOptions): Promise<void>;
  writeTextFileSync(path: string, data: string, options?: PlatformWriteOptions): void;

  // Binary file operations
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;

  // File info operations
  stat(path: string): Promise<PlatformFileInfo>;
  statSync(path: string): PlatformFileInfo;
  exists(path: string): Promise<boolean>;

  // Directory operations
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  mkdirSync(path: string, opts?: { recursive?: boolean }): void;
  ensureDir(path: string): Promise<void>;
  readDir(path: string): AsyncIterable<PlatformDirEntry>;
  makeTempDir(options?: PlatformMakeTempDirOptions): Promise<string>;

  // File manipulation
  remove(path: string, options?: PlatformRemoveOptions): Promise<void>;
  removeSync(path: string, options?: PlatformRemoveOptions): void;
  copyFile(src: string, dest: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
}

// =============================================================================
// Path Sub-Interface
// =============================================================================

export interface PlatformPath {
  join(...segments: string[]): string;
  dirname(path: string): string;
  basename(path: string, ext?: string): string;
  extname(path: string): string;
  isAbsolute(path: string): boolean;
  resolve(...segments: string[]): string;
  normalize(path: string): string;
  relative(from: string, to: string): string;
  fromFileUrl(url: string | URL): string;
  toFileUrl(path: string): URL;
}

// =============================================================================
// Environment Sub-Interface
// =============================================================================

export interface PlatformEnv {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

// =============================================================================
// Process Sub-Interface
// =============================================================================

export type SignalType = "SIGINT" | "SIGTERM" | "SIGHUP" | "SIGQUIT";

export interface PlatformProcess {
  cwd(): string;
  execPath(): string;
  args(): string[];
  exit(code: number): never;
  addSignalListener(signal: SignalType, handler: () => void): void;
}

// =============================================================================
// Build/System Info Sub-Interface
// =============================================================================

export type OperatingSystem = "darwin" | "linux" | "windows";

export interface PlatformBuild {
  os: OperatingSystem;
}

// =============================================================================
// Command Execution Sub-Interface
// =============================================================================

export interface PlatformCommand {
  /** Spawn a command and return a process handle */
  run(options: PlatformCommandOptions): PlatformCommandProcess;
  /** Execute command and wait for completion, capturing stdout/stderr */
  output(options: PlatformCommandOptions): Promise<PlatformCommandOutput>;
}

// =============================================================================
// Main Platform Interface (Composed)
// =============================================================================

/**
 * Platform interface defines all necessary platform-specific operations.
 *
 * This is the main abstraction layer between HLVM and the host runtime.
 * Only one implementation (DenoPlatform) exists today, but this design
 * enables future Node.js or Bun implementations.
 */
export interface Platform {
  /** Terminal I/O operations (stdin, stdout) */
  terminal: PlatformTerminal;

  /** File system operations */
  fs: PlatformFs;

  /** Path manipulation operations */
  path: PlatformPath;

  /** Environment variable operations */
  env: PlatformEnv;

  /** Process control operations */
  process: PlatformProcess;

  /** Build/system information */
  build: PlatformBuild;

  /** Command execution */
  command: PlatformCommand;

  /** Open URL in system browser */
  openUrl(url: string): Promise<void>;
}
