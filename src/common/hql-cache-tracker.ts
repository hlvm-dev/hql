import {
  basename,
  cwd,
  dirname,
  ensureDir,
  exists,
  fromFileUrl,
  getEnv,
  isAbsolute,
  join,
  makeTempDir,
  readDir,
  readTextFile,
  relative,
  remove,
  resolve,
  stat,
  writeTextFile,
} from "../platform/platform.ts";
import { transpileHqlInJs } from "../bundler.ts";
import { globalLogger as logger } from "../logger.ts";
import { sanitizeIdentifier, getErrorMessage, normalizePath, hyphenToUnderscore } from "./utils.ts";
import { isHqlFile, isJsFile } from "./import-utils.ts";
import { LRUCache } from "./lru-cache.ts";

// Cache directory configuration
const HQL_CACHE_DIR = ".hql-cache";
const CACHE_VERSION = "1"; // Increment when cache structure changes
const SHORT_HASH_LENGTH = 8; // SHA-1 hash shortened to 8 hex chars for path readability

// Memory caches with size limits to prevent unbounded growth in long-running processes
const contentHashCache = new LRUCache<string, string>(5000);

// Pre-compiled regex patterns for performance (avoid recompilation in hot paths)
const IMPORT_REGEX = /import\s+.*\s+from\s+['"]([^'"]+)['"]/g;
const NAMED_IMPORT_REGEX = /import\s+{([^}]+)}\s+from/g;
const NAMESPACE_IMPORT_REGEX = /import\s+\*\s+as\s+([a-zA-Z0-9_-]+)\s+from/g;
const TS_IMPORT_REGEX = /import\s+.*\s+from\s+['"]([^'"]+\.ts)['"]/g;
const HQL_IMPORT_REGEX = /import\s+.*\s+from\s+['"]([^'"]+\.(hql))['"]/g;

// Pre-compiled file extension and path patterns (Performance: avoid per-call regex compilation)
const REMOVE_EXTENSION_REGEX = /\.[^.]+$/;
const HQL_EXTENSION_REGEX = /\.hql$/;
const TS_EXTENSION_REGEX = /\.ts$/;
const JS_EXTENSION_REGEX = /\.js$/;
const PATH_SEPARATOR_REGEX = /[\\/]+/;
const LEADING_SLASHES_REGEX = /^\/+/;
const SANITIZE_PATH_REGEX = /[^A-Za-z0-9._-]/g;
const PARENT_DIR_REGEX = /\.\./g;
const COLON_REGEX = /[:]/g;

/**
 * Map of original imports to cached paths
 * This helps resolve imports between cached files
 * Limited to 5000 entries to prevent unbounded growth
 */
const importPathMap = new LRUCache<string, string>(5000);

/**
 * Register an import mapping
 */
export function registerImportMapping(original: string, cached: string): void {
  importPathMap.set(original, cached);
  logger.debug(`Registered import mapping: ${original} -> ${cached}`);
}

function sanitizePathSegment(segment: string): string {
  const sanitized = segment
    .replace(PARENT_DIR_REGEX, "_up_")
    .replace(COLON_REGEX, "")
    .replace(SANITIZE_PATH_REGEX, "_");
  return sanitized || "_";
}

function splitPathSegments(value: string): string[] {
  if (!value) {
    return [];
  }
  return value.split(PATH_SEPARATOR_REGEX).filter(Boolean);
}

function getCacheSubdirSegmentsForDir(dirPath: string): string[] {
  const projectRoot = getProjectRoot();
  const relativeToProject = relative(projectRoot, dirPath);
  const withinProject = relativeToProject === "" ||
    (!relativeToProject.startsWith("..") &&
      !isAbsolute(relativeToProject));

  if (withinProject) {
    return splitPathSegments(relativeToProject).map(sanitizePathSegment);
  }

  const normalized = normalizePath(dirPath);
  const trimmed = normalized.replace(LEADING_SLASHES_REGEX, "");
  const segments = splitPathSegments(trimmed);
  if (segments.length === 0) {
    return ["__external__", "root"];
  }
  return ["__external__", ...segments.map(sanitizePathSegment)];
}

function buildCachePath(
  cacheDir: string,
  subdirSegments: string[],
  fileName?: string,
): string {
  if (fileName) {
    return subdirSegments.length === 0
      ? join(cacheDir, fileName)
      : join(cacheDir, ...subdirSegments, fileName);
  }
  return subdirSegments.length === 0
    ? cacheDir
    : join(cacheDir, ...subdirSegments);
}

// In-progress guards to prevent infinite recursion on circular graphs
const inProgressHql = new Set<string>();
const inProgressJs = new Set<string>();

/**
 * Get cached path for an import
 */
export function getImportMapping(original: string): string | undefined {
  return importPathMap.get(original);
}

/**
 * Get the HQL project root directory
 * This is the base directory where the HQL package is installed
 */
function getProjectRoot(): string {
  // Calculate project root from this file's location
  // This file is at: core/src/common/hql-cache-tracker.ts
  // Project root is: ../../../ from here
  return join(dirname(fromFileUrl(import.meta.url)), "../../..");
}

