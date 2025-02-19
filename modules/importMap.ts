// modules/importMap.ts
import { compileHQL } from "./compiler/compiler.ts";
import { dirname, join, resolve } from "https://deno.land/std@0.170.0/path/mod.ts";

const importRegex = /import\s+.*?from\s+["'](.+?\.hql)["']/g;

async function collectHqlImports(
  content: string,
  baseFile: string,
  cacheDir: string,
  visited: Set<string>
): Promise<Record<string, string>> {
  const mappings: Record<string, string> = {};
  let match: RegExpExecArray | null;
  const regex = new RegExp(importRegex);
  while ((match = regex.exec(content)) !== null) {
    const importPath = match[1];
    const importedAbs = resolve(dirname(baseFile), importPath);
    const subMap = await buildImportMap(importedAbs, cacheDir, visited);
    Object.assign(mappings, subMap);
  }
  return mappings;
}

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
  const absoluteFilePath = resolve(entryFile);

  // Only process if the file ends with ".hql"
  if (!absoluteFilePath.endsWith(".hql")) return mappings;
  if (visited.has(absoluteFilePath)) return mappings;
  visited.add(absoluteFilePath);

  const content = await Deno.readTextFile(absoluteFilePath);

  // Determine output path in cache (preserving relative path)
  const relPath = absoluteFilePath.substring(Deno.cwd().length);
  const outPath = join(cacheDir, relPath) + ".js";

  await Deno.mkdir(dirname(outPath), { recursive: true });

  // Compile the HQL file using skipEvaluation=true (to avoid side effects)
  const compiled = await compileHQL(content, absoluteFilePath, true);
  await Deno.writeTextFile(outPath, compiled);

  // Map the absolute URL of the HQL file to the compiled JS file URL.
  const absEntryUrl = new URL("file://" + absoluteFilePath).href;
  const absOutUrl = new URL("file://" + resolve(outPath)).href;
  mappings[absEntryUrl] = absOutUrl;

  // Process nested imports using the helper function.
  const subMappings = await collectHqlImports(content, absoluteFilePath, cacheDir, visited);
  Object.assign(mappings, subMappings);

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

  // Use a separate visited set for JS files
  const subMappings = await collectHqlImports(content, absEntryJs, cacheDir, new Set());
  Object.assign(mappings, subMappings);

  return mappings;
}
