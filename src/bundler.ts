// bundler.ts
// Use patched esbuild-wasm browser version
// @ts-ignore: Local patched JS file
import * as esbuild from "./vendor/esbuild-browser.js";
import { getEsbuildWasmModule } from "./esbuild-wasm-embedded.ts";
import type {
  BuildOptions,
  LogLevel,
  OnLoadArgs,
  OnLoadResult,
  OnResolveArgs,
  OnResolveResult,
  Plugin,
  PluginBuild,
} from "npm:esbuild-wasm@^0.17.0";
import { transpileToJavascript } from "./transpiler/hql-transpiler.ts";
import { formatErrorMessage } from "./common/error.ts";
import { ERROR_REPORTED_SYMBOL } from "./common/error-constants.ts";
import {
  isHqlFile,
  isJsFile,
  isTypeScriptFile,
} from "./common/import-utils.ts";
import {
  checkForHqlImports,
  findActualFilePath,
  getErrorMessage,
  isObjectValue,
  readFile,
  sanitizeIdentifier,
} from "./common/utils.ts";
import { initializeRuntime } from "./common/runtime-initializer.ts";
import { globalLogger as logger } from "./logger.ts";
import {
  cwd,
  dirname,
  ensureDir,
  exists,
  extname,
  isAbsolute,
  readTextFile,
  resolve,
  writeTextFile,
} from "./platform/platform.ts";
import { TranspilerError, ValidationError } from "./common/error.ts";
import {
  createTempDir,
  createTempDirIfNeeded,
  getCachedPath,
  getContentHash,
  getImportMapping,
  needsRegeneration,
  registerImportMapping,
  writeToCachedPath,
} from "./common/hql-cache-tracker.ts";
import { transpile, type TranspileOptions } from "./transpiler/index.ts";
import { fromFileUrl, join } from "./platform/platform.ts";
import { preloadSourceMap } from "./transpiler/pipeline/source-map-support.ts";
import { LRUCache } from "./common/lru-cache.ts";

/**
 * Get the path to the stdlib index.js file.
 * In development mode, this is relative to the bundler.ts location.
 * In a compiled binary, the stdlib content will be embedded and written to cache.
 */
function getStdlibPath(): string {
  // Get the directory where this file (bundler.ts) is located
  const thisFileUrl = import.meta.url;
  const thisFilePath = thisFileUrl.startsWith("file://")
    ? fromFileUrl(thisFileUrl)
    : thisFileUrl;
  const thisDir = dirname(thisFilePath);
  // stdlib is at lib/stdlib/js/index.js relative to src/
  return join(thisDir, "lib", "stdlib", "js", "index.js");
}

function propagateReportedFlag(source: unknown, target: object): void {
  if (isObjectValue(source)) {
    if (Reflect.get(source, ERROR_REPORTED_SYMBOL)) {
      Reflect.set(target, ERROR_REPORTED_SYMBOL, true);
    }
  }
}

/**
 * Wrap an error with a new message and propagate the reported flag
 */
function wrapError(error: unknown, message: string): TranspilerError {
  const newError = new TranspilerError(`${message}: ${getErrorMessage(error)}`);
  propagateReportedFlag(error, newError);
  return newError;
}

// Constants
const DEFAULT_EXTERNAL_PATTERNS = [
  "npm:",
  "jsr:",
  "node:",
  "https://",
  "http://",
];

const RUNTIME_GET_SNIPPET = `// Runtime get function for HQL
function get(obj, key) {
  // If obj is a function, call it with the key as argument
  if (typeof obj === 'function') {
    return obj(key);
  }
  // Otherwise, treat it as property access
  return obj[key];
}

`;

// Error messages
const ERROR_ALREADY_INITIALIZED = "already been initialized";
const ERROR_INITIALIZE = "initialize";

// Interfaces
export interface BundleOptions {
  verbose?: boolean;
  standalone?: boolean;
  /** Enable minification (default: false for dev, true for --release) */
  minify?: boolean;
  /** Source map generation: "inline" | "external" | false (default: "inline") */
  sourcemap?: "inline" | "external" | boolean;
  outDir?: string;
  tempDir?: string;
  keepTemp?: boolean;
  noBundle?: boolean;
  sourceDir?: string;
  cleanup?: boolean;
  debug?: boolean;
  force?: boolean;
  showTiming?: boolean;
  external?: string[];
  esbuildTarget?: string | string[];
}

interface ImportInfo {
  full: string;
  path: string;
}

interface UnifiedPluginOptions {
  verbose?: boolean;
  tempDir?: string;
  sourceDir?: string;
  externalPatterns?: string[];
}

