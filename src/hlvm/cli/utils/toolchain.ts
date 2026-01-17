/**
 * Toolchain utilities for HLVM CLI
 * Manages Deno binary discovery
 */

import { getPlatform } from "../../../platform/platform.ts";

/**
 * Get the path to the Deno executable
 *
 * When HLVM is compiled with `deno compile`, execPath() returns the HLVM binary,
 * not the Deno binary. So we need to search for the system Deno instead.
 */
export async function ensureDenoAvailable(): Promise<string> {
  const platform = getPlatform();
  // Check if we're running as a compiled binary (execPath won't be "deno")
  const execPath = platform.process.execPath();
  const isCompiledBinary = execPath && !execPath.endsWith("deno") && !execPath.includes("/deno");

  // If running as compiled binary, we MUST find system Deno
  if (isCompiledBinary) {
    const systemDeno = await findInPath("deno");
    if (systemDeno) {
      return systemDeno;
    }
    throw new Error(
      "Deno not found in PATH. Native compilation requires Deno to be installed.\n" +
      "Please install Deno: https://deno.land"
    );
  }

  // If running via `deno run`, use the current Deno
  if (execPath) {
    return execPath;
  }

  // Fallback: search in PATH
  const systemDeno = await findInPath("deno");
  if (systemDeno) {
    return systemDeno;
  }

  throw new Error(
    "Deno runtime not found. This is unexpected - HLVM requires Deno to run.\n" +
    "Please ensure Deno is installed: https://deno.land"
  );
}

/**
 * Search for an executable in the system PATH
 */
async function findInPath(name: string): Promise<string | null> {
  const platform = getPlatform();
  const pathEnv = platform.env.get("PATH") || "";
  const pathSeparator = platform.build.os === "windows" ? ";" : ":";
  const paths = pathEnv.split(pathSeparator);

  const exeExtensions = platform.build.os === "windows"
    ? [".exe", ".cmd", ".bat", ""]
    : [""];

  for (const dir of paths) {
    for (const ext of exeExtensions) {
      const fullPath = `${dir}/${name}${ext}`;
      try {
        const stat = await platform.fs.stat(fullPath);
        if (stat.isFile) {
          return fullPath;
        }
      } catch {
        // File doesn't exist, continue searching
      }
    }
  }

  return null;
}
