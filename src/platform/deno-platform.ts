/**
 * Deno Platform Implementation
 *
 * This is the ONLY file that should make Deno.* runtime API calls.
 * All other code should use the Platform interface via getPlatform().
 *
 * Note: String literals like Symbol.for("Deno.customInspect") are allowed
 * elsewhere as they don't create runtime dependencies.
 */

import * as nodePath from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  Platform,
  PlatformBuild,
  PlatformCommand,
  PlatformCommandOptions,
  PlatformCommandOutput,
  PlatformCommandProcess,
  PlatformDirEntry,
  PlatformEnv,
  PlatformFileInfo,
  PlatformFs,
  PlatformFsEvent,
  PlatformFsWatcher,
  PlatformHttp,
  PlatformHttpServeOptions,
  PlatformHttpServerHandle,
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
import { buildOpenCommands } from "./platform-shared.ts";

// =============================================================================
// Helper Functions
// =============================================================================

async function denoEnsureDir(directory: string): Promise<void> {
  try {
    await Deno.mkdir(directory, { recursive: true });
  } catch (error) {
    if (error instanceof Deno.errors.AlreadyExists) {
      // Verify it's actually a directory, not a file blocking the path
      const stat = await Deno.stat(directory);
      if (stat.isDirectory) {
        return;
      }
      // A file exists at this path - throw descriptive error
      throw new Deno.errors.NotADirectory(
        `Cannot create directory '${directory}': a file exists at this path`,
      );
    }
    throw error;
  }
}