// Main API function
export async function transpileCLI(
  inputPath: string,
  outputPath?: string,
  options: {
    verbose?: boolean;
    showTiming?: boolean;
    force?: boolean;
    external?: string[];
    esbuildTarget?: string | string[];
    skipBundle?: boolean; // Skip bundling step (just transpile)
    /** Enable minification (default: false, true with --release) */
    minify?: boolean;
    /** Source map generation (default: "inline") */
    sourcemap?: "inline" | "external" | boolean;
  } = {},
): Promise<string> {
  configureLogger(options);
  await initializeRuntime();

  const resolvedInputPath = resolve(inputPath);
  const outPath = determineOutputPath(resolvedInputPath, outputPath);
  const sourceDir = dirname(resolvedInputPath);
  const bundleOptions = { ...options, sourceDir };

  // Process entry file
  if (options.showTiming) logger.startTiming("transpile-cli", "Process Entry");
  const { tsOutputPath } = await processEntryFile(
    resolvedInputPath,
    outPath,
    bundleOptions,
  );
  if (options.showTiming) logger.endTiming("transpile-cli", "Process Entry");

  // Skip bundling if requested (e.g., in compiled binary where esbuild doesn't work)
  if (options.skipBundle) {
    logger.log({ text: `[Bundler] Skipping bundle, output: ${tsOutputPath}`, namespace: "bundler" });
    // Copy transpiled TS to output path if different
    if (tsOutputPath !== outPath) {
      const content = await readTextFile(tsOutputPath);
      await writeTextFile(outPath, content);
    }
    return outPath;
  }

  // Bundle the processed file
  if (options.showTiming) {
    logger.startTiming("transpile-cli", "esbuild Bundling");
  }

  logger.log({
    text: `[Bundler] Forcing esbuild to use inline source maps for the bundle.`,
    namespace: "bundler",
  });

  await bundleWithEsbuild(tsOutputPath, outPath, { ...bundleOptions });

  logger.log({ text: `[Bundler] Bundled to ${outPath}`, namespace: "bundler" });

  if (options.showTiming) logger.endTiming("transpile-cli", "esbuild Bundling");

  return outPath;
}

export async function prebundleHqlImportsInJs(
  jsSource: string,
  jsFilePath: string,
  options: BundleOptions,
): Promise<string> {
  try {
    return await prebundleHqlImports(jsSource, jsFilePath, options, true);
  } catch (error) {
    throw wrapError(error, "Processing HQL imports in JS file");
  }
}

// Track processing to prevent circular recursion during pre-processing
type ProcessingCtx = { stack: Set<string> };

async function prebundleHqlImports(
  source: string,
  filePath: string,
  options: BundleOptions,
  isJs: boolean,
  ctx: ProcessingCtx = { stack: new Set<string>() },
): Promise<string> {
  const baseDir = dirname(filePath);
  let modifiedSource = source;
  const imports = extractHqlImports(source);

  logger.debug(
    `Processing ${imports.length} HQL imports in ${isJs ? "JS" : "TS"} file`,
  );

  for (const importInfo of imports) {
    // Resolve the import path
    const resolvedHqlPath = await resolveImportPath(
      importInfo.path,
      baseDir,
      options,
    );
    if (!resolvedHqlPath) {
      throw new Error(
        `Could not resolve import: ${importInfo.path} from ${filePath}`,
      );
    }

    // Detect circular dependency in preprocessing chain
    if (ctx.stack.has(resolvedHqlPath)) {
      // Leave the original .hql import as-is; esbuild plugin will handle it
      logger.debug(
        `Skipping circular HQL import preprocessing: ${filePath} -> ${resolvedHqlPath}`,
      );
      continue;
    }
    ctx.stack.add(resolvedHqlPath);

    // Transpile HQL to JavaScript if needed
    if (await needsRegeneration(resolvedHqlPath, ".ts") || options.force) {
      logger.debug(`Transpiling HQL import: ${resolvedHqlPath}`);
      const hqlSource = await readFile(resolvedHqlPath);
      let { code: jsCode } = await transpileToJavascript(hqlSource, {
        baseDir: dirname(resolvedHqlPath),
        verbose: options.verbose,
        tempDir: options.tempDir,
        sourceDir: options.sourceDir || dirname(resolvedHqlPath),
        currentFile: resolvedHqlPath,
        sourceContent: hqlSource,
      });

      // IMPORTANT: Recursively process any HQL imports in the transpiled JavaScript
      if (checkForHqlImports(jsCode)) {
        logger.debug(
          `Found nested HQL imports in ${resolvedHqlPath}, processing recursively`,
        );
        jsCode = await prebundleHqlImports(
          jsCode,
          resolvedHqlPath,
          options,
          false,
          ctx,
        );
      }

      // Cache the transpiled file
      const cachedTsPath = await writeToCachedPath(
        resolvedHqlPath,
        jsCode,
        ".ts",
        { preserveRelative: true },
      );
      if (!resolvedHqlPath.endsWith(".ts")) {
        const jsAliasPath = resolvedHqlPath.replace(/\.[^.]+$/, ".ts");
        registerImportMapping(jsAliasPath, cachedTsPath);
      }
    }

    // Get path to cached JavaScript file (stored with .ts extension for compatibility)
    const cachedTsPath = await getCachedPath(resolvedHqlPath, ".ts");
    let targetPath = cachedTsPath; // Default to TypeScript path

    if (isJs) {
      // For JS files, we need JavaScript output
      if (await needsRegeneration(resolvedHqlPath, ".js") || options.force) {
        logger.debug(`Generating JavaScript from cached file: ${cachedTsPath}`);

        // Get path for cached JS file
        const cachedJsPath = await getCachedPath(resolvedHqlPath, ".js", {
          createDir: true,
          preserveRelative: true,
        });

        // Bundle cached JavaScript (cachedTsPath is the source, cachedJsPath is the destination)
        await bundleWithEsbuild(cachedTsPath, cachedJsPath, {
          verbose: options.verbose,
          sourceDir: options.sourceDir || dirname(resolvedHqlPath),
          external: options.external,
          esbuildTarget: options.esbuildTarget,
        });
      }

      // Get path to cached JavaScript file
      targetPath = await getCachedPath(resolvedHqlPath, ".js");
    }

    // Update import in source with the appropriate cached path
    modifiedSource = modifiedSource.replace(
      importInfo.full,
      importInfo.full.replace(importInfo.path, targetPath),
    );
    logger.debug(`Updated import: ${importInfo.path} → ${targetPath}`);

    // Done with this dependency in the current chain
    ctx.stack.delete(resolvedHqlPath);
  }

  return modifiedSource;
}

