// platform/node/platform.ts
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";

/** Return current working directory (Node) */
export function cwd(): string {
  return process.cwd();
}

/** Get file info (fs.Stats in Node) */
export async function stat(filePath: string): Promise<fs.Stats> {
  return fs.promises.stat(filePath);
}

/** Read a text file */
export async function readTextFile(filePath: string): Promise<string> {
  return fs.promises.readFile(filePath, "utf-8");
}

/** Write a text file */
export async function writeTextFile(filePath: string, data: string): Promise<void> {
  await fs.promises.writeFile(filePath, data, "utf-8");
}

/** Make a directory */
export async function mkdir(dirPath: string, opts?: { recursive?: boolean }): Promise<void> {
  await fs.promises.mkdir(dirPath, { recursive: opts?.recursive });
}

/** Path utilities (re-export from Node's `path`) */
export function join(...segments: string[]): string {
  return path.join(...segments);
}
export function dirname(p: string): string {
  return path.dirname(p);
}
export function basename(p: string, ext?: string): string {
  return path.basename(p, ext);
}
export function extname(p: string): string {
  return path.extname(p);
}
export function isAbsolute(p: string): boolean {
  return path.isAbsolute(p);
}
export function resolve(...segments: string[]): string {
  return path.resolve(...segments);
}
export function relative(from: string, to: string): string {
  return path.relative(from, to);
}

/** Real path (sync) */
export function realPathSync(p: string): string {
  return fs.realpathSync(p);
}

/** Executable path for the current Node process */
export function execPath(): string {
  return process.execPath;
}

/** Run a command in Node */
export function run(cmd: string[]): ReturnType<typeof spawn> {
  // For example, spawn the first element as the command, the rest as args
  const child = spawn(cmd[0], cmd.slice(1), {
    stdio: "inherit", // or "pipe" if you want to capture output
  });
  return child;
}