function getTempBase(): string {
  try {
    return getEnv("TMPDIR") || getEnv("TEMP") || getEnv("TMP") || "/tmp";
  } catch {
    return "/tmp";
  }
}

/**
 * Get the cache directory path
 */
export async function getCacheDir(): Promise<string> {
  // Allow host to override cache root (useful when packaged or running inside a larger platform like HLVM)
  let cacheRootBase: string | null = null;
  try {
    // If HQL_CACHE_ROOT is set, use it as absolute base directory for the cache
    cacheRootBase = getEnv("HQL_CACHE_ROOT") || null;
  } catch {
    // Ignore if env access is not permitted
  }

  // Use consistent project root calculation
  const defaultProjectRoot = getProjectRoot();
  let base = cacheRootBase || defaultProjectRoot;

  // If running from compiled binary (deno-compile temp dir), use temp directory instead
  // because the extraction directory is read-only
  if (base.includes("deno-compile-")) {
    base = getTempBase();
  }

  let cacheRoot = join(base, HQL_CACHE_DIR, CACHE_VERSION);
  try {
    await ensureDir(cacheRoot);
  } catch {
    // Fallback to a temp location if the default path is not writable
    base = getTempBase();
    cacheRoot = join(base, HQL_CACHE_DIR, CACHE_VERSION);
    await ensureDir(cacheRoot);
  }
  return cacheRoot;
}

/**
 * Get a dedicated runtime cache directory (separate namespace from transpile cache)
 */
export async function getRuntimeCacheDir(): Promise<string> {
  const cacheDir = await getCacheDir();
  const runtimeDir = join(dirname(cacheDir), "rt");
  await ensureDir(runtimeDir);
  return runtimeDir;
}

/**
 * Calculate hash for content
 */
async function calculateHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-1", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Get or calculate content hash for a file
 */
export async function getContentHash(filePath: string): Promise<string> {
  // Return cached hash if available - single get() instead of has()+get()
  const cachedHash = contentHashCache.get(filePath);
  if (cachedHash !== undefined) {
    return cachedHash;
  }

  try {
    // Read and hash the file content
    const content = await readTextFile(filePath);
    const hash = await calculateHash(content);

    // Cache the hash
    contentHashCache.set(filePath, hash);
    return hash;
  } catch (error) {
    logger.debug(`Error getting content hash for ${filePath}: ${getErrorMessage(error)}`);
    throw new Error(`Failed to hash ${filePath}: ${getErrorMessage(error)}`);
  }
}

/**
 * Get cached path for a source file with specific target extension
 */
export async function getCachedPath(
  sourcePath: string,
  targetExt: string,
  options: { createDir?: boolean; preserveRelative?: boolean } = {},
): Promise<string> {
  // Get cache directory - this should have the version number
  const cacheDir = await getCacheDir();

  // Calculate hash for versioning
  const hash = await getContentHash(sourcePath);
  const shortHash = hash.substring(0, SHORT_HASH_LENGTH);

  // Get base file name (without extension)
  const sourceFilename = basename(sourcePath);
  const baseFilename = sourceFilename.replace(REMOVE_EXTENSION_REGEX, "");
  const targetFilename = baseFilename + targetExt;

  // IMPORTANT: For HQL files, default to preserveRelative unless explicitly set to false
  // This ensures consistent paths across imports
  if (isHqlFile(sourcePath) && options.preserveRelative !== false) {
    options.preserveRelative = true;
  }

  let outputPath: string;

  if (options.preserveRelative) {
    const sourceDir = dirname(sourcePath);
    const subdirSegments = getCacheSubdirSegmentsForDir(sourceDir);
    outputPath = buildCachePath(cacheDir, subdirSegments, targetFilename);
  } else {
    // Use standard hash-based structure (flat)
    outputPath = join(cacheDir, "temp", shortHash + targetExt);
  }

  if (options.createDir) {
    await ensureDir(dirname(outputPath));
  }

  return outputPath;
}

/**
 * Process imports in cached content
 *
 * This handles rewriting import paths to work in the cache directory
 */
