/**
 * Toolchain utilities for HQL CLI
 * Manages Deno binary discovery
 */

/**
 * Get the path to the Deno executable
 *
 * Since HQL runs on Deno, we use Deno.execPath() to get the current Deno binary.
 * This works even when HQL is compiled with `deno compile` - the embedded Deno
 * can still spawn new processes to compile other code.
 */
export async function ensureDenoAvailable(): Promise<string> {
  // Use the current Deno that's running us
  if (typeof Deno !== "undefined" && Deno.execPath) {
    return Deno.execPath();
  }

  // Fallback: search in PATH (shouldn't normally reach here)
  const systemDeno = await findInPath("deno");
  if (systemDeno) {
    return systemDeno;
  }

  throw new Error(
    "Deno runtime not found. This is unexpected - HQL requires Deno to run.\n" +
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
