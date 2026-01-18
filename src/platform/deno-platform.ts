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

// =============================================================================
// Terminal Implementation
// =============================================================================

const DenoStdin: PlatformStdin = {
  read: async (buffer: Uint8Array): Promise<number | null> => {
    return await Deno.stdin.read(buffer);
  },
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
  write: async (data: Uint8Array): Promise<number> => {
    return await Deno.stdout.write(data);
  },
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
  readTextFile: async (path: string): Promise<string> => {
    return await Deno.readTextFile(path);
  },
  readTextFileSync: (path: string): string => {
    return Deno.readTextFileSync(path);
  },
  writeTextFile: async (
    path: string,
    data: string,
    options?: PlatformWriteOptions,
  ): Promise<void> => {
    await Deno.writeTextFile(path, data, options);
  },
  writeTextFileSync: (path: string, data: string, options?: PlatformWriteOptions): void => {
    Deno.writeTextFileSync(path, data, options);
  },

  // Binary file operations
  readFile: async (path: string): Promise<Uint8Array> => {
    return await Deno.readFile(path);
  },
  writeFile: async (path: string, data: Uint8Array): Promise<void> => {
    await Deno.writeFile(path, data);
  },

  // File info operations
  stat: async (path: string): Promise<PlatformFileInfo> => {
    const info = await Deno.stat(path);
    return {
      isFile: info.isFile,
      isDirectory: info.isDirectory,
      isSymlink: info.isSymlink,
      size: info.size ?? 0,
    };
  },
  statSync: (path: string): PlatformFileInfo => {
    const info = Deno.statSync(path);
    return {
      isFile: info.isFile,
      isDirectory: info.isDirectory,
      isSymlink: info.isSymlink,
      size: info.size ?? 0,
    };
  },
  exists: async (path: string): Promise<boolean> => {
    return await denoExists(path);
  },

  // Directory operations
  mkdir: async (path: string, opts?: { recursive?: boolean }): Promise<void> => {
    await Deno.mkdir(path, opts);
  },
  mkdirSync: (path: string, opts?: { recursive?: boolean }): void => {
    Deno.mkdirSync(path, opts);
  },
  ensureDir: async (path: string): Promise<void> => {
    await denoEnsureDir(path);
  },
  readDir: (path: string): AsyncIterable<PlatformDirEntry> => {
    return (async function* () {
      for await (const entry of Deno.readDir(path)) {
        yield {
          name: entry.name,
          isFile: entry.isFile,
          isDirectory: entry.isDirectory,
          isSymlink: entry.isSymlink,
        };
      }
    })();
  },
  makeTempDir: async (options?: PlatformMakeTempDirOptions): Promise<string> => {
    return await Deno.makeTempDir(options);
  },

  // File manipulation
  remove: async (path: string, options?: PlatformRemoveOptions): Promise<void> => {
    await Deno.remove(path, options);
  },
  removeSync: (path: string, options?: PlatformRemoveOptions): void => {
    Deno.removeSync(path, options);
  },
  copyFile: async (src: string, dest: string): Promise<void> => {
    await Deno.copyFile(src, dest);
  },
  rename: async (oldPath: string, newPath: string): Promise<void> => {
    await Deno.rename(oldPath, newPath);
  },
  chmod: async (path: string, mode: number): Promise<void> => {
    await Deno.chmod(path, mode);
  },
};

// =============================================================================
// Path Implementation
// =============================================================================

const DenoPath: PlatformPath = {
  join: (...segments: string[]): string => nodePath.join(...segments),
  dirname: (path: string): string => nodePath.dirname(path),
  basename: (path: string, ext?: string): string => nodePath.basename(path, ext),
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
  os: (Deno.build.os === "darwin" || Deno.build.os === "linux" || Deno.build.os === "windows")
    ? Deno.build.os
    : "linux",
};

// =============================================================================
// Command Implementation
// =============================================================================

const DenoCommand: PlatformCommand = {
  run: (options: PlatformCommandOptions): PlatformCommandProcess => {
    const command = new Deno.Command(options.cmd[0], {
      args: options.cmd.slice(1),
      cwd: options.cwd,
      env: options.env,
      stdin: options.stdin,
      stdout: options.stdout,
      stderr: options.stderr,
    });
    const process = command.spawn();
    return {
      status: process.status.then((status) => ({
        success: status.success,
        code: status.code,
        signal: status.signal ?? undefined,
      })),
      stdout: process.stdout,
      stderr: process.stderr,
      kill: process.kill?.bind(process),
      unref: process.unref?.bind(process),
    };
  },
  output: async (options: PlatformCommandOptions): Promise<PlatformCommandOutput> => {
    const command = new Deno.Command(options.cmd[0], {
      args: options.cmd.slice(1),
      cwd: options.cwd,
      env: options.env,
      stdin: options.stdin,
      stdout: options.stdout,
      stderr: options.stderr,
    });
    const result = await command.output();
    return {
      code: result.code,
      success: result.success,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  },
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
  openUrl: async (url: string): Promise<void> => {
    const os = Deno.build.os;
    let command: Deno.Command;

    if (os === "darwin") {
      command = new Deno.Command("open", { args: [url] });
    } else if (os === "windows") {
      // 'start' is a cmd.exe builtin, not a standalone executable
      // Must run via: cmd.exe /c start "" "url"
      // The empty string "" prevents start from treating the URL as window title
      command = new Deno.Command("cmd.exe", { args: ["/c", "start", "", url] });
    } else {
      // Linux and other Unix-like systems
      command = new Deno.Command("xdg-open", { args: [url] });
    }

    const status = await command.spawn().status;
    if (!status.success) {
      throw new Error(`Failed to open URL: ${url} (exit code: ${status.code})`);
    }
  },
};