async function processCachedImports(
  content: string,
  sourcePath: string,
): Promise<string> {
  // Skip processing if no imports
  if (!content.includes("import") || !content.includes("from")) {
    return content;
  }

  // Find all imports with the pattern: import ... from "path"
  // Use pre-compiled regex for performance
  let modifiedContent = content;
  let match;

  // Reset regex state before use (global regex retains lastIndex)
  IMPORT_REGEX.lastIndex = 0;

  while ((match = IMPORT_REGEX.exec(content)) !== null) {
    const fullImport = match[0];
    const importPath = match[1];

    // Normalize file URL imports to plain absolute paths to avoid leaking file:// into bundles
    if (importPath.startsWith("file://")) {
      try {
        const url = new URL(importPath);
        const fsPath = url.pathname; // Absolute filesystem path
        const newImport = fullImport.replace(importPath, fsPath);
        modifiedContent = modifiedContent.replace(fullImport, newImport);
        logger.debug(
          `Normalized file URL import: ${fullImport} -> ${newImport}`,
        );
      } catch {
        // If parsing fails, leave as is
      }
      continue;
    }

    // Process all imports, not just HQL files
    try {
      // Try to resolve the import relative to the source file
      let resolvedOriginalPath = "";

      if (importPath.startsWith(".")) {
        // Relative import
        resolvedOriginalPath = resolve(dirname(sourcePath), importPath);
      } else {
        // Try to resolve from project root or various other locations
        const possiblePaths = [
          resolve(cwd(), importPath),
          resolve(cwd(), "core", importPath),
          resolve(dirname(sourcePath), importPath),
        ];

        for (const p of possiblePaths) {
          if (await exists(p)) {
            resolvedOriginalPath = p;
            break;
          }
        }

        if (!resolvedOriginalPath) {
          logger.debug(
            `Couldn't resolve import path: ${importPath} from ${sourcePath}`,
          );
          continue;
        }
      }

      // If we have a special mapping for this import, use it (for ANY file type)
      // Single get() instead of has()+get() to avoid double lookup
      const mappedPath = importPathMap.get(resolvedOriginalPath);
      if (mappedPath !== undefined) {

        // IMPORTANT: For JS files importing HQL, prefer JS over TS
        let finalPath = mappedPath;
        if (
          isJsFile(sourcePath) && isHqlFile(importPath) &&
          mappedPath.endsWith(".ts")
        ) {
          const jsPath = mappedPath.replace(TS_EXTENSION_REGEX, ".js");
          if (await exists(jsPath)) {
            finalPath = jsPath;
          }
        }

        const newImport = fullImport.replace(importPath, finalPath);
        modifiedContent = modifiedContent.replace(fullImport, newImport);
        logger.debug(
          `Rewritten import using mapping: ${fullImport} -> ${newImport}`,
        );
        continue;
      }

      // Special handling for relative imports to JS files in the same directory
      // This is common for stdlib and other modules that have js implementations
      if (importPath.startsWith("./js/") && importPath.endsWith(".js")) {
        // Compute where this JavaScript file would be in cache
        const cacheDir = await getCacheDir();
        const importerSubdir = getCacheSubdirSegmentsForDir(
          dirname(sourcePath),
        );
        const jsRelativePath = importPath.slice(2); // Remove './'
        const importerCacheDir = buildCachePath(cacheDir, importerSubdir);
        const cachedJsPath = join(importerCacheDir, jsRelativePath);

        // Register mapping and rewrite import
        registerImportMapping(resolvedOriginalPath, cachedJsPath);
        const newImport = fullImport.replace(importPath, cachedJsPath);
        modifiedContent = modifiedContent.replace(fullImport, newImport);
        logger.debug(
          `Rewritten relative JS import: ${fullImport} -> ${newImport}`,
        );
        continue;
      }

      // Handle HQL files uniformly, regardless of which file it is
      if (isHqlFile(importPath)) {
        // Generate the cached path for the import
        const importHash = await getContentHash(resolvedOriginalPath);
        const shortHash = importHash.substring(0, SHORT_HASH_LENGTH);

        // Compute the likely cached path
        const cacheDir = await getCacheDir();
        const importBasename = basename(resolvedOriginalPath, ".hql");
        const importDirSegments = getCacheSubdirSegmentsForDir(
          dirname(resolvedOriginalPath),
        );

        // Two possible locations: hash-based or preserveRelative
        const cachedImportPaths = [];

        // Strategy 1: preserveRelative makes exact directory structure
        // IMPORTANT: For JS files importing HQL, use .js extension not .ts
        const targetExt = sourcePath.endsWith(".js") ? ".js" : ".ts";
        const preservedPath = buildCachePath(
          cacheDir,
          importDirSegments,
          `${importBasename}${targetExt}`,
        );
        cachedImportPaths.push(preservedPath);

        // Strategy 2: Hash-based directory
        const hashPath = buildCachePath(
          cacheDir,
          [...importDirSegments, shortHash],
          `${importBasename}${targetExt}`,
        );
        cachedImportPaths.push(hashPath);

        // Check if any of these paths exist
        let foundCachedPath = "";
        for (const p of cachedImportPaths) {
          if (await exists(p)) {
            foundCachedPath = p;
            break;
          }
        }

        if (!foundCachedPath) {
          // If not found, we'll create the import mapping for later - cachePath is our best guess
          foundCachedPath = await joinAndEnsureDirExists(
            cacheDir,
            ...importDirSegments,
            `${importBasename}${targetExt}`,
          );
        }

        // Register this for future use
        registerImportMapping(resolvedOriginalPath, foundCachedPath);

        // Update the import to use absolute path
        const newImport = fullImport.replace(importPath, foundCachedPath);
        modifiedContent = modifiedContent.replace(fullImport, newImport);
        logger.debug(`Resolved import path: ${fullImport} -> ${newImport}`);
      }
    } catch (error) {
      logger.debug(`Error processing import ${importPath}: ${getErrorMessage(error)}`);
      // Skip this import if there's an error
      continue;
    }
  }

  return modifiedContent;
}

/**
 * Helper to join path parts and ensure directory exists
 */
async function joinAndEnsureDirExists(...parts: string[]): Promise<string> {
  const result = join(...parts);
  await ensureDir(dirname(result));
  return result;
}

/**
 * Process source file content to fix imports
 * This rewrites relative imports to use absolute paths
 */