// Simplified process functions with shared logic

// Main processing function
async function processEntryFile(
  inputPath: string,
  outputPath: string,
  options: BundleOptions = {},
): Promise<{ tsOutputPath: string; sourceMap?: string }> {
  try {
    const resolvedInputPath = resolve(inputPath);
    logger.debug(`Processing entry file: ${resolvedInputPath}`);
    logger.debug(`Output path: ${outputPath}`);

    if (isHqlFile(resolvedInputPath)) {
      return await processHqlEntryFile(resolvedInputPath, options);
    } else if (
      isJsFile(resolvedInputPath) || isTypeScriptFile(resolvedInputPath)
    ) {
      const tsOutputPath = await processJsOrTsEntryFile(
        resolvedInputPath,
        outputPath,
        options,
      );
      return { tsOutputPath };
    } else {
      throw new ValidationError(
        `Unsupported file type: ${inputPath} (expected .hql, .js, or .ts)`,
        "file type validation",
      );
    }
  } catch (error) {
    // Do not log here; let the centralized error handler report it.
    throw error;
  }
}

async function processHqlEntryFile(
  resolvedInputPath: string,
  options: BundleOptions,
): Promise<{ tsOutputPath: string; sourceMap?: string }> {
  logger.log({
    text: `Transpiling HQL entry file: ${resolvedInputPath}`,
    namespace: "bundler",
  });

  const tempDir = await createTempDir("entry");

  const source = await readFile(resolvedInputPath);
  logger.log({
    text: `Read ${source.length} bytes from ${resolvedInputPath}`,
    namespace: "bundler",
  });

  let { code: jsCode, sourceMap } = await transpileToJavascript(source, {
    baseDir: dirname(resolvedInputPath),
    verbose: options.verbose,
    tempDir,
    sourceDir: options.sourceDir || dirname(resolvedInputPath),
    currentFile: resolvedInputPath,
    sourceContent: source,
  });

  // Inject stdlib import for bundling - esbuild will resolve and inline it
  const stdlibImport = `import { first, rest, next, cons, nth, count, second, last, isEmpty, some, every, notAny, notEvery, isSome, take, drop, map, filter, reduce, concat, flatten, distinct, mapIndexed, keepIndexed, mapcat, keep, seq, empty, conj, into, repeat, repeatedly, cycle, iterate, lazySeq, get, getIn, assoc, assocIn, dissoc, update, updateIn, merge, vec, set, range, comp, partial, apply, groupBy, keys, doall, realized, add, sub, mul, div, mod, inc, dec, isNil, eq, neq, lt, gt, lte, gte, LazySeq, __hql_get, __hql_getNumeric, __hql_range, __hql_toSequence, __hql_for_each, __hql_hash_map, __hql_throw, __hql_deepFreeze, __hql_lazy_seq } from "./hql-stdlib.js";\n`;
  jsCode = stdlibImport + jsCode;
  logger.debug("Injected stdlib import for bundling");

  // Update source map to account for the prepended stdlib import line
  // Each `;` in VLQ mappings represents a new line in generated code
  // Prepending 1 line means prepending 1 `;` to shift all mappings down
  if (sourceMap) {
    try {
      const mapJson = JSON.parse(sourceMap);
      // Count how many lines we prepended (stdlib import is 1 line)
      const prependedLines = 1;
      // Prepend semicolons to shift all line numbers
      mapJson.mappings = ";".repeat(prependedLines) + mapJson.mappings;
      sourceMap = JSON.stringify(mapJson);
      logger.debug(`Adjusted source map for ${prependedLines} prepended line(s)`);
    } catch (e) {
      logger.debug(`Failed to adjust source map: ${getErrorMessage(e)}`);
    }
  }

  if (checkForHqlImports(jsCode)) {
    logger.log({
      text:
        "Detected nested HQL imports in transpiled output. Processing them.",
      namespace: "bundler",
    });
    jsCode = await prebundleHqlImportsInJs(jsCode, resolvedInputPath, options);
  }

  const tsOutputPath = await writeToCachedPath(
    resolvedInputPath,
    jsCode,
    ".ts",
  );

  // Write source map file so esbuild can chain it when bundling
  if (sourceMap) {
    const mapPath = `${tsOutputPath}.map`;
    await writeTextFile(mapPath, sourceMap);
    logger.debug(`Wrote source map to ${mapPath}`);

    // Add sourceMappingURL to the cached file so esbuild knows about it
    // Extract just the filename from the full path
    const filename = tsOutputPath.split('/').pop() || 'output.ts';
    const jsCodeWithMap = `${jsCode}\n//# sourceMappingURL=${filename}.map`;
    await writeTextFile(tsOutputPath, jsCodeWithMap);

    // Preload source map into cache for error handling (non-blocking)
    // This ensures source maps are available during Error.prepareStackTrace
    await preloadSourceMap(tsOutputPath);
  }

  return { tsOutputPath, sourceMap };
}

