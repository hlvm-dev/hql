import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

async function denoEnsureDir(directory: string): Promise<void> {
  try {
    await Deno.mkdir(directory, { recursive: true });
  } catch (error) {
    if (error instanceof Deno.errors.AlreadyExists) {
      return;
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
}

export interface PlatformRemoveOptions {
  recursive?: boolean;
}

export interface PlatformMakeTempDirOptions {
  prefix?: string;
  suffix?: string;
}

/**
 * Platform interface defines all necessary platform-specific operations.
 * (Touched to force cache invalidation)
 */
export interface Platform {
  cwd(): string;
  stat(path: string): Promise<PlatformFileInfo>;
  readTextFile(path: string): Promise<string>;
  writeTextFile(
    path: string,
    data: string,
    options?: { append?: boolean; create?: boolean; mode?: number },
  ): Promise<void>;
  writeTextFileSync(path: string, data: string): void;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  ensureDir(path: string): Promise<void>;
  join(...segments: string[]): string;
  dirname(path: string): string;
  basename(path: string, ext?: string): string;
  extname(path: string): string;
  isAbsolute(path: string): boolean;
  resolve(...segments: string[]): string;
  normalize(path: string): string;
  relative(from: string, to: string): string;
  realPathSync(path: string): string;
  execPath(): string;
  readTextFileSync(path: string): string;
  runCmd(options: {
    cmd: string[];
    cwd?: string;
    env?: Record<string, string>;
    stdin?: "piped" | "inherit" | "null";
    stdout?: "piped" | "inherit" | "null";
    stderr?: "piped" | "inherit" | "null";
  }): PlatformCommandProcess;
  readDir(path: string): AsyncIterable<PlatformDirEntry>;
  makeTempDir(options?: PlatformMakeTempDirOptions): Promise<string>;
  remove(path: string, options?: PlatformRemoveOptions): Promise<void>;
  removeSync(path: string, options?: PlatformRemoveOptions): void;
  exit(code: number): never;
  getEnv(key: string): string | undefined;
  setEnv(key: string, value: string): void;
  exists(path: string): Promise<boolean>;
  getArgs(): string[];
  copyFile(src: string, dest: string): Promise<void>;
  fromFileUrl(url: string | URL): string;
  toFileUrl(path: string): URL;
  openUrl(url: string): Promise<void>;
}

/**
 * DenoPlatform implements the Platform interface using Deno's APIs.
 */
export const DenoPlatform: Platform = {
  cwd: () => Deno.cwd(),
  stat: async (path: string): Promise<PlatformFileInfo> => {
    const info = await Deno.stat(path);
    return {
      isFile: info.isFile,
      isDirectory: info.isDirectory,
      isSymlink: info.isSymlink,
      size: info.size ?? 0,
    };
  },
  readTextFile: async (path: string): Promise<string> =>
    await Deno.readTextFile(path),
  writeTextFile: async (
    path: string,
    data: string,
    options?: { append?: boolean; create?: boolean; mode?: number },
  ): Promise<void> => await Deno.writeTextFile(path, data, options),
  writeTextFileSync: (path: string, data: string): void =>
    Deno.writeTextFileSync(path, data),
  mkdir: async (path: string, opts?: { recursive?: boolean }): Promise<void> =>
    await Deno.mkdir(path, opts),
  ensureDir: async (path: string): Promise<void> => {
    await denoEnsureDir(path);
  },
  join: (...segments: string[]): string => path.join(...segments),
  dirname: (value: string): string => path.dirname(value),
  basename: (value: string, ext?: string): string => path.basename(value, ext),
  extname: (value: string): string => path.extname(value),
  isAbsolute: (value: string): boolean => path.isAbsolute(value),
  resolve: (...segments: string[]): string => path.resolve(...segments),
  normalize: (value: string): string => path.normalize(value),
  relative: (from: string, to: string): string => path.relative(from, to),
  realPathSync: (path: string): string => Deno.realPathSync(path),
  execPath: (): string => Deno.execPath(),
  readTextFileSync: (path: string): string => Deno.readTextFileSync(path),
  runCmd: (options) => {
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
    };
  },
  readDir: (path: string): AsyncIterable<PlatformDirEntry> =>
    (async function* () {
      for await (const entry of Deno.readDir(path)) {
        yield {
          name: entry.name,
          isFile: entry.isFile,
          isDirectory: entry.isDirectory,
          isSymlink: entry.isSymlink,
        };
      }
    })(),
  makeTempDir: async (options?: PlatformMakeTempDirOptions): Promise<string> =>
    await Deno.makeTempDir(options),
  remove: async (
    path: string,
    options?: PlatformRemoveOptions,
  ): Promise<void> => await Deno.remove(path, options),
  removeSync: (path: string, options?: PlatformRemoveOptions): void =>
    Deno.removeSync(path, options),
  exit: (code: number): never => Deno.exit(code),
  getEnv: (key: string): string | undefined => Deno.env.get(key),
  setEnv: (key: string, value: string): void => Deno.env.set(key, value),
  exists: async (path: string): Promise<boolean> => await denoExists(path),
  getArgs: () => Deno.args,
  copyFile: (src: string, dest: string): Promise<void> =>
    Deno.copyFile(src, dest),
  fromFileUrl: (value: string | URL): string => fileURLToPath(value),
  toFileUrl: (value: string): URL => pathToFileURL(value),
  openUrl: async (url: string): Promise<void> => {
    const cmd = Deno.build.os === "darwin"
      ? "open"
      : Deno.build.os === "windows"
        ? "start"
        : "xdg-open";
    const command = new Deno.Command(cmd, { args: [url] });
    await command.spawn().status;
  },
};

let activePlatform: Platform = DenoPlatform;

export function setPlatform(platform: Platform): void {
  activePlatform = platform;
}

export function getPlatform(): Platform {
  return activePlatform;
}

export function cwd(): string {
  return activePlatform.cwd();
}

export function stat(path: string): Promise<PlatformFileInfo> {
  return activePlatform.stat(path);
}

export function readTextFile(path: string): Promise<string> {
  return activePlatform.readTextFile(path);
}

export function writeTextFile(
  path: string,
  data: string,
  options?: { append?: boolean; create?: boolean; mode?: number },
): Promise<void> {
  return activePlatform.writeTextFile(path, data, options);
}

export function writeTextFileSync(path: string, data: string): void {
  return activePlatform.writeTextFileSync(path, data);
}

export function mkdir(
  path: string,
  opts?: { recursive?: boolean },
): Promise<void> {
  return activePlatform.mkdir(path, opts);
}

export function ensureDir(path: string): Promise<void> {
  return activePlatform.ensureDir(path);
}

export function join(...segments: string[]): string {
  return activePlatform.join(...segments);
}

export function dirname(path: string): string {
  return activePlatform.dirname(path);
}

export function basename(path: string, ext?: string): string {
  return activePlatform.basename(path, ext);
}

export function extname(path: string): string {
  return activePlatform.extname(path);
}

export function isAbsolute(path: string): boolean {
  return activePlatform.isAbsolute(path);
}

export function resolve(...segments: string[]): string {
  return activePlatform.resolve(...segments);
}

export function normalize(path: string): string {
  return activePlatform.normalize(path);
}

export function relative(from: string, to: string): string {
  return activePlatform.relative(from, to);
}

export function realPathSync(path: string): string {
  return activePlatform.realPathSync(path);
}

export function execPath(): string {
  return activePlatform.execPath();
}

export function readTextFileSync(path: string): string {
  return activePlatform.readTextFileSync(path);
}

export function runCmd(options: {
  cmd: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdin?: "piped" | "inherit" | "null";
  stdout?: "piped" | "inherit" | "null";
  stderr?: "piped" | "inherit" | "null";
}): PlatformCommandProcess {
  return activePlatform.runCmd(options);
}

export function readDir(path: string): AsyncIterable<PlatformDirEntry> {
  return activePlatform.readDir(path);
}

export function makeTempDir(
  options?: PlatformMakeTempDirOptions,
): Promise<string> {
  return activePlatform.makeTempDir(options);
}

export function remove(
  path: string,
  options?: PlatformRemoveOptions,
): Promise<void> {
  return activePlatform.remove(path, options);
}

export function removeSync(
  path: string,
  options?: PlatformRemoveOptions,
): void {
  return activePlatform.removeSync(path, options);
}

export function exit(code: number): never {
  return activePlatform.exit(code);
}

export function getEnv(key: string): string | undefined {
  return activePlatform.getEnv(key);
}

export function setEnv(key: string, value: string): void {
  return activePlatform.setEnv(key, value);
}

export function exists(path: string): Promise<boolean> {
  return activePlatform.exists(path);
}

export function getArgs(): string[] {
  return activePlatform.getArgs();
}

export function copyFile(src: string, dest: string): Promise<void> {
  return activePlatform.copyFile(src, dest);
}

export function fromFileUrl(url: string | URL): string {
  return activePlatform.fromFileUrl(url);
}

export function toFileUrl(path: string): URL {
  return activePlatform.toFileUrl(path);
}

export function openUrl(url: string): Promise<void> {
  return activePlatform.openUrl(url);
}