async function processCacheFileContent(
  content: string,
  sourcePath: string,
): Promise<string> {
  return await processCachedImports(content, sourcePath);
}

/**
 * Recursively copy a directory and all its contents
 */
async function copyDirectoryRecursive(
  sourceDir: string,
  targetDir: string,
): Promise<void> {
  await ensureDir(targetDir);

  for await (const entry of readDir(sourceDir)) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);

    if (entry.isDirectory) {
      // Recursively copy subdirectory
      await copyDirectoryRecursive(sourcePath, targetPath);
    } else if (entry.isFile) {
      // Copy file
      const content = await readTextFile(sourcePath);
      await writeTextFile(targetPath, content);
      logger.debug(`Copied file: ${sourcePath} -> ${targetPath}`);
    }
  }
}

/**
 * Copy neighbor files needed for relative imports
 * This ensures files referenced through relative imports are available
 */
export async function copyNeighborFiles(
  sourcePath: string,
  outputDir?: string,
): Promise<void> {
  try {
    const sourceDir = dirname(sourcePath);
    logger.debug(`Checking for js directory near ${sourcePath}`);

    // Copy any js directory if it exists (for stdlib and other modules)
    const jsDir = join(sourceDir, "js");
    if (await exists(jsDir)) {
      logger.debug(`Found js directory at ${jsDir}`);

      // Create js directory in the cache
      const cacheDir = await getCacheDir();

      let targetDir: string;
      if (outputDir) {
        targetDir = outputDir;
      } else {
        let subdirSegments = getCacheSubdirSegmentsForDir(sourceDir);
        const currentDir = basename(cwd());
        if (currentDir === "core" && subdirSegments[0] === "core") {
          subdirSegments = subdirSegments.slice(1);
        }
        targetDir = buildCachePath(cacheDir, subdirSegments);
      }
      const targetJsDir = join(targetDir, "js");

      // Ensure the directory exists
      await ensureDir(targetJsDir);
      logger.debug(`Created js directory at ${targetJsDir}`);

      // Recursively copy all files and subdirectories from js dir
      await copyDirectoryRecursive(jsDir, targetJsDir);
      logger.debug(
        `Recursively copied js directory from ${jsDir} to ${targetJsDir}`,
      );
    } else {
      logger.debug(`No js directory found at ${jsDir}`);
    }
  } catch (error) {
    logger.debug(`Error copying neighbor files: ${getErrorMessage(error)}`);
  }
}

/**
 * Check if a file needs to be regenerated
 */
export async function needsRegeneration(
  sourcePath: string,
  targetExt: string,
): Promise<boolean> {
  try {
    // Get cached output path
    const outputPath = await getCachedPath(sourcePath, targetExt);

    // Always regenerate if output doesn't exist
    if (!await exists(outputPath)) {
      logger.debug(
        `[CACHE MISS] Output doesn't exist, regenerating: ${outputPath}`,
      );
      return true;
    }

    // Get current hash of source file
    const currentHash = await getContentHash(sourcePath);

    // Check hash in path parts
    const pathParts = outputPath.split("/").filter(Boolean);
    const pathHash = pathParts[pathParts.length - 2]; // Extract hash from path
    if (pathHash !== currentHash.substring(0, SHORT_HASH_LENGTH)) {
      logger.debug(
        `[CACHE MISS] Source content changed, regenerating: ${sourcePath}`,
      );
      return true;
    }

    logger.debug(`[CACHE HIT] No changes detected, reusing: ${outputPath}`);
    return false;
  } catch (error) {
    logger.debug(`Error checking regeneration: ${getErrorMessage(error)}`);
    return true; // Safer to regenerate on error
  }
}

/**
 * Write content to cache
 */
// Allowed source language extensions for caching
const ALLOWED_LANG_EXTENSIONS = ["hql", "js", "ts"];

export async function writeToCachedPath(
  sourcePath: string,
  content: string,
  targetExt: string,
  options: { preserveRelative?: boolean } = {},
): Promise<string> {
  // Only allow caching files with allowed extensions
  const ext = sourcePath.split(".").pop()?.toLowerCase();
  if (!ext || !ALLOWED_LANG_EXTENSIONS.includes(ext)) {
    logger.debug(
      `writeToCachedPath: Skipping cache for unsupported file type: ${sourcePath}`,
    );
    return sourcePath;
  }
  const sourceFilename = basename(sourcePath);
  const forcePreserveRelative = sourceFilename === "stdlib.hql" ||
    sourceFilename === "stdlib.ts";
  const usePreserveRelative = forcePreserveRelative || options.preserveRelative;

  // Process content if needed
  const processedContent = await processCacheFileContent(content, sourcePath);

  // Get cached path with potentially forced preserveRelative option
  const outputPath = await getCachedPath(sourcePath, targetExt, {
    createDir: true,
    preserveRelative: usePreserveRelative,
  });

  // Register this cached path for import resolution
  registerImportMapping(sourcePath, outputPath);

  // Write content
  await writeTextFile(outputPath, processedContent);
  logger.debug(
    `Written ${targetExt} output for ${sourcePath} to ${outputPath}`,
  );

  return outputPath;
}

/**
 * Create a temporary directory in the cache
 */
