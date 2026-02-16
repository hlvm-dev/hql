/**
 * Node.js Platform Implementation
 *
 * This is the Node.js/Bun equivalent of deno-platform.ts.
 * It implements the Platform interface using Node.js built-in modules.
 *
 * Requirements: Node.js 18+ (global fetch, Web Streams, Readable.toWeb())
 * Bun compatibility: Bun implements Node.js APIs, so this works on Bun automatically.
 */

import { Buffer } from "node:buffer";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as nodePath from "node:path";
import * as os from "node:os";
import nodeProcess from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import * as tty from "node:tty";
import type {
  OperatingSystem,
  Platform,
  PlatformBuild,
  PlatformCommand,
  PlatformCommandOptions,
  PlatformCommandOutput,
  PlatformCommandProcess,
  PlatformCommandResult,
  PlatformDirEntry,
  PlatformEnv,
  PlatformFileInfo,
  PlatformFs,
  PlatformFsEvent,
  PlatformFsWatcher,
  PlatformHttp,
  PlatformHttpServeOptions,
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

function isAlreadyExists(e: unknown): boolean {
  return (e as { code?: string })?.code === "EEXIST";
}

async function nodeEnsureDir(directory: string): Promise<void> {
  try {
    await fsp.mkdir(directory, { recursive: true });
  } catch (error) {
    if (isAlreadyExists(error)) {
      const stat = await fsp.stat(directory);
      if (stat.isDirectory()) {
        return;
      }
      throw new Error(
        `Cannot create directory '${directory}': a file exists at this path`,
      );
    }
    throw error;
  }
}

async function nodeExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function statToFileInfo(stat: fs.Stats): PlatformFileInfo {
  return {
    isFile: stat.isFile(),
    isDirectory: stat.isDirectory(),
    isSymlink: stat.isSymbolicLink(),
    size: stat.size,
  };
}

async function* nodeReadDir(
  directoryPath: string,
): AsyncIterable<PlatformDirEntry> {
  const dir = await fsp.opendir(directoryPath);
  for await (const entry of dir) {
    yield {
      name: entry.name,
      isFile: entry.isFile(),
      isDirectory: entry.isDirectory(),
      isSymlink: entry.isSymbolicLink(),
    };
  }
}

function mapWriteOptions(
  options?: PlatformWriteOptions,
): { flag?: string; mode?: number } {
  if (!options) return {};
  const result: { flag?: string; mode?: number } = {};
  if (options.append) {
    result.flag = "a";
  } else if (options.create !== undefined && !options.create) {
    result.flag = "r+";
  }
  if (options.mode !== undefined) {
    result.mode = options.mode;
  }
  return result;
}

function mapOs(): OperatingSystem {
  switch (nodeProcess.platform) {
    case "darwin":
      return "darwin";
    case "win32":
      return "windows";
    default:
      return "linux";
  }
}

// =============================================================================
// Terminal Implementation
// =============================================================================

const NodeStdin: PlatformStdin = {
  read: (buffer: Uint8Array): Promise<number | null> => {
    return new Promise((resolve, reject) => {
      const onReadable = () => {
        const chunk = nodeProcess.stdin.read(buffer.length);
        cleanup();
        if (chunk === null) {
          resolve(null);
          return;
        }
        const data = Buffer.from(chunk);
        buffer.set(data.subarray(0, buffer.length));
        resolve(Math.min(data.length, buffer.length));
      };
      const onEnd = () => {
        cleanup();
        resolve(null);
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        nodeProcess.stdin.removeListener("readable", onReadable);
        nodeProcess.stdin.removeListener("end", onEnd);
        nodeProcess.stdin.removeListener("error", onError);
      };
      // If data is already buffered, read it immediately
      const existing = nodeProcess.stdin.read(buffer.length);
      if (existing !== null) {
        const data = Buffer.from(existing);
        buffer.set(data.subarray(0, buffer.length));
        resolve(Math.min(data.length, buffer.length));
        return;
      }
      nodeProcess.stdin.once("readable", onReadable);
      nodeProcess.stdin.once("end", onEnd);
      nodeProcess.stdin.once("error", onError);
    });
  },
  isTerminal: (): boolean => {
    return tty.isatty(0);
  },
  setRaw: (raw: boolean): void => {
    if (nodeProcess.stdin.isTTY) {
      nodeProcess.stdin.setRawMode(raw);
    }
  },
};

const NodeStdout: PlatformStdout = {
  writeSync: (data: Uint8Array): number => {
    return fs.writeSync(1, data);
  },
  write: (data: Uint8Array): Promise<number> => {
    return new Promise((resolve, reject) => {
      nodeProcess.stdout.write(data, (err) => {
        if (err) reject(err);
        else resolve(data.length);
      });
    });
  },
};

const NodeTerminal: PlatformTerminal = {
  stdin: NodeStdin,
  stdout: NodeStdout,
  consoleSize: (): { columns: number; rows: number } => {
    try {
      return {
        columns: nodeProcess.stdout.columns || 80,
        rows: nodeProcess.stdout.rows || 24,
      };
    } catch {
      return { columns: 80, rows: 24 };
    }
  },
};

// =============================================================================
// File System Implementation
// =============================================================================

const NodeFs: PlatformFs = {
  readTextFile: (path: string): Promise<string> =>
    fsp.readFile(path, "utf-8"),
  readTextFileSync: (path: string): string =>
    fs.readFileSync(path, "utf-8"),
  writeTextFile: async (
    path: string,
    data: string,
    options?: PlatformWriteOptions,
  ): Promise<void> => {
    const opts = mapWriteOptions(options);
    await fsp.writeFile(path, data, { encoding: "utf-8", ...opts });
  },
  writeTextFileSync: (
    path: string,
    data: string,
    options?: PlatformWriteOptions,
  ): void => {
    const opts = mapWriteOptions(options);
    fs.writeFileSync(path, data, { encoding: "utf-8", ...opts });
  },

  readFile: (path: string): Promise<Uint8Array> =>
    fsp.readFile(path),
  writeFile: (path: string, data: Uint8Array): Promise<void> =>
    fsp.writeFile(path, data),

  stat: async (path: string): Promise<PlatformFileInfo> =>
    statToFileInfo(await fsp.stat(path)),
  statSync: (path: string): PlatformFileInfo =>
    statToFileInfo(fs.statSync(path)),
  lstat: async (path: string): Promise<PlatformFileInfo> =>
    statToFileInfo(await fsp.lstat(path)),
  lstatSync: (path: string): PlatformFileInfo =>
    statToFileInfo(fs.lstatSync(path)),
  exists: (path: string): Promise<boolean> => nodeExists(path),

  mkdir: async (path: string, opts?: { recursive?: boolean }): Promise<void> => {
    await fsp.mkdir(path, opts);
  },
  mkdirSync: (path: string, opts?: { recursive?: boolean }): void => {
    fs.mkdirSync(path, opts);
  },
  ensureDir: (path: string): Promise<void> => nodeEnsureDir(path),
  readDir: (path: string): AsyncIterable<PlatformDirEntry> => nodeReadDir(path),
  makeTempDir: async (options?: PlatformMakeTempDirOptions): Promise<string> => {
    const prefix = options?.prefix ?? "tmp";
    const dir = await fsp.mkdtemp(nodePath.join(os.tmpdir(), `${prefix}-`));
    // Deno's makeTempDir supports suffix, but Node's mkdtemp does not.
    // For suffix support, rename the created directory.
    if (options?.suffix) {
      const newDir = `${dir}${options.suffix}`;
      await fsp.rename(dir, newDir);
      return newDir;
    }
    return dir;
  },

  remove: async (path: string, options?: PlatformRemoveOptions): Promise<void> => {
    await fsp.rm(path, { recursive: options?.recursive ?? false });
  },
  removeSync: (path: string, options?: PlatformRemoveOptions): void => {
    fs.rmSync(path, { recursive: options?.recursive ?? false });
  },
  copyFile: (src: string, dest: string): Promise<void> =>
    fsp.copyFile(src, dest),
  rename: (oldPath: string, newPath: string): Promise<void> =>
    fsp.rename(oldPath, newPath),
  chmod: (path: string, mode: number): Promise<void> =>
    fsp.chmod(path, mode),

  watchFs: (paths: string | string[]): PlatformFsWatcher => {
    const targets = Array.isArray(paths) ? paths : [paths];
    const watchers: fs.FSWatcher[] = [];
    const queue: PlatformFsEvent[] = [];
    let resolve: ((value: IteratorResult<PlatformFsEvent>) => void) | null = null;
    let closed = false;

    const push = (event: PlatformFsEvent): void => {
      if (closed) return;
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ done: false, value: event });
      } else {
        queue.push(event);
      }
    };

    for (const target of targets) {
      const w = fs.watch(target, (eventType, filename) => {
        const kind = eventType === "rename" ? "create" : "modify";
        const fullPath = filename ? nodePath.join(target, filename) : target;
        push({ kind, paths: [fullPath] });
      });
      watchers.push(w);
    }

    return {
      [Symbol.asyncIterator](): AsyncIterator<PlatformFsEvent> {
        return {
          next(): Promise<IteratorResult<PlatformFsEvent>> {
            if (queue.length > 0) {
              return Promise.resolve({ done: false, value: queue.shift()! });
            }
            if (closed) {
              return Promise.resolve({ done: true, value: undefined });
            }
            return new Promise<IteratorResult<PlatformFsEvent>>((r) => { resolve = r; });
          },
        };
      },
      close(): void {
        closed = true;
        for (const w of watchers) w.close();
        if (resolve) {
          resolve({ done: true, value: undefined });
          resolve = null;
        }
      },
    };
  },
};