async function processJsOrTsEntryFile(
  resolvedInputPath: string,
  outputPath: string,
  options: BundleOptions,
): Promise<string> {
  try {
    const isTs = isTypeScriptFile(resolvedInputPath);
    const source = await readFile(resolvedInputPath);

    logger.log({
      text: `Read ${source.length} bytes from ${resolvedInputPath}`,
      namespace: "bundler",
    });
    // Process HQL imports if present
    const processedSource = checkForHqlImports(source)
      ? await prebundleHqlImportsInJs(source, resolvedInputPath, options)
      : source;

    // Write output with appropriate extension
    const finalOutputPath = isTs ? outputPath.replace(/\.js$/, ".ts") : outputPath;
    await writeOutput(processedSource, finalOutputPath);
    return finalOutputPath;
  } catch (error) {
    const fileType = isTypeScriptFile(resolvedInputPath) ? "TypeScript" : "JavaScript";
    throw wrapError(error, `Processing ${fileType} entry file`);
  }
}

/**
 * Create unified bundle plugin for esbuild
 */
function createUnifiedBundlePlugin(options: UnifiedPluginOptions): Plugin {
  const processedHqlFiles = new Set<string>();
  const processedTsFiles = new Set<string>();
  const filePathMap = new Map<string, string>();
  const circularDependencies = new Map<string, Set<string>>();

  const plugin: Plugin = {
    name: "unified-hql-bundle-plugin",
    setup(build: PluginBuild) {
      // Handle file:// URLs
      build.onResolve(
        { filter: /^file:\/\// },
        async (args: OnResolveArgs): Promise<OnResolveResult | null> => {
          const filePath = args.path.replace("file://", "");
          logger.debug(`Converting file:// URL: ${args.path} → ${filePath}`);

          if (await exists(filePath)) {
            return { path: filePath };
          }
          logger.warn(`File not found: ${filePath}`);
          return { path: args.path, external: true };
        },
      );

      // Mark remote modules as external
      build.onResolve(
        { filter: /^(npm:|jsr:|https?:|node:)/ },
        (args: OnResolveArgs): OnResolveResult => {
          logger.debug(`External module: ${args.path}`);
          return { path: args.path, external: true };
        },
      );

      // Handle HQL stdlib import - resolve to actual stdlib location
      build.onResolve(
        { filter: /hql-stdlib\.js$/ },
        async (args: OnResolveArgs): Promise<OnResolveResult> => {
          const stdlibPath = getStdlibPath();
          logger.debug(`Resolving HQL stdlib: ${args.path} → ${stdlibPath}`);

          if (await exists(stdlibPath)) {
            return { path: stdlibPath, namespace: "file" };
          }

          // Fallback: try to find stdlib in common locations
          const fallbackPaths = [
            join(cwd(), "src", "lib", "stdlib", "js", "index.js"),
            join(cwd(), "lib", "stdlib", "js", "index.js"),
          ];

          for (const fallback of fallbackPaths) {
            if (await exists(fallback)) {
              logger.debug(`Found stdlib at fallback: ${fallback}`);
              return { path: fallback, namespace: "file" };
            }
          }

          logger.error(`HQL stdlib not found! Tried: ${stdlibPath}`);
          return { path: args.path, external: true };
        },
      );

      // Handle .hql/.js/.ts files with custom resolver
      build.onResolve({ filter: /\.(hql|js|ts)$/ }, (args: OnResolveArgs) => {
        // Track circular dependencies
        if (args.importer) {
          if (!circularDependencies.has(args.importer)) {
            circularDependencies.set(args.importer, new Set());
          }
          circularDependencies.get(args.importer)!.add(args.path);

          // Check if this would create a circular dependency
          const isCircular = checkForCircularDependency(
            args.importer,
            args.path,
            circularDependencies,
          );
          if (isCircular) {
            logger.debug(
              `Circular dependency detected: ${args.importer} -> ${args.path}`,
            );
          }
        }

        // If an HQL file has a pre-determined cached path, resolve directly to it to break cycles
        if (isHqlFile(args.path)) {
          try {
            const importerDir = args.importer ? dirname(args.importer) : cwd();
            const absCandidate = resolve(importerDir, args.path);
            const direct = filePathMap.get(args.path) ||
              filePathMap.get(absCandidate);
            const mapped = direct || getImportMapping(absCandidate) ||
              getImportMapping(args.path);
            if (mapped) {
              return { path: mapped, namespace: "file" };
            }
          } catch (error) {
            // Log and fall through to normal resolution
            logger.debug(`Cache lookup failed for ${args.path}, falling back to normal resolution: ${getErrorMessage(error)}`);
          }
        }

        return resolveHqlImport(args, options);
      });

      // Helper to process TypeScript/JavaScript files with HQL imports
      const processFileWithHqlImports = async (
        filePath: string,
        loader: "ts" | "js",
        trackProcessed: boolean = false,
      ): Promise<OnLoadResult | null> => {
        try {
          // Skip if already processed (TypeScript files only)
          if (trackProcessed && processedTsFiles.has(filePath)) {
            return null;
          }

          if (trackProcessed) {
            logger.debug(`Processing TypeScript file: ${filePath}`);
          }

          const contents = await readFile(filePath);

          // Process HQL imports if present
          const processedContent = checkForHqlImports(contents)
            ? await prebundleHqlImportsInJs(contents, filePath, {
                verbose: options.verbose,
                tempDir: options.tempDir,
                sourceDir: options.sourceDir,
              })
            : contents;

          if (trackProcessed) {
            processedTsFiles.add(filePath);
          }

          return {
            contents: processedContent,
            loader,
            resolveDir: dirname(filePath),
          };
        } catch (error) {
          logger.error(
            `Error processing ${loader === "ts" ? "TypeScript" : "JavaScript"} file ${filePath}: ${
              formatErrorMessage(error)
            }`,
          );
          return null;
        }
      };

      // Special handling for TypeScript files
      build.onLoad(
        { filter: /\.ts$/, namespace: "file" },
        async (args: OnLoadArgs) => await processFileWithHqlImports(args.path, "ts", true),
      );

      // Special handling for JavaScript files that import HQL
      build.onLoad(
        { filter: /\.js$/, namespace: "file" },
        async (args: OnLoadArgs) => await processFileWithHqlImports(args.path, "js"),
      );

      // Load HQL files with custom loader
      build.onLoad(
        { filter: /.*/, namespace: "hql" },
        async (args: OnLoadArgs): Promise<OnLoadResult> => {
          try {
            logger.debug(`Loading HQL file: ${args.path}`);

            // Check if already processed
            if (filePathMap.has(args.path)) {
              return loadTranspiledFile(filePathMap.get(args.path)!);
            }

            // If in progress, allow resolver to find the cached path via the pre-registered map
            if (processedHqlFiles.has(args.path)) {
              logger.debug(`Already processing: ${args.path}`);
              const mapped = filePathMap.get(args.path);
              if (mapped) {
                return loadTranspiledFile(mapped);
              }
              // Fallthrough: esbuild may retry once mapping is available
            }

            processedHqlFiles.add(args.path);

            // Get actual file path
            const actualPath = await findActualFilePath(args.path, logger);

            // Pre-compute and register cached path to short-circuit circular resolutions
            const preCachedPath = await getCachedPath(actualPath, ".ts", {
              createDir: true,
              preserveRelative: true,
            });
            filePathMap.set(args.path, preCachedPath);
            if (args.path !== actualPath) {
              filePathMap.set(actualPath, preCachedPath);
            }
            registerImportMapping(actualPath, preCachedPath);

            // Transpile HQL to JavaScript
            const jsCode = await transpileHqlFile(
              actualPath,
              options.sourceDir,
              options.verbose,
            );

            // Cache the transpiled file and register mappings
            const cachedPath = await writeToCachedPath(
              actualPath,
              jsCode,
              ".ts",
              {
                preserveRelative: true,
              },
            );
            if (!actualPath.endsWith(".ts")) {
              const tsAliasPath = actualPath.replace(/\.[^.]+$/, ".ts");
              registerImportMapping(tsAliasPath, cachedPath);
            }

            // Save in local map for this bundling session
            filePathMap.set(args.path, cachedPath);
            if (args.path !== actualPath) {
              filePathMap.set(actualPath, cachedPath);
            }

            return {
              contents: jsCode,
              loader: "ts",
              resolveDir: dirname(cachedPath),
            };
          } catch (error) {
            throw new TranspilerError(
              `Error loading HQL file ${args.path}: ${
                formatErrorMessage(error)
              }`,
            );
          }
        },
      );
    },
  };

  return plugin;
}

/**
 * Bundle the entry file and dependencies into a single JavaScript file
 */
// Track if esbuild WASM has been initialized
let esbuildInitialized = false;

/**
 * Initialize esbuild-wasm on first use
 * Uses embedded WASM module for compiled binary compatibility
 */
async function initializeEsbuildWasm(): Promise<void> {
  try {
    // Get the embedded WASM module (decoded from base64 and compiled)
    // This bypasses filesystem lookup, making it work in compiled binaries
    const wasmModule = await getEsbuildWasmModule();

    await esbuild.initialize({
      wasmModule,
      worker: false, // Disable worker threads for better compatibility
    });
    esbuildInitialized = true;
    logger.log({
      text: "esbuild-wasm initialized with embedded WASM",
      namespace: "bundler",
    });
  } catch (error) {
    // If already initialized, that's fine
    const errorMsg = getErrorMessage(error);
    if (errorMsg.includes(ERROR_ALREADY_INITIALIZED) || errorMsg.includes(ERROR_INITIALIZE)) {
      esbuildInitialized = true;
    } else {
      throw error;
    }
  }
}

async function bundleWithEsbuild(
  entryPath: string,
  outputPath: string,
  options: BundleOptions = {},
): Promise<string> {
  logger.log({
    text: `Bundling ${entryPath} to ${outputPath}`,
    namespace: "bundler",
  });

  // Initialize esbuild-wasm on first use (required for WASM version)
  // In Deno, esbuild-wasm auto-downloads and initializes the WASM binary
  if (!esbuildInitialized) {
    await initializeEsbuildWasm();
  }

  // Create temp directory if needed
  const { tempDir } = await createTempDirIfNeeded(
    options,
    "hql_bundle_",
    logger,
  );

  try {
    // Create unified plugin for all bundling operations
    const bundlePlugin = createUnifiedBundlePlugin({
      verbose: options.verbose,
      tempDir,
      sourceDir: options.sourceDir || dirname(entryPath),
    });

    const logLevel: LogLevel = options.verbose ? "info" : "silent";

    // Define build options
    const target = options.esbuildTarget
      ? Array.isArray(options.esbuildTarget)
        ? options.esbuildTarget
        : [options.esbuildTarget]
      : ["es2020"];
    const external = options.external ?? [];

    // Resolve sourcemap option: default to "inline" if not specified
    const sourcemapOption = options.sourcemap === undefined
      ? "inline" as const
      : options.sourcemap === true
        ? "inline" as const
        : options.sourcemap === false
          ? false
          : options.sourcemap;

    const buildOptions: BuildOptions = {
      entryPoints: [entryPath],
      bundle: true,
      outfile: outputPath,
      format: "esm",
      logLevel,
      minify: options.minify ?? false,  // Default: false (dev mode)
      treeShaking: true,
      platform: "neutral",
      target,
      plugins: [bundlePlugin as Plugin],
      allowOverwrite: true,
      metafile: true,
      write: false, // Browser WASM version doesn't support write, we'll write manually
      absWorkingDir: cwd(),
      nodePaths: [cwd(), dirname(entryPath)],
      external,
      loader: {
        ".ts": "ts" as const,
        ".js": "js" as const,
        ".hql": "ts" as const,
      },
      sourcemap: sourcemapOption,
      // Enable TypeScript processing
      tsconfig: JSON.stringify({
        compilerOptions: {
          target: "es2020",
          module: "esnext",
          moduleResolution: "node",
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          resolveJsonModule: true,
          isolatedModules: true,
          strict: false,
          skipLibCheck: true,
          allowJs: true,
          forceConsistentCasingInFileNames: true,
          importsNotUsedAsValues: "preserve",
        },
      }),
    };

    // Run the build
    logger.log({
      text: `Starting bundling: ${entryPath}`,
      namespace: "bundler",
    });

    const result = await esbuild.build(buildOptions);

    // Write output manually (browser WASM version doesn't support write: true)
    if (result.outputFiles && result.outputFiles.length > 0) {
      const outputContent = result.outputFiles[0].text;
      await writeTextFile(outputPath, outputContent);
    }

    // Post-process the output to normalize any stray file:// URLs
    if (result.metafile) {
      await postProcessBundleOutput(outputPath);
    }

    logger.log({
      text: `Successfully bundled to ${outputPath}`,
      namespace: "bundler",
    });

    return outputPath;
  } catch (error) {
    // Do not log here; let the centralized error handler report it.
    throw error;
  }
}

/**
 * Post-process bundle output to ensure it's fully self-contained
 */
async function postProcessBundleOutput(outputPath: string): Promise<void> {
  try {
    let content = await readFile(outputPath);
    let modified = false;

    // Normalize file:// URLs inside string literals to plain absolute paths
    if (content.includes("file://")) {
      content = content.replace(
        /(["'])file:\/\/\/([^"']+)\1/g,
        (_m, q, p) => `${q}/${p}${q}`,
      );
      modified = true;
      logger.debug("Normalized file:// URLs in bundle output");
    }

    // Add the runtime get function if it's used but not defined
    if (content.includes("get(") && !content.includes("function get(")) {
      content = RUNTIME_GET_SNIPPET + content;
      modified = true;
    }

    if (modified) {
      await writeTextFile(outputPath, content);
    }
  } catch (error) {
    logger.error(`Error post-processing bundle: ${formatErrorMessage(error)}`);
  }
}

// Utility functions
/**
 * Configure logger based on options
 */
function configureLogger(options: BundleOptions): void {
  if (options.verbose) {
    logger.setEnabled(true);
  }

  if (options.showTiming) {
    logger.setTimingOptions({ showTiming: true });
    logger.startTiming("transpile-cli", "Total");
  }
}

function getNamespaceForPath(filePath: string): "hql" | "file" {
  return isHqlFile(filePath) ? "hql" : "file";
}

/**
 * Create a resolve result with the appropriate namespace
 */
function createResolveResult(path: string): OnResolveResult {
  return {
    path,
    namespace: getNamespaceForPath(path),
  };
}

async function maybeRegisterTranspiledPath(hqlPath: string): Promise<void> {
  if (!isHqlFile(hqlPath)) return;

  const tsPath = hqlPath.replace(/\.hql$/, ".ts");
  if (await exists(tsPath)) {
    registerImportMapping(hqlPath, tsPath);
  }
}

function registerResolvedHqlMapping(
  requestedPath: string,
  resolvedPath: string,
): void {
  if (isHqlFile(requestedPath) && isHqlFile(resolvedPath)) {
    registerImportMapping(requestedPath, resolvedPath);
  }
}

/**
 * Extract HQL imports from source code
 */
function extractHqlImports(source: string): ImportInfo[] {
  const hqlImportRegex = /import\s+.*\s+from\s+['"]([^'"]+\.hql)['"]/g;
  const imports: ImportInfo[] = [];

  let match;
  while ((match = hqlImportRegex.exec(source)) !== null) {
    imports.push({ full: match[0], path: match[1] });
  }

  return imports;
}

/**
 * Resolve an import path across multiple search locations
 */
async function resolveImportPath(
  importPath: string,
  baseDir: string,
  options: { sourceDir?: string },
): Promise<string | null> {
  // Create prioritized array of lookup locations
  const projectRoot = cwd();
  const lookupLocations = [
    resolve(baseDir, importPath),
    ...(options.sourceDir ? [resolve(options.sourceDir, importPath)] : []),
    resolve(projectRoot, importPath),
    resolve(projectRoot, "lib", importPath.replace(/^\.\//, "")),
  ];

  // Try each location in order until we find the file
  for (const location of lookupLocations) {
    if (await exists(location)) {
      logger.debug(`Resolved import: ${importPath} → ${location}`);
      return location;
    }
  }

  logger.debug(`Failed to resolve import: ${importPath}`);
  return null;
}

/**
 * Resolve an HQL import for esbuild
 * Unified import resolution strategy for all file types
 */
async function resolveHqlImport(
  args: OnResolveArgs,
  options: UnifiedPluginOptions,
): Promise<OnResolveResult> {
  const externalPatterns = options.externalPatterns ||
    DEFAULT_EXTERNAL_PATTERNS;

  // Check if this is a remote URL that should be external
  if (externalPatterns.some((pattern) => args.path.startsWith(pattern))) {
    logger.debug(`External import: ${args.path}`);
    return { path: args.path, external: true };
  }

  // Check if it is an absolute path that exists (e.g. entry point from cache)
  if (isAbsolute(args.path) && await exists(args.path)) {
    logger.debug(`Resolved absolute path: ${args.path}`);
    return createResolveResult(args.path);
  }

  // Check import mapping cache
  const cachedMapping = getImportMapping(args.path);
  if (cachedMapping) {
    logger.debug(`Cached mapping: ${args.path} → ${cachedMapping}`);
    return createResolveResult(cachedMapping);
  }

  // Check resolved path mapping
  if (args.importer) {
    const importerDir = dirname(args.importer);
    const resolvedPath = args.path.startsWith(".")
      ? resolve(importerDir, args.path)
      : args.path;

    const mappedPath = getImportMapping(resolvedPath);
    if (mappedPath) {
      logger.debug(`Resolved mapping: ${args.path} → ${mappedPath}`);
      return createResolveResult(mappedPath);
    }
  }

  // Resolve relative to importer (most common case)
  if (args.importer) {
    const importerDir = dirname(args.importer);
    const relativePath = resolve(importerDir, args.path);

    if (await exists(relativePath)) {
      await maybeRegisterTranspiledPath(relativePath);

      logger.debug(
        `Resolved relative to importer: ${args.path} → ${relativePath}`,
      );
      return createResolveResult(relativePath);
    }
  }

  // Try other resolution strategies
  const resolvedPath = await resolveImportPath(
    args.path,
    args.importer ? dirname(args.importer) : cwd(),
    { sourceDir: options.sourceDir },
  );

  if (resolvedPath) {
    registerResolvedHqlMapping(args.path, resolvedPath);
    await maybeRegisterTranspiledPath(resolvedPath);
    return createResolveResult(resolvedPath);
  }

  // If we get here, we couldn't resolve the import
  logger.debug(
    `Unresolved import: ${args.path} from ${args.importer || "unknown"}`,
  );

  // Last resort - mark as external
  return { path: args.path, external: true };
}

/**
 * Transpile an HQL file to JavaScript
 */
export async function transpileHqlFile(
  hqlFilePath: string,
  sourceDir: string = "",
  verbose: boolean = false,
): Promise<string> {
  try {
    // Read the HQL file
    const hqlContent = await readTextFile(hqlFilePath);

    if (verbose) {
      logger.debug(`Transpiling HQL file: ${hqlFilePath}`);
    }

    // Set up options
    const options: TranspileOptions = {
      verbose,
      baseDir: dirname(hqlFilePath),
      currentFile: hqlFilePath,
    };

    if (sourceDir) {
      options.sourceDir = sourceDir;
    }

    // Pass source file explicitly to ensure accurate location
    const result = await transpile(hqlContent, options);

    return result.code;
  } catch (error) {
    throw wrapError(error, `Error transpiling HQL for JS import ${hqlFilePath}`);
  }
}

/**
 * Determine the appropriate output path based on input file type
 */
function determineOutputPath(
  resolvedInputPath: string,
  outputPath?: string,
): string {
  if (outputPath) return outputPath;

  // For HQL files, output as .js
  if (isHqlFile(resolvedInputPath)) {
    return resolvedInputPath.replace(/\.hql$/, ".js");
  }

  // For TypeScript files, output as .js
  if (isTypeScriptFile(resolvedInputPath)) {
    return resolvedInputPath.replace(/\.(ts|tsx)$/, ".js");
  }

  // For JS files, append .bundle.js
  return resolvedInputPath + ".bundle.js";
}

/**
 * Loads a transpiled file from the cache
 */
async function loadTranspiledFile(
  filePath: string,
): Promise<OnLoadResult> {
  try {
    logger.debug(`Loading transpiled file: ${filePath}`);

    const content = await readFile(filePath);
    const isTs = filePath.endsWith(".ts");

    return {
      contents: content,
      loader: isTs ? "ts" : "js",
      resolveDir: dirname(filePath),
    };
  } catch (error) {
    throw new TranspilerError(
      `Failed to load transpiled file: ${filePath}: ${
        formatErrorMessage(error)
      }`,
    );
  }
}

/**
 * Transpile HQL content to JavaScript from a path
 * Used by the prebundleHqlImportsInJs function
 */
export async function transpileHqlInJs(
  hqlPath: string,
  basePath: string,
): Promise<string> {
  try {
    // Read the HQL content
    const hqlContent = await readTextFile(hqlPath);

    // Transpile to JavaScript using the existing transpileToJavascript function
    const { code: jsContent } = await transpileToJavascript(hqlContent, {
      baseDir: dirname(hqlPath),
      sourceDir: basePath,
      currentFile: hqlPath,
      sourceContent: hqlContent,
    });

    // Sanitize identifiers with hyphens
    // PERFORMANCE: Use single-pass approach instead of nested replacements
    // Old approach: O(n×m) - for each identifier, scan entire file
    // New approach: O(m) - collect identifiers, then one replacement pass

    // Step 1: Collect all identifiers that need sanitization
    const identifiersToSanitize = new Map<string, string>(); // old -> new mapping

    // Find exported identifiers with hyphens
    const exportMatches = jsContent.matchAll(
      /export\s+(const|let|var|function)\s+([a-zA-Z0-9_-]+)/g,
    );
    for (const match of exportMatches) {
      const exportName = match[2];
      if (exportName.includes("-")) {
        identifiersToSanitize.set(exportName, sanitizeIdentifier(exportName));
      }
    }

    // Find namespace import identifiers with hyphens
    const importMatches = jsContent.matchAll(
      /import\s+\*\s+as\s+([a-zA-Z0-9_-]+)\s+from/g,
    );
    for (const match of importMatches) {
      const importName = match[1];
      if (importName.includes("-")) {
        identifiersToSanitize.set(importName, sanitizeIdentifier(importName));
      }
    }

    // Step 2: If we have identifiers to sanitize, do a single replacement pass
    let processedContent = jsContent;
    if (identifiersToSanitize.size > 0) {
      // Build a regex that matches any of the identifiers (longest first to avoid partial matches)
      const sortedIdentifiers = Array.from(identifiersToSanitize.keys())
        .sort((a, b) => b.length - a.length); // Longest first

      // Escape special regex characters in identifiers
      const escapedIdentifiers = sortedIdentifiers.map(id =>
        id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      );

      // Create pattern that matches identifiers as whole words or before dots (for namespaces)
      const identifierPattern = new RegExp(
        `\\b(${escapedIdentifiers.join('|')})(\\b|\\.)`,
        'g'
      );

      // Single pass replacement
      processedContent = processedContent.replace(
        identifierPattern,
        (match, identifier, suffix) => {
          const sanitized = identifiersToSanitize.get(identifier);
          return sanitized ? sanitized + suffix : match;
        }
      );
    }

    // Prepend runtime get snippet
    return RUNTIME_GET_SNIPPET + processedContent;
  } catch (error) {
    throw new Error(
      `Error transpiling HQL for JS import ${hqlPath}: ${getErrorMessage(error)}`,
    );
  }
}

/**
 * Check if adding this dependency would create a circular reference
 * PERFORMANCE: Uses memoization to avoid re-checking the same paths
 * Old approach: O(n×m²) - can re-traverse same paths multiple times
 * New approach: O(n×m) - each path checked once, results cached
 */
// LRU cache to prevent unbounded memory growth in long-running bundler processes
const circularCheckCache = new LRUCache<string, boolean>(10000);

function checkForCircularDependency(
  source: string,
  target: string,
  deps: Map<string, Set<string>>,
  visited: Set<string> = new Set(),
): boolean {
  // Check memoization cache first
  const cacheKey = `${source}|${target}`;
  const cachedResult = circularCheckCache.get(cacheKey);
  if (cachedResult !== undefined) {
    return cachedResult;
  }

  // If we've already checked this path in current traversal, avoid infinite recursion
  if (visited.has(source)) {
    return false;
  }

  // Check if target depends on source (circular)
  if (deps.has(target)) {
    const targetDeps = deps.get(target)!;
    if (targetDeps.has(source)) {
      circularCheckCache.set(cacheKey, true);
      return true;
    }

    // Check transitively
    visited.add(source);
    for (const dep of targetDeps) {
      if (checkForCircularDependency(source, dep, deps, visited)) {
        circularCheckCache.set(cacheKey, true);
        return true;
      }
    }
  }

  // Cache negative result
  circularCheckCache.set(cacheKey, false);
  return false;
}

// Helper functions
async function writeOutput(
  code: string,
  outputPath: string,
): Promise<void> {
  try {
    const outputDir = dirname(outputPath);
    await ensureDir(outputDir);
    await writeTextFile(outputPath, code);
    logger.debug(`Written output to disk: ${outputPath}`);

    // Write a cached copy for reuse, but don't let cache failures break the build
    const ext = extname(outputPath);
    try {
      const cachedPath = await writeToCachedPath(
        outputPath,
        code,
        ext,
        { preserveRelative: true },
      );

      logger.debug(`Written output to cache: ${cachedPath}`);

      if (await exists(cachedPath)) {
        const cachedHash = await getContentHash(cachedPath);
        const currentHash = await getContentHash(outputPath);
        if (cachedHash === currentHash) {
          logger.debug(
            `[CACHE HIT] No changes detected, reusing cached file: ${cachedPath}`,
          );
        } else {
          logger.debug(
            `[CACHE MISS] Source changed, regenerating cache for: ${outputPath}`,
          );
        }
      }
    } catch (cacheError) {
      logger.debug(
        `Skipping cache write for ${outputPath}: ${
          formatErrorMessage(cacheError)
        }`,
      );
    }
  } catch (error) {
    throw new TranspilerError(
      `Failed to write output to '${outputPath}': ${getErrorMessage(error)}`,
    );
  }
}