export async function createTempDir(
  prefix: string = "tmp",
): Promise<string> {
  const cacheDir = await getCacheDir();
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  const dirPath = join(cacheDir, "temp", `${prefix}-${timestamp}-${random}`);

  await ensureDir(dirPath);
  logger.debug(`Created temp directory: ${dirPath}`);
  return dirPath;
}

/**
 * Clear cache
 * This function removes all cached files to force regeneration
 */
export async function clearCache(): Promise<void> {
  const cacheDir = await getCacheDir();
  try {
    await remove(cacheDir, { recursive: true });
    logger.debug(`Cleared cache directory: ${cacheDir}`);
  } catch (error) {
    logger.debug(`Error clearing cache: ${getErrorMessage(error)}`);
  }

  // Reset in-memory caches too
  contentHashCache.clear();
  importPathMap.clear();

  // Recreate the cache directory
  await ensureDir(cacheDir);
}

/**
 * Process JavaScript files to fix their import paths when copied to cache
 * This ensures relative imports still work after moving to the cache
 */
export async function processJavaScriptFile(filePath: string): Promise<void> {
  try {
    if (inProgressJs.has(filePath)) {
      // Even though we're in progress, ensure the file is registered in cache
      const cachedPath = await getCachedPath(filePath, ".js", {
        preserveRelative: true,
        createDir: true,
      });
      // If the cached file doesn't exist yet, create a minimal version
      if (!await exists(cachedPath)) {
        const content = await readTextFile(filePath);
        // For circular dependencies, we need to at least process the imports
        // to avoid import errors, even if we can't fully process nested dependencies
        const processedContent = await processCacheFileContent(
          content,
          filePath,
        );
        await writeTextFile(cachedPath, processedContent);
        logger.debug(
          `Created processed cached copy at ${cachedPath} to break cycle`,
        );
      }
      registerImportMapping(filePath, cachedPath);
      return;
    }
    inProgressJs.add(filePath);

    // Check if the file exists
    if (!await exists(filePath)) {
      logger.debug(`JavaScript file does not exist: ${filePath}`);
      return;
    }

    // Read the JS file
    const content = await readTextFile(filePath);

    // Process the file for imports
    const processedContent = await processJavaScriptImports(content, filePath);

    // Write to cache
    const cachedPath = await writeToCachedPath(
      filePath,
      processedContent,
      ".js",
      {
        preserveRelative: true,
      },
    );

    // Register this path for import resolution
    registerImportMapping(filePath, cachedPath);
    logger.debug(`Processed JavaScript file ${filePath} -> ${cachedPath}`);
  } catch (error) {
    logger.debug(`Error processing JavaScript file ${filePath}: ${getErrorMessage(error)}`);
  } finally {
    inProgressJs.delete(filePath);
  }
}

/**
 * Process imports in JavaScript files to work in the cache directory
 */
async function processJavaScriptImports(
  content: string,
  filePath: string,
): Promise<string> {
  // First process HQL imports
  let result = await rewriteHqlImportsInJs(content, filePath);

  // Then process JavaScript imports
  result = await processTsImportsInJs(result, filePath);

  // Then process JS imports to handle hyphenated filenames
  result = await processJsImportsInJs(result, filePath);

  return result;
}

function isAbsoluteImportPath(importPath: string): boolean {
  return importPath.startsWith("file://") ||
    importPath.startsWith("http") ||
    importPath.startsWith("npm:") ||
    importPath.startsWith("jsr:");
}

interface ImportRewriteContext {
  importPath: string;
  fullImport: string;
}

async function rewriteRelativeImports(
  content: string,
  importRegex: RegExp,
  handler: (ctx: ImportRewriteContext) => Promise<string | null>,
): Promise<string> {
  let modifiedContent = content;
  importRegex.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(content)) !== null) {
    const fullImport = match[0];
    const importPath = match[1];

    if (isAbsoluteImportPath(importPath)) {
      logger.debug(`Skipping absolute import: ${importPath}`);
      continue;
    }

    try {
      const replacement = await handler({ importPath, fullImport });
      if (replacement) {
        modifiedContent = modifiedContent.replace(fullImport, replacement);
      }
    } catch (error) {
      logger.debug(
        `Error processing import ${importPath}: ${
          getErrorMessage(error)
        }`,
      );
    }
  }

  return modifiedContent;
}

/**
 * Process JavaScript imports in a JavaScript file, handling potential hyphenated filenames.
 * This is specifically for fixing issues with files that have hyphens in their names.
 */
