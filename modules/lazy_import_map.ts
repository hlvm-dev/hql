// lazy_import_map.ts
import { compileHQL } from "./compiler/compiler.ts";
import { dirname, join, resolve } from "https://deno.land/std@0.170.0/path/mod.ts";

/**
 * A simple regex to capture static import statements for HQL files.
 * It looks for lines like: import ... from "something.hql"
 */
const importRegex = /import\s+.*?from\s+["'](.+?\.hql)["']/g;

/**
 * Recursively builds an import map for HQL modules starting at entryFile.
 *
 * @param entryFile  The entry HQL file path.
 * @param cacheDir   The directory where compiled JS files are stored.
 * @param visited    A set to track already-visited files.
 * @returns A mapping from absolute HQL file URLs to compiled JS file URLs.
 */
export async function buildImportMap(
  entryFile: string,
  cacheDir: string,
  visited = new Set<string>()
): Promise<Record<string, string>> {
  const mappings: Record<string, string> = {};
  // Resolve the absolute path of the entry file.
  const absEntry = resolve(entryFile);
  if (visited.has(absEntry)) return mappings;
  visited.add(absEntry);

  // Read the file content.
  const content = await Deno.readTextFile(absEntry);

  // Determine the output path in the cache.
  // Here we assume the project root is Deno.cwd().
  const relPath = absEntry.substring(Deno.cwd().length);
  const outPath = join(cacheDir, relPath) + ".js";

  // Ensure the output directory exists.
  await Deno.mkdir(dirname(outPath), { recursive: true });

  // Compile the HQL file.
  const compiled = await compileHQL(content, absEntry);
  await Deno.writeTextFile(outPath, compiled);

  // Map the absolute HQL file URL to the compiled file URL.
  const absEntryUrl = new URL("file://" + absEntry).href;
  const absOutUrl = new URL("file://" + resolve(outPath)).href;
  mappings[absEntryUrl] = absOutUrl;

  // Now search for any static import statements referring to ".hql" files.
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1];
    // Resolve the imported file relative to the current file.
    const importedAbs = resolve(dirname(absEntry), importPath);
    const subMap = await buildImportMap(importedAbs, cacheDir, visited);
    Object.assign(mappings, subMap);
  }

  return mappings;
}
