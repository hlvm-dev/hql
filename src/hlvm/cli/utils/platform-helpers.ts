/**
 * Shared platform aliases for CLI commands
 * SSOT: All file/path/process operations go through getPlatform()
 */
import { getPlatform } from "../../../platform/platform.ts";
import type { PlatformCommandOptions, PlatformWriteOptions } from "../../../platform/types.ts";

export const basename = (path: string) => getPlatform().path.basename(path);
export const dirname = (path: string) => getPlatform().path.dirname(path);
export const ensureDir = (path: string) => getPlatform().fs.ensureDir(path);
export const exists = (path: string) => getPlatform().fs.exists(path);
export const join = (...paths: string[]) => getPlatform().path.join(...paths);
export const readDir = (path: string) => getPlatform().fs.readDir(path);
export const readTextFile = (path: string) => getPlatform().fs.readTextFile(path);
export const remove = (path: string, opts?: { recursive?: boolean }) => getPlatform().fs.remove(path, opts);
export const resolve = (...paths: string[]) => getPlatform().path.resolve(...paths);
export const stat = (path: string) => getPlatform().fs.stat(path);
export const writeTextFile = (path: string, content: string, opts?: PlatformWriteOptions) =>
  getPlatform().fs.writeTextFile(path, content, opts);
export const platformCwd = () => getPlatform().process.cwd();
export const platformExit = (code: number) => getPlatform().process.exit(code);
export const platformGetArgs = () => getPlatform().process.args();
export const platformGetEnv = (key: string) => getPlatform().env.get(key);
export const runCmd = (options: PlatformCommandOptions) => getPlatform().command.run(options);
export const platformOs = () => getPlatform().build.os;