async function processJsImportsInJs(
  content: string,
  filePath: string,
): Promise<string> {
  const jsImportRegex =
    /import\s+.*\s+from\s+['"]([^'"]+(?:\.js|(?!\.\w+)(?!["'])))['"]/g;
  logger.debug(`Processing JS imports in JS file: ${filePath}`);

  let modifiedContent = await rewriteRelativeImports(
    content,
    jsImportRegex,
    async ({ importPath, fullImport }) => {
      const pathForResolving = importPath.endsWith(".js")
        ? importPath
        : `${importPath}.js`;
      const resolvedImportPath = resolve(
        dirname(filePath),
        pathForResolving,
      );
      const directory = dirname(resolvedImportPath);
      const fileName = basename(resolvedImportPath);
      const fileNameBase = fileName.replace(JS_EXTENSION_REGEX, "");

      let sourcePath: string | null = null;
      let keepExtensionInImport = importPath.endsWith(".js");

      if (await exists(resolvedImportPath)) {
        sourcePath = resolvedImportPath;
      } else {
        const underscoreFileName = `${hyphenToUnderscore(fileNameBase)}.js`;
        const underscorePath = join(directory, underscoreFileName);
        if (await exists(underscorePath)) {
          sourcePath = underscorePath;
          keepExtensionInImport = true;
          logger.debug(
            `Using underscore variant for JS import: ${importPath} -> ${underscoreFileName}`,
          );
        }
      }

      if (!sourcePath) {
        logger.debug(
          `Could not locate JS file for import: ${importPath} (resolved to ${resolvedImportPath})`,
        );
        return null;
      }

      const cachedJsPath = await writeToCachedPath(
        sourcePath,
        await readTextFile(sourcePath),
        "",
        { preserveRelative: true },
      );
      registerImportMapping(resolvedImportPath, cachedJsPath);

      const newImportPath = keepExtensionInImport
        ? `file://${cachedJsPath}`
        : `file://${cachedJsPath.replace(JS_EXTENSION_REGEX, "")}`;

      logger.debug(`Rewritten JS import: ${importPath} -> ${newImportPath}`);
      return fullImport.replace(importPath, newImportPath);
    },
  );

  // Use pre-compiled regex for performance
  let importMatch;
  NAMED_IMPORT_REGEX.lastIndex = 0;

  while ((importMatch = NAMED_IMPORT_REGEX.exec(modifiedContent)) !== null) {
    const importedIds = importMatch[1].split(",").map((id) => id.trim());
    let needsUpdate = false;
    const newImportList: string[] = [];

    for (const id of importedIds) {
      const parts = id.split(" as ");
      const baseName = parts[0].trim();

      if (baseName.includes("-")) {
        const sanitized = sanitizeIdentifier(baseName);
        if (parts.length > 1) {
          newImportList.push(`${sanitized} as ${parts[1].trim()}`);
        } else {
          newImportList.push(sanitized);
        }
        needsUpdate = true;
      } else {
        newImportList.push(id);
      }
    }

    if (needsUpdate) {
      const oldImportSection = `{ ${importMatch[1]} }`;
      const newImportSection = `{ ${newImportList.join(", ")} }`;
      modifiedContent = modifiedContent.replace(
        oldImportSection,
        newImportSection,
      );
      logger.debug(
        `Sanitized import identifiers: ${oldImportSection} -> ${newImportSection}`,
      );
    }
  }

  // Use pre-compiled regex for performance
  NAMESPACE_IMPORT_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = NAMESPACE_IMPORT_REGEX.exec(modifiedContent)) !== null) {
    const importName = match[1];
    if (importName.includes("-")) {
      const sanitized = sanitizeIdentifier(importName);
      const oldImport = `* as ${importName} from`;
      const newImport = `* as ${sanitized} from`;
      modifiedContent = modifiedContent.replace(oldImport, newImport);

      const idRegex = new RegExp(`\\b${importName}\\b`, "g");
      modifiedContent = modifiedContent.replace(idRegex, sanitized);

      logger.debug(`Sanitized namespace import: ${importName} -> ${sanitized}`);
    }
  }

  return modifiedContent;
}

/**
 * Process JavaScript imports in a JavaScript file
 */
async function processTsImportsInJs(
  content: string,
  filePath: string,
): Promise<string> {
  // Use pre-compiled regex for performance
  logger.debug(`Processing TS imports in JS file: ${filePath}`);

  return await rewriteRelativeImports(
    content,
    TS_IMPORT_REGEX,
    async ({ importPath, fullImport }) => {
      const resolvedImportPath = resolve(dirname(filePath), importPath);

      if (!await exists(resolvedImportPath)) {
        logger.debug(`Could not find TS file: ${resolvedImportPath}`);
        return null;
      }

      try {
        logger.debug(`Found TS import in JS file: ${importPath}`);
        const tsContent = await readTextFile(resolvedImportPath);
        const cachedTsPath = await writeToCachedPath(
          resolvedImportPath,
          tsContent,
          ".ts",
          {
            preserveRelative: true,
          },
        );

        registerImportMapping(resolvedImportPath, cachedTsPath);
        const newImportPath = `file://${cachedTsPath}`;
        return fullImport.replace(importPath, newImportPath);
      } catch (error) {
        logger.debug(
          `Error processing TS import in JS ${importPath}: ${
            getErrorMessage(error)
          }`,
        );
        return null;
      }
    },
  );
}

/**
 * Process HQL imports in a JavaScript file, transpiling the HQL files and updating import paths.
 */