async function denoExists(filePath: string): Promise<boolean> {
  try {
    await Deno.stat(filePath);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}

function toPlatformFileInfo(info: Deno.FileInfo): PlatformFileInfo {
  return {
    isFile: info.isFile,
    isDirectory: info.isDirectory,
    isSymlink: info.isSymlink,
    size: info.size ?? 0,
  };
}

function toPlatformDirEntry(entry: Deno.DirEntry): PlatformDirEntry {
  return {
    name: entry.name,
    isFile: entry.isFile,
    isDirectory: entry.isDirectory,
    isSymlink: entry.isSymlink,
  };
}

async function* denoReadDir(
  directoryPath: string,
): AsyncIterable<PlatformDirEntry> {
  for await (const entry of Deno.readDir(directoryPath)) {
    yield toPlatformDirEntry(entry);
  }
}

function createDenoCommand(options: PlatformCommandOptions): Deno.Command {
  return new Deno.Command(options.cmd[0], {
    args: options.cmd.slice(1),
    cwd: options.cwd,
    env: options.env,
    stdin: options.stdin,
    stdout: options.stdout,
    stderr: options.stderr,
  });
}

/** Run the OS-specific commands to open a URL or file path and bring it to front. */
async function runOpenUrlCommands(url: string): Promise<void> {
  const commands = buildOpenCommands(DenoBuild.os, url);
  for (const { cmd, args } of commands) {
    const status = await new Deno.Command(cmd, { args }).spawn().status;
    if (!status.success) {
      throw new Error(`Failed to open URL: ${url} (exit code: ${status.code})`);
    }
  }
}

// =============================================================================
// Terminal Implementation
// =============================================================================

const DenoStdin: PlatformStdin = {
  read: (buffer: Uint8Array): Promise<number | null> => Deno.stdin.read(buffer),
  isTerminal: (): boolean => {
    return Deno.stdin.isTerminal();
  },
  setRaw: (raw: boolean): void => {
    Deno.stdin.setRaw(raw);
  },
};

const DenoStdout: PlatformStdout = {
  writeSync: (data: Uint8Array): number => {
    return Deno.stdout.writeSync(data);
  },
  write: (data: Uint8Array): Promise<number> => Deno.stdout.write(data),
};

const DenoTerminal: PlatformTerminal = {
  stdin: DenoStdin,
  stdout: DenoStdout,
  consoleSize: (): { columns: number; rows: number } => {
    try {
      return Deno.consoleSize();
    } catch {
      // Fallback for non-TTY environments
      return { columns: 80, rows: 24 };
    }
  },
};

// =============================================================================
// File System Implementation
// =============================================================================

const DenoFs: PlatformFs = {
  // Text file operations
  readTextFile: (path: string): Promise<string> => Deno.readTextFile(path),
  readTextFileSync: (path: string): string => {
    return Deno.readTextFileSync(path);
  },
  writeTextFile: (
    path: string,
    data: string,
    options?: PlatformWriteOptions,
  ): Promise<void> => Deno.writeTextFile(path, data, options),
  writeTextFileSync: (
    path: string,
    data: string,
    options?: PlatformWriteOptions,
  ): void => {
    Deno.writeTextFileSync(path, data, options);
  },

  // Binary file operations
  readFile: (path: string): Promise<Uint8Array> => Deno.readFile(path),
  writeFile: (path: string, data: Uint8Array): Promise<void> =>
    Deno.writeFile(path, data),

  // File info operations
  stat: (path: string): Promise<PlatformFileInfo> =>
    Deno.stat(path).then(toPlatformFileInfo),
  statSync: (path: string): PlatformFileInfo => {
    return toPlatformFileInfo(Deno.statSync(path));
  },
  lstat: (path: string): Promise<PlatformFileInfo> =>
    Deno.lstat(path).then(toPlatformFileInfo), // lstat doesn't follow symlinks
  lstatSync: (path: string): PlatformFileInfo => {
    return toPlatformFileInfo(Deno.lstatSync(path)); // lstat doesn't follow symlinks
  },
  exists: (path: string): Promise<boolean> => denoExists(path),

  // Directory operations
  mkdir: (path: string, opts?: { recursive?: boolean }): Promise<void> =>
    Deno.mkdir(path, opts),
  mkdirSync: (path: string, opts?: { recursive?: boolean }): void => {
    Deno.mkdirSync(path, opts);
  },
  ensureDir: (path: string): Promise<void> => denoEnsureDir(path),
  readDir: (path: string): AsyncIterable<PlatformDirEntry> => denoReadDir(path),
  makeTempDir: (options?: PlatformMakeTempDirOptions): Promise<string> =>
    Deno.makeTempDir(options),

  // File manipulation
  remove: (path: string, options?: PlatformRemoveOptions): Promise<void> =>
    Deno.remove(path, options),
  removeSync: (path: string, options?: PlatformRemoveOptions): void => {
    Deno.removeSync(path, options);
  },
  copyFile: (src: string, dest: string): Promise<void> =>
    Deno.copyFile(src, dest),
  rename: (oldPath: string, newPath: string): Promise<void> =>
    Deno.rename(oldPath, newPath),
  chmod: (path: string, mode: number): Promise<void> => Deno.chmod(path, mode),
  chmodSync: (path: string, mode: number): void => Deno.chmodSync(path, mode),

  watchFs: (paths: string | string[]): PlatformFsWatcher => {
    const watcher = Deno.watchFs(paths);
    return {
      [Symbol.asyncIterator](): AsyncIterator<PlatformFsEvent> {
        const inner = watcher[Symbol.asyncIterator]();
        return {
          next: () => inner.next() as Promise<IteratorResult<PlatformFsEvent>>,
          return: (value?: PlatformFsEvent) =>
            inner.return?.(value) ??
              Promise.resolve({ done: true as const, value: undefined }),
        };
      },
      close: () => watcher.close(),
    };
  },
};

// =============================================================================
// Path Implementation
// =============================================================================

const DenoPath: PlatformPath = {
  sep: nodePath.sep,
  join: (...segments: string[]): string => nodePath.join(...segments),
  dirname: (path: string): string => nodePath.dirname(path),
  basename: (path: string, ext?: string): string =>
    nodePath.basename(path, ext),
  extname: (path: string): string => nodePath.extname(path),
  isAbsolute: (path: string): boolean => nodePath.isAbsolute(path),
  resolve: (...segments: string[]): string => nodePath.resolve(...segments),
  normalize: (path: string): string => nodePath.normalize(path),
  relative: (from: string, to: string): string => nodePath.relative(from, to),
  fromFileUrl: (url: string | URL): string => fileURLToPath(url),
  toFileUrl: (path: string): URL => pathToFileURL(path),
};

// =============================================================================
// Environment Implementation
// =============================================================================

const DenoEnv: PlatformEnv = {
  get: (key: string): string | undefined => Deno.env.get(key),
  set: (key: string, value: string): void => Deno.env.set(key, value),
  delete: (key: string): void => Deno.env.delete(key),
  toObject: (): Record<string, string> => Deno.env.toObject(),
};

// =============================================================================
// Process Implementation
// =============================================================================

const DenoProcess: PlatformProcess = {
  cwd: (): string => Deno.cwd(),
  execPath: (): string => Deno.execPath(),
  args: (): string[] => Deno.args,
  exit: (code: number): never => Deno.exit(code),
  addSignalListener: (signal: SignalType, handler: () => void): void => {
    Deno.addSignalListener(signal, handler);
  },
};

// =============================================================================
// Build Info Implementation
// =============================================================================

const DenoBuild: PlatformBuild = {
  // Map Deno.build.os to our supported OS types
  // All other OS variants (freebsd, netbsd, aix, solaris, illumos, android) map to linux-like
  os: (Deno.build.os === "darwin" || Deno.build.os === "linux" ||
      Deno.build.os === "windows")
    ? Deno.build.os
    : "linux",
};

// =============================================================================
// Command Implementation
// =============================================================================

const DenoCommand: PlatformCommand = {
  run: (options: PlatformCommandOptions): PlatformCommandProcess => {
    const process = createDenoCommand(options).spawn();
    return {
      status: process.status.then((status) => ({
        success: status.success,
        code: status.code,
        signal: status.signal ?? undefined,
      })),
      // Only access streams when explicitly piped.
      // Accessing stdin/stdout/stderr when not piped throws in Deno.
      stdin: options.stdin === "piped" ? process.stdin : undefined,
      stdout: options.stdout === "piped" ? process.stdout : undefined,
      stderr: options.stderr === "piped" ? process.stderr : undefined,
      kill: process.kill?.bind(process),
      unref: process.unref?.bind(process),
    };
  },
  output: async (
    options: PlatformCommandOptions,
  ): Promise<PlatformCommandOutput> => {
    const result = await createDenoCommand(options).output();
    return {
      code: result.code,
      success: result.success,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  },
};

// =============================================================================
// HTTP Server Implementation
// =============================================================================

function startDenoHttpServer(
  handler: (req: Request) => Response | Promise<Response>,
  options: PlatformHttpServeOptions,
): PlatformHttpServerHandle {
  const server = Deno.serve(
    {
      port: options.port,
      hostname: options.hostname,
      onListen: options.onListen,
    },
    handler,
  );
  return {
    finished: server.finished,
    shutdown: async () => {
      await server.shutdown();
    },
  };
}

const DenoHttp: PlatformHttp = {
  serve: (
    handler: (req: Request) => Response | Promise<Response>,
    options: PlatformHttpServeOptions,
  ): Promise<void> => startDenoHttpServer(handler, options).finished,
  serveWithHandle: (
    handler: (req: Request) => Response | Promise<Response>,
    options: PlatformHttpServeOptions,
  ): PlatformHttpServerHandle => startDenoHttpServer(handler, options),
};

// =============================================================================
// Main Platform Implementation
// =============================================================================

/**
 * DenoPlatform implements the Platform interface using Deno's APIs.
 * This is the single source of truth for all Deno-specific operations.
 */
export const DenoPlatform: Platform = {
  terminal: DenoTerminal,
  fs: DenoFs,
  path: DenoPath,
  env: DenoEnv,
  process: DenoProcess,
  build: DenoBuild,
  command: DenoCommand,
  http: DenoHttp,
  openUrl: (url: string): Promise<void> => runOpenUrlCommands(url),
};
