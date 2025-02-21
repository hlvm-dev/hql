// // platform/platform.ts

// const isDeno = "Deno" in globalThis && globalThis.Deno?.version != null;

// let platformModule: any;
// if (isDeno) {
//   platformModule = await import("./deno/platform.ts");
// } else {
//   const nodeModulePath = "./node/" + "platform.ts";
//   platformModule = await import(nodeModulePath);
// }

// export const cwd = platformModule.cwd;
// export const stat = platformModule.stat;
// export const readTextFile = platformModule.readTextFile;
// export const writeTextFile = platformModule.writeTextFile;
// export const mkdir = platformModule.mkdir;
// export const join = platformModule.join;
// export const dirname = platformModule.dirname;
// export const basename = platformModule.basename;
// export const extname = platformModule.extname;
// export const isAbsolute = platformModule.isAbsolute;
// export const resolve = platformModule.resolve;
// export const relative = platformModule.relative;
// export const realPathSync = platformModule.realPathSync;
// export const execPath = platformModule.execPath;
// export const run = platformModule.run;

// Deno-specific code

import {
    join as stdJoin,
    dirname as stdDirname,
    basename as stdBasename,
    extname as stdExtname,
    isAbsolute as stdIsAbsolute,
    resolve as stdResolve,
    relative as stdRelative,
  } from "https://deno.land/std@0.170.0/path/mod.ts";
  
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
  
  export function run(cmd: string[]): Deno.Process {
    return Deno.run({ cmd });
  }
  