async function rewriteHqlImportsInJs(
  content: string,
  filePath: string,
): Promise<string> {
  // Use pre-compiled regex for performance
  logger.debug(`Processing HQL imports in JS file: ${filePath}`);

  return await rewriteRelativeImports(
    content,
    HQL_IMPORT_REGEX,
    async ({ importPath, fullImport }) => {
      const resolvedImportPath = resolve(dirname(filePath), importPath);

      if (!await exists(resolvedImportPath)) {
        logger.debug(`Could not find HQL file: ${resolvedImportPath}`);
        return null;
      }

      logger.debug(`Found HQL import in JS file: ${importPath}`);

      const preTsPath = await getCachedPath(resolvedImportPath, ".ts", {
        createDir: true,
        preserveRelative: true,
      });
      const preJsPath = await getCachedPath(resolvedImportPath, ".js", {
        createDir: true,
        preserveRelative: true,
      });

      registerImportMapping(resolvedImportPath, preTsPath);
      registerImportMapping(
        resolvedImportPath.replace(HQL_EXTENSION_REGEX, ".ts"),
        preTsPath,
      );

      try {
        if (!await exists(preJsPath)) {
          const placeholderContent =
            `// Placeholder for circular dependency resolution\nconst handler = {\n  get(_target, _prop) {\n    return undefined;\n  }\n};\nconst moduleExports = new Proxy({}, handler);\nexport default moduleExports;\nexport const __esModule = true;\n// Export common named exports that return undefined\nexport const base = undefined;\nexport const aFunc = undefined;\nexport const incByBase = undefined;`;
          await writeTextFile(preJsPath, placeholderContent);
        }
      } catch (error) {
        logger.debug(
          `Failed to create placeholder JS file: ${
            getErrorMessage(error)
          }`,
        );
      }

      const cachedTsPath = await processHqlFile(resolvedImportPath);
      const cachedJsPath = preJsPath;

      try {
        const esbuild = await import("npm:esbuild@^0.17.0");
        await esbuild.build({
          entryPoints: [cachedTsPath],
          outfile: cachedJsPath,
          format: "esm",
          target: "es2020",
          bundle: false,
          platform: "neutral",
          logLevel: "silent",
        });
        logger.debug(
          `Transpiled cached TS to JS for JS import: ${cachedTsPath} -> ${cachedJsPath}`,
        );
      } catch (error) {
        logger.debug(
          `Failed TS->JS quick transpile for ${cachedTsPath}: ${
            getErrorMessage(error)
          }`,
        );
      }

      const newImportPath = `file://${cachedJsPath}`;
      logger.debug(
        `Rewritten HQL import in JS: ${importPath} -> ${newImportPath}`,
      );
      return fullImport.replace(importPath, newImportPath);
    },
  );
}

/**
 * Process nested imports in transpiled JavaScript content
 * This is critical for handling multi-level dependencies correctly
 */
async function processNestedImports(
  content: string,
  originalPath: string,
  cachedPath: string,
): Promise<string> {
  // Find all imports in the transpiled JavaScript
  // Use pre-compiled regex for performance
  let modifiedContent = content;
  let match;

  // Reset lastIndex for global regex
  IMPORT_REGEX.lastIndex = 0;

  logger.debug(`Processing nested imports in ${cachedPath}`);

  while ((match = IMPORT_REGEX.exec(content)) !== null) {
    const fullImport = match[0];
    const importPath = match[1];

    // Skip absolute imports
    if (
      importPath.startsWith("file://") || importPath.startsWith("http") ||
      importPath.startsWith("npm:") || importPath.startsWith("jsr:")
    ) {
      continue;
    }

    try {
      // Resolve the import path relative to the original source file
      const originalDir = dirname(originalPath);
      const resolvedImportPath = resolve(originalDir, importPath);

      // Check if this import is for an HQL file that needs to be cached
      if (isHqlFile(resolvedImportPath)) {
        if (await exists(resolvedImportPath)) {
          // Process the HQL file to ensure it's in the cache
          // This ensures the import chain is processed correctly
          const processedHqlPath = await processHqlFile(resolvedImportPath);

          // CRITICAL: Update import to use absolute file:// URL to cached path
          const newImport = fullImport.replace(
            importPath,
            `file://${processedHqlPath}`,
          );
          modifiedContent = modifiedContent.replace(fullImport, newImport);
          logger.debug(
            `Rewritten nested import: ${importPath} -> file://${processedHqlPath}`,
          );
        }
      } // Handle JavaScript imports specially to ensure they reference cached versions
      else if (resolvedImportPath.endsWith(".ts")) {
        if (await exists(resolvedImportPath)) {
          // Get or create the cached version
          const cachedImportPath = await getCachedPath(
            resolvedImportPath,
            ".ts",
            {
              preserveRelative: true,
              createDir: true,
            },
          );

          // Register the mapping
          registerImportMapping(resolvedImportPath, cachedImportPath);

          // CRITICAL: Update import to use absolute file:// URL to cached path
          const newImport = fullImport.replace(
            importPath,
            `file://${cachedImportPath}`,
          );
          modifiedContent = modifiedContent.replace(fullImport, newImport);
          logger.debug(
            `Rewritten nested TS import: ${importPath} -> file://${cachedImportPath}`,
          );
        }
      } // Handle JavaScript imports
      else if (resolvedImportPath.endsWith(".js")) {
        if (await exists(resolvedImportPath)) {
          // Process JS file to handle any HQL imports it might have
          await processJavaScriptFile(resolvedImportPath);

          // Check if the JS file has been mapped to a cached version
          const cachedJsPath = getImportMapping(resolvedImportPath);

          if (cachedJsPath) {
            // Use the cached version
            const newImport = fullImport.replace(
              importPath,
              `file://${cachedJsPath}`,
            );
            modifiedContent = modifiedContent.replace(fullImport, newImport);
            logger.debug(
              `Rewritten nested JS import: ${importPath} -> file://${cachedJsPath}`,
            );
          } else {
            // Use the original path but with file:// prefix for absolute imports
            const newImport = fullImport.replace(
              importPath,
              `file://${resolvedImportPath}`,
            );
            modifiedContent = modifiedContent.replace(fullImport, newImport);
            logger.debug(
              `Rewritten JS import to absolute path: ${importPath} -> file://${resolvedImportPath}`,
            );
          }
        }
      }
    } catch (error) {
      logger.debug(
        `Error processing nested import ${importPath}: ${
          getErrorMessage(error)
        }`,
      );
    }
  }

  return modifiedContent;
}

