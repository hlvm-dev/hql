/**
 * Toolchain utilities for HLVM CLI
 * Manages Deno binary discovery
 */

/**
 * Get the path to the Deno executable
 *
 * When HLVM is compiled with `deno compile`, Deno.execPath() returns the HLVM binary,
 * not the Deno binary. So we need to search for the system Deno instead.
 */
export async function ensureDenoAvailable(): Promise<string> {
  // Check if we're running as a compiled binary (Deno.execPath won't be "deno")
  const execPath = Deno.execPath?.();
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
  const pathEnv = Deno.env.get("PATH") || "";
  const pathSeparator = Deno.build.os === "windows" ? ";" : ":";
  const paths = pathEnv.split(pathSeparator);

  const exeExtensions = Deno.build.os === "windows"
    ? [".exe", ".cmd", ".bat", ""]
    : [""];

  for (const dir of paths) {
    for (const ext of exeExtensions) {
      const fullPath = `${dir}/${name}${ext}`;
      try {
        const stat = await Deno.stat(fullPath);
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
