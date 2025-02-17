// precompileHQL.ts
import { compileHQL } from "./compiler.ts";
import { walk } from "https://deno.land/std@0.170.0/fs/walk.ts";
import { join, dirname } from "https://deno.land/std@0.170.0/path/mod.ts";

/**
 * Compiles a single HQL file and writes its JS output to outPath.
 */
async function compileFile(filePath: string, outPath: string): Promise<void> {
  const source = await Deno.readTextFile(filePath);
  const compiled = await compileHQL(source, filePath);
  await Deno.mkdir(dirname(outPath), { recursive: true });
  await Deno.writeTextFile(outPath, compiled);
}

/**
 * Walks through rootDir to find all .hql files, compiles them into the cacheDir,
 * and returns a mapping from the original file URL to the compiled JS file URL.
 */
export async function precompile(
  rootDir: string,
  cacheDir: string,
): Promise<Record<string, string>> {
  const mappings: Record<string, string> = {};

  for await (const entry of walk(rootDir, { exts: [".hql"], includeFiles: true })) {
    const hqlPath = entry.path;
    // Create a relative path from the rootDir.
    const relPath = hqlPath.substring(rootDir.length);
    // Write the compiled file into the cacheDir at the root.
    const outPath = join(cacheDir, relPath) + ".js";

    let needCompile = true;
    try {
      const statHQL = await Deno.stat(hqlPath);
      const statJS = await Deno.stat(outPath);
      if (statJS.mtime && statHQL.mtime && statJS.mtime >= statHQL.mtime) {
        needCompile = false;
      }
    } catch {
      needCompile = true;
    }

    if (needCompile) {
      await compileFile(hqlPath, outPath);
    }

    // Convert file paths to absolute file URLs.
    const absHQL = new URL("file://" + Deno.realPathSync(hqlPath)).href;
    const absJS = new URL("file://" + Deno.realPathSync(outPath)).href;
    mappings[absHQL] = absJS;
  }

  return mappings;
}
