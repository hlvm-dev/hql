// modules/import_map.ts
import { compileHQL } from "./compiler/compiler.ts";
import { dirname, join, resolve } from "https://deno.land/std@0.170.0/path/mod.ts";

/**
 * A regex to match static import statements for HQL files.
 * (This example only handles double-quoted import paths.)
 */
const importRegex = /import\s+.*?from\s+["'](.+?\.hql)["']/g;

/**
 * Recursively builds an import map for HQL modules starting from entryFile.
 * Only files ending in ".hql" are processed.
 *
 * @param entryFile - The entry HQL file path.
 * @param cacheDir  - The directory where compiled JS files are stored.
 * @param visited   - A set to track already-visited file paths.
 * @returns A mapping from absolute HQL file URLs to their compiled JS file URLs.
 */
export async function buildImportMap(
  entryFile: string,
  cacheDir: string,
  visited = new Set<string>()
): Promise<Record<string, string>> {
  const mappings: Record<string, string> = {};
  const absEntry = resolve(entryFile);
  
  // Only process if the file ends with ".hql"
  if (!absEntry.endsWith(".hql")) return mappings;
  if (visited.has(absEntry)) return mappings;
  visited.add(absEntry);

  const content = await Deno.readTextFile(absEntry);

  // Determine output path in cache (preserving relative path)
  const relPath = absEntry.substring(Deno.cwd().length);
  const outPath = join(cacheDir, relPath) + ".js";

  await Deno.mkdir(dirname(outPath), { recursive: true });

  // Compile the HQL file using skipEvaluation=true (to avoid side effects)
  const compiled = await compileHQL(content, absEntry, true);
  await Deno.writeTextFile(outPath, compiled);

  // Map the absolute URL of the HQL file to the compiled JS file URL.
  const absEntryUrl = new URL("file://" + absEntry).href;
  const absOutUrl = new URL("file://" + resolve(outPath)).href;
  mappings[absEntryUrl] = absOutUrl;

  // Recursively scan for static imports of .hql files.
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1];
    const importedAbs = resolve(dirname(absEntry), importPath);
    const subMap = await buildImportMap(importedAbs, cacheDir, visited);
    Object.assign(mappings, subMap);
  }
  return mappings;
}

/**
 * Scans a JS file for static imports ending in ".hql" and builds an import map.
 *
 * @param entryJs - The entry JS file.
 * @param cacheDir - The cache directory.
 * @returns A mapping from absolute HQL file URLs to their compiled JS file URLs.
 */
export async function buildImportMapForJS(
  entryJs: string,
  cacheDir: string
): Promise<Record<string, string>> {
  const mappings: Record<string, string> = {};
  const absEntryJs = resolve(entryJs);
  const content = await Deno.readTextFile(absEntryJs);
  const regex = /import\s+.*?from\s+["'](.+?\.hql)["']/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const hqlPath = match[1];
    const importedAbs = resolve(dirname(absEntryJs), hqlPath);
    const subMap = await buildImportMap(importedAbs, cacheDir);
    Object.assign(mappings, subMap);
  }
  return mappings;
}
