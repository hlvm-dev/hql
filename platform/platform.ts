import {
  join as stdJoin,
  dirname as stdDirname,
  basename as stdBasename,
  extname as stdExtname,
  isAbsolute as stdIsAbsolute,
  resolve as stdResolve,
  relative as stdRelative,
} from "jsr:@std/path@1.0.8";

export function cwd(): string {
  return Deno.cwd();
}

export async function stat(path: string): Promise<Deno.FileInfo> {
  return await Deno.stat(path);
}

export async function readTextFile(path: string): Promise<string> {
  return await Deno.readTextFile(path);
}

export async function writeTextFile(path: string, data: string): Promise<void> {
  return await Deno.writeTextFile(path, data);
}

export async function mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
  return await Deno.mkdir(path, opts);
}

export function join(...segments: string[]): string {
  return stdJoin(...segments);
}

export function dirname(path: string): string {
  return stdDirname(path);
}

export function basename(path: string, ext?: string): string {
  return stdBasename(path, ext);
}

export function extname(path: string): string {
  return stdExtname(path);
}

export function isAbsolute(path: string): boolean {
  return stdIsAbsolute(path);
}

export function resolve(...segments: string[]): string {
  return stdResolve(...segments);
}

export function relative(from: string, to: string): string {
  return stdRelative(from, to);
}

export function realPathSync(path: string): string {
  return Deno.realPathSync(path);
}

export function execPath(): string {
  return Deno.execPath();
}

export function runCmd(options: Deno.RunOptions): Deno.Process {
  return Deno.run(options);
}

/** Wrapper for reading a directory. */
export function readDir(path: string): AsyncIterable<Deno.DirEntry> {
  return Deno.readDir(path);
}

/** Wrapper for creating a temporary directory. */
export async function makeTempDir(): Promise<string> {
  return await Deno.makeTempDir();
}

/** Wrapper for exiting the process. */
export function exit(code: number): never {
  Deno.exit(code);
}

/** Get an environment variable. */
export function getEnv(key: string): string | undefined {
  return Deno.env.get(key);
}

/** Set an environment variable. */
export function setEnv(key: string, value: string): void {
  Deno.env.set(key, value);
}