// =============================================================================
// Path Implementation (identical to DenoPlatform — both use node:path)
// =============================================================================

const NodePath: PlatformPath = {
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

const NodeEnv: PlatformEnv = {
  get: (key: string): string | undefined => nodeProcess.env[key],
  set: (key: string, value: string): void => {
    nodeProcess.env[key] = value;
  },
};

// =============================================================================
// Process Implementation
// =============================================================================

const NodeProcess: PlatformProcess = {
  cwd: (): string => nodeProcess.cwd(),
  execPath: (): string => nodeProcess.execPath,
  args: (): string[] => nodeProcess.argv.slice(2),
  exit: (code: number): never => nodeProcess.exit(code),
  addSignalListener: (signal: SignalType, handler: () => void): void => {
    nodeProcess.on(signal, handler);
  },
};

// =============================================================================
// Build Info Implementation
// =============================================================================

const NodeBuild: PlatformBuild = {
  os: mapOs(),
};

// =============================================================================
// Command Implementation
// =============================================================================

const NodeCommand: PlatformCommand = {
  run: (options: PlatformCommandOptions): PlatformCommandProcess => {
    const child = spawn(options.cmd[0], options.cmd.slice(1), {
      cwd: options.cwd,
      env: options.env,
      stdio: [
        options.stdin === "piped" ? "pipe" : options.stdin === "null" ? "ignore" : "inherit",
        options.stdout === "piped" ? "pipe" : options.stdout === "null" ? "ignore" : "inherit",
        options.stderr === "piped" ? "pipe" : options.stderr === "null" ? "ignore" : "inherit",
      ],
    });

    const status = new Promise<PlatformCommandResult>((resolve, reject) => {
      child.on("close", (code, signal) => {
        resolve({
          success: code === 0,
          code: code ?? 1,
          signal: signal ?? undefined,
        });
      });
      child.on("error", reject);
    });

    return {
      status,
      // Convert Node.js streams to Web ReadableStream for consumers using .getReader()
      stdin: options.stdin === "piped" ? child.stdin : undefined,
      stdout: options.stdout === "piped" && child.stdout
        ? Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
        : undefined,
      stderr: options.stderr === "piped" && child.stderr
        ? Readable.toWeb(child.stderr) as ReadableStream<Uint8Array>
        : undefined,
      kill: (signal?: string | number) => {
        child.kill(signal as NodeJS.Signals);
      },
      unref: () => {
        child.unref();
      },
    };
  },

  output: (
    options: PlatformCommandOptions,
  ): Promise<PlatformCommandOutput> => {
    return new Promise((resolve, reject) => {
      const child = spawn(options.cmd[0], options.cmd.slice(1), {
        cwd: options.cwd,
        env: options.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

      child.on("close", (code) => {
        resolve({
          code: code ?? 1,
          success: code === 0,
          stdout: new Uint8Array(Buffer.concat(stdoutChunks)),
          stderr: new Uint8Array(Buffer.concat(stderrChunks)),
        });
      });
      child.on("error", reject);
    });
  },
};

// =============================================================================
// HTTP Server Implementation
// =============================================================================

const NodeHttp: PlatformHttp = {
  serve: (
    handler: (req: Request) => Response | Promise<Response>,
    options: PlatformHttpServeOptions,
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      const server = createServer(async (nodeReq, nodeRes) => {
        try {
          // Build a Web API Request from Node's IncomingMessage
          const url = `http://${options.hostname || "localhost"}:${options.port}${nodeReq.url || "/"}`;
          const headers = new Headers();
          for (const [key, value] of Object.entries(nodeReq.headers)) {
            if (value) {
              if (Array.isArray(value)) {
                for (const v of value) headers.append(key, v);
              } else {
                headers.set(key, value);
              }
            }
          }

          const bodyMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
          const hasBody = bodyMethods.has(nodeReq.method || "GET");
          const webReq = new Request(url, {
            method: nodeReq.method,
            headers,
            body: hasBody ? Readable.toWeb(nodeReq) as ReadableStream : undefined,
            // @ts-ignore: duplex is needed for streaming request bodies in Node 18+
            duplex: hasBody ? "half" : undefined,
          });

          const webRes = await handler(webReq);

          nodeRes.writeHead(webRes.status, Object.fromEntries(webRes.headers.entries()));
          if (webRes.body) {
            const reader = webRes.body.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) { nodeRes.end(); break; }
              nodeRes.write(value);
            }
          } else {
            const text = await webRes.text();
            nodeRes.end(text);
          }
        } catch (err) {
          nodeRes.writeHead(500);
          nodeRes.end(String(err));
        }
      });

      server.on("error", reject);

      server.listen(options.port, options.hostname || "0.0.0.0", () => {
        options.onListen?.({
          hostname: options.hostname || "0.0.0.0",
          port: options.port,
        });
      });

      // The promise resolves when the server closes (matching Deno.serve().finished)
      server.on("close", () => resolve());
    });
  },
};

// =============================================================================
// Main Platform Implementation
// =============================================================================

/**
 * NodePlatform implements the Platform interface using Node.js built-in APIs.
 * Compatible with Node.js 18+ and Bun.
 */
export const NodePlatform: Platform = {
  terminal: NodeTerminal,
  fs: NodeFs,
  path: NodePath,
  env: NodeEnv,
  process: NodeProcess,
  build: NodeBuild,
  command: NodeCommand,
  http: NodeHttp,
  openUrl: async (url: string): Promise<void> => {
    const currentOs = mapOs();
    let cmd: string;
    let args: string[];
    switch (currentOs) {
      case "darwin":
        cmd = "open";
        args = [url];
        break;
      case "windows":
        cmd = "cmd.exe";
        args = ["/c", "start", "", url];
        break;
      default:
        cmd = "xdg-open";
        args = [url];
        break;
    }
    const result = await NodeCommand.output({ cmd: [cmd, ...args] });
    if (!result.success) {
      throw new Error(`Failed to open URL: ${url} (exit code: ${result.code})`);
    }
  },
};