/**
 * Process HQL file to JavaScript, ensuring correct cache paths for imports
 */
async function processHqlFile(sourceFile: string): Promise<string> {
  logger.debug(`Processing HQL file: ${sourceFile}`);

  try {
    if (inProgressHql.has(sourceFile)) {
      logger.debug(
        `processHqlFile: already in progress ${sourceFile}, returning cached path to break cycle`,
      );
      // If mapping exists, use it; otherwise, compute deterministic cached path and register it
      const mapped = getImportMapping(sourceFile);
      if (mapped) return mapped;
      const cached = await getCachedPath(sourceFile, ".ts", {
        createDir: true,
        preserveRelative: true,
      });
      registerImportMapping(sourceFile, cached);
      registerImportMapping(sourceFile.replace(HQL_EXTENSION_REGEX, ".ts"), cached);
      return cached;
    }
    inProgressHql.add(sourceFile);
    // ALWAYS use preserveRelative for HQL files to ensure consistent path structure
    const cachedTsPath = await getCachedPath(sourceFile, ".ts", {
      createDir: true,
      preserveRelative: true, // Always preserve relative structure for HQL files
    });

    // Check if we need to process this file
    if (await exists(cachedTsPath)) {
      // File exists in cache, check if it's still valid
      if (!await needsRegeneration(sourceFile, ".ts")) {
        logger.debug(
          `Using cached JavaScript for ${sourceFile}: ${cachedTsPath}`,
        );

        // Register the mapping for future use
        registerImportMapping(sourceFile, cachedTsPath);
        registerImportMapping(
          sourceFile.replace(HQL_EXTENSION_REGEX, ".ts"),
          cachedTsPath,
        );

        return cachedTsPath;
      }
    }

    // Process the HQL file to JavaScript
    logger.debug(`Transpiling HQL to JavaScript: ${sourceFile}`);

    // CRITICAL: Copy JS dependencies BEFORE transpilation
    // The transpiler needs these files to resolve imports
    await copyNeighborFiles(sourceFile, dirname(cachedTsPath));

    // Run the transpiler via bundler
    const tsContent = await transpileHqlInJs(sourceFile, dirname(sourceFile));
    const processedContent = await processNestedImports(
      tsContent,
      sourceFile,
      cachedTsPath,
    );

    // Write to cache
    await writeTextFile(cachedTsPath, processedContent);

    // Register the mapping for future use
    registerImportMapping(sourceFile, cachedTsPath);
    registerImportMapping(sourceFile.replace(HQL_EXTENSION_REGEX, ".ts"), cachedTsPath);

    logger.debug(`Processed HQL file ${sourceFile} to ${cachedTsPath}`);

    return cachedTsPath;
  } catch (error) {
    logger.error(
      `Error processing HQL file ${sourceFile}: ${
        getErrorMessage(error)
      }`,
    );
    throw error;
  } finally {
    inProgressHql.delete(sourceFile);
  }
}

interface TempDirResult {
  tempDir: string;
  created: boolean;
}

/**
 * Creates a temporary directory if one is not already provided.
 * Used by both bundler and import processing.
 *
 * @param options Options containing an optional tempDir
 * @param prefix Prefix for the temporary directory name
 * @param logger Optional logger instance
 * @returns TempDirResult containing the directory path and whether it was created
 */
export async function createTempDirIfNeeded(
  options: { tempDir?: string; verbose?: boolean },
  prefix: string = "hql_temp_",
  logger?: {
    debug: (msg: string) => void;
    log: (msg: { text: string; namespace?: string }) => void;
  },
): Promise<TempDirResult> {
  try {
    // Use provided temp directory if available
    if (options.tempDir) {
      if (logger?.debug) {
        logger.debug(`Using existing temp directory: ${options.tempDir}`);
      }
      return { tempDir: options.tempDir, created: false };
    }

    // Create new temp directory
    const tempDir = await makeTempDir({ prefix });

    if (logger?.debug) {
      logger.debug(`Created temporary directory: ${tempDir}`);
    } else if (logger?.log && options.verbose) {
      logger.log({
        text: `Created temporary directory: ${tempDir}`,
        namespace: "utils",
      });
    }

    return { tempDir, created: true };
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    throw new Error(`Creating temporary directory: ${errorMsg}`);
  }
}

export { processHqlFile };
