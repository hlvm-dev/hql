import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as nodePath from "node:path";
import * as os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  Platform,
  PlatformCommandProcess,
  PlatformCommandResult,
  PlatformDirEntry,
  PlatformFileInfo,
  PlatformMakeTempDirOptions,
  PlatformRemoveOptions,
} from "./platform.ts";

const PIPE = "pipe" as const;
const INHERIT = "inherit" as const;
const IGNORE = "ignore" as const;

function mapStdio(
  value: "piped" | "inherit" | "null" | undefined,
): "pipe" | "inherit" | "ignore" {
  switch (value) {
    case "piped":
      return PIPE;
    case "null":
      return IGNORE;
    case "inherit":
    default:
      return INHERIT;
  }
}

export const NodePlatform: Platform = {
  cwd: () => process.cwd(),
  stat: async (path: string): Promise<PlatformFileInfo> => {
    const stats = await fsPromises.stat(path);
    return {
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      isSymlink: stats.isSymbolicLink(),
      size: stats.size,
    };
  },
  readTextFile: async (path: string): Promise<string> =>
    await fsPromises.readFile(path, "utf-8"),
  writeTextFile: async (path: string, data: string): Promise<void> =>
    await fsPromises.writeFile(path, data, "utf-8"),
  writeTextFileSync: (path: string, data: string): void => {
    fs.writeFileSync(path, data, "utf-8");
  },
  mkdir: async (
    path: string,
    opts?: { recursive?: boolean },
  ): Promise<void> => {
    await fsPromises.mkdir(path, { recursive: opts?.recursive });
  },
  ensureDir: async (path: string): Promise<void> => {
    await fsPromises.mkdir(path, { recursive: true });
  },
  join: (...segments: string[]): string => nodePath.join(...segments),
  dirname: (path: string): string => nodePath.dirname(path),
  basename: (path: string, ext?: string): string =>
    nodePath.basename(path, ext),
  extname: (path: string): string => nodePath.extname(path),
  isAbsolute: (path: string): boolean => nodePath.isAbsolute(path),
  resolve: (...segments: string[]): string => nodePath.resolve(...segments),
  relative: (from: string, to: string): string => nodePath.relative(from, to),
  normalize: (value: string): string => nodePath.normalize(value),
  realPathSync: (path: string): string => fs.realpathSync(path),
  execPath: (): string => process.execPath,
  readTextFileSync: (path: string): string => fs.readFileSync(path, "utf-8"),
  runCmd: (options): PlatformCommandProcess => {
    const stdio: Array<"pipe" | "inherit" | "ignore"> = [
      mapStdio(options.stdin),
      mapStdio(options.stdout),
      mapStdio(options.stderr),
    ];

    const child = spawn(options.cmd[0], options.cmd.slice(1), {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      stdio,
    });

    const status = new Promise<PlatformCommandResult>((resolve, reject) => {
      child.once("error", (error) => {
        reject(error);
      });
      child.once("close", (code, signal) => {
        resolve({
          success: (code ?? 0) === 0,
          code: code ?? 0,
          signal: signal ?? undefined,
        });
      });
    });

    return {
      status,
      stdout: child.stdout ?? undefined,
      stderr: child.stderr ?? undefined,
      kill: child.kill.bind(child),
    };
  },
  readDir: (path: string): AsyncIterable<PlatformDirEntry> =>
    (async function* () {
      const dir = await fsPromises.opendir(path);
      try {
        for await (const entry of dir) {
          yield {
            name: entry.name,
            isFile: entry.isFile(),
            isDirectory: entry.isDirectory(),
            isSymlink: entry.isSymbolicLink(),
          };
        }
      } finally {
        await dir.close();
      }
    })(),
  makeTempDir: async (
    options?: PlatformMakeTempDirOptions,
  ): Promise<string> => {
    const prefix = options?.prefix ?? "hql-";
    const base = nodePath.join(os.tmpdir(), prefix);
    const dir = await fsPromises.mkdtemp(base);
    if (options?.suffix) {
      const newPath = `${dir}${options.suffix}`;
      await fsPromises.rename(dir, newPath);
      return newPath;
    }
    return dir;
  },
  remove: async (
    path: string,
    options?: PlatformRemoveOptions,
  ): Promise<void> => {
    await fsPromises.rm(path, {
      recursive: options?.recursive ?? false,
      force: options?.recursive ?? false,
    });
  },
  removeSync: (path: string, options?: PlatformRemoveOptions): void => {
    fs.rmSync(path, {
      recursive: options?.recursive ?? false,
      force: options?.recursive ?? false,
    });
  },
  exit: (code: number): never => {
    process.exit(code);
  },
  getEnv: (key: string): string | undefined => process.env[key],
  setEnv: (key: string, value: string): void => {
    process.env[key] = value;
  },
  exists: async (path: string): Promise<boolean> => {
    try {
      await fsPromises.access(path, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  },
  getArgs: () => process.argv.slice(2),
  copyFile: (src: string, dest: string): Promise<void> =>
    fsPromises.copyFile(src, dest),
  fromFileUrl: (value: string | URL): string => fileURLToPath(value),
  toFileUrl: (value: string): URL => pathToFileURL(value),
};
