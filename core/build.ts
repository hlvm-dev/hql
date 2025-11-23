#!/usr/bin/env -S deno run -A

/**
 * HQL Build Tool
 *
 * Supports building for multiple publish targets (JSR, NPM) with a single command.
 * Usage mirrors doc/specs/hql_build_all.md:
 *   deno run --allow-all core/build.ts --all
 *   deno run --allow-all core/build.ts all --output ./dist --version 1.2.3
 */

import {
  basename,
  copyFile,
  dirname,
  ensureDir,
  exists,
  exit as platformExit,
  getArgs,
  join,
  readDir,
  remove,
  resolve,
  stat as platformStat,
} from "./src/platform/platform.ts";
import {
  getCachedBuild,
  getPlatformsFromArgs,
  type MetadataFileType,
  readJSONFile,
  writeJSONFile,
} from "./cli/publish/utils.ts";
import {
  createDefaultConfig,
  sanitizeModuleName,
} from "./cli/publish/publish_common.ts";
import { getEnv } from "./src/platform/platform.ts";

type PlatformTarget = "jsr" | "npm";

interface CLIOptions {
  entryFile: string;
  outputDir?: string;
  version?: string;
  verbose?: boolean;
}

const PLATFORM_TOKENS = new Set([
  "all",
  "-all",
  "--all",
  "-a",
  "jsr",
  "-jsr",
  "--jsr",
  "npm",
  "-npm",
  "--npm",
]);

async function copyRecursive(source: string, target: string): Promise<void> {
  const info = await platformStat(source);

  if (info.isDirectory) {
    await ensureDir(target);
    for await (const entry of readDir(source)) {
      await copyRecursive(join(source, entry.name), join(target, entry.name));
    }
    return;
  }

  if (info.isFile) {
    await ensureDir(dirname(target));
    await copyFile(source, target);
  }
}

function printUsage(): void {
  console.log(`HQL Build Tool

Usage:
  deno run -A core/build.ts [options] [entry]

Options:
  --all, -all, all     Build all supported targets (JSR and NPM)
  --jsr                Build only the JSR package
  --npm                Build only the NPM package
  --entry, -e <file>   Entry file to build (default: ./mod.ts)
  --output, -o <dir>   Optional directory to copy build artifacts into
  --version, -v <semver>  Override package version metadata
  --verbose            Enable verbose logging
  --help, -h           Show this message

Examples:
  deno run -A core/build.ts --all
  deno run -A core/build.ts all --output ./dist --version 1.2.3
`);
}

function parseArgs(
  args: string[],
): { options: CLIOptions; positional: string[] } {
  let entryFile = "./mod.ts";
  let outputDir: string | undefined;
  let version: string | undefined;
  let verbose = false;

  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (PLATFORM_TOKENS.has(arg)) {
      // handled separately via getPlatformsFromArgs
      continue;
    }

    switch (arg) {
      case "--entry":
      case "-e":
        entryFile = args[++i] ?? entryFile;
        break;
      case "--output":
      case "-o":
        outputDir = args[++i];
        break;
      case "--version":
      case "-v":
        version = args[++i];
        break;
      case "--verbose":
        verbose = true;
        break;
      case "--help":
      case "-h":
        printUsage();
        platformExit(0);
        break;
      default:
        positional.push(arg);
    }
  }

  if (positional.length > 0) {
    // treat the first positional argument (if not 'all' etc.) as entry file
    const candidate = positional[0];
    if (!PLATFORM_TOKENS.has(candidate)) {
      entryFile = candidate;
    }
  }

  return {
    options: { entryFile, outputDir, version, verbose },
    positional,
  };
}

async function detectMetadata(
  baseDir: string,
  platform: PlatformTarget,
): Promise<{ hasMetadata: boolean; metadataType?: MetadataFileType }> {
  if (platform === "jsr") {
    if (await exists(join(baseDir, "jsr.json"))) {
      return { hasMetadata: true, metadataType: "jsr.json" };
    }
    if (await exists(join(baseDir, "deno.json"))) {
      return { hasMetadata: true, metadataType: "deno.json" };
    }
    return { hasMetadata: false, metadataType: "jsr.json" };
  }

  if (await exists(join(baseDir, "package.json"))) {
    return { hasMetadata: true, metadataType: "package.json" };
  }
  return { hasMetadata: false, metadataType: "package.json" };
}

async function copyArtifacts(
  distDir: string,
  targetDir: string,
): Promise<void> {
  const resolvedTarget = resolve(targetDir);
  const resolvedSource = resolve(distDir);

  if (resolvedTarget === resolvedSource) {
    console.log(`📦 Build artifacts already located at ${resolvedTarget}`);
    return;
  }

  if (await exists(resolvedTarget)) {
    await remove(resolvedTarget, { recursive: true });
  }

  await copyRecursive(resolvedSource, resolvedTarget);
  console.log(`📦 Copied build artifacts to ${resolvedTarget}`);
}

function deriveDefaultJsrName(baseDir: string): string {
  const dirName = sanitizeModuleName(basename(baseDir), "hql-module");
  const user = getEnv("JSR_USER") ||
    getEnv("USER") ||
    getEnv("USERNAME") ||
    "hql-user";
  return `@${user}/${dirName}`;
}

function deriveDefaultNpmName(baseDir: string): string {
  return sanitizeModuleName(basename(baseDir), "hql-module");
}

async function readMetadata(
  baseDir: string,
  filename?: MetadataFileType,
): Promise<Record<string, unknown> | null> {
  if (!filename) return null;
  const path = join(baseDir, filename);
  if (!(await exists(path))) return null;
  return await readJSONFile(path);
}

async function prepareMetadataForPlatform(
  platform: PlatformTarget,
  context: {
    baseDir: string;
    distDir: string;
    version?: string;
    verbose?: boolean;
  },
): Promise<void> {
  const { baseDir, distDir, version } = context;
  const metadataInfo = await detectMetadata(baseDir, platform);
  const existing = await readMetadata(baseDir, metadataInfo.metadataType);

  if (platform === "jsr") {
    const defaultName = deriveDefaultJsrName(baseDir);
    const currentName = String(existing?.name ?? defaultName);
    const currentVersion = version ??
      String(existing?.version ?? "0.0.1");

    const defaults = createDefaultConfig(currentName, currentVersion, true);
    const config = {
      ...defaults,
      ...existing,
      name: currentName,
      version: currentVersion,
    };

    await writeJSONFile(join(distDir, "jsr.json"), config);
    await writeJSONFile(join(distDir, "deno.json"), config);
    if (context.verbose) {
      console.log(
        `  → JSR metadata written to ${join(distDir, "jsr.json")}`,
      );
    }
    return;
  }

  // npm
  const defaultName = deriveDefaultNpmName(baseDir);
  const currentName = String(existing?.name ?? defaultName);
  const currentVersion = version ?? String(existing?.version ?? "0.0.1");

  const defaults = createDefaultConfig(currentName, currentVersion, false);
  const config = {
    ...defaults,
    ...existing,
    name: currentName,
    version: currentVersion,
  };

  // Check if build generated external dependencies info
  const externalsFile = join(distDir, ".hql-build-externals.json");
  if (await exists(externalsFile)) {
    try {
      const externalsData = await readJSONFile(externalsFile);
      if (externalsData && Array.isArray(externalsData.externals)) {
        // Add external dependencies to package.json
        const packageVersions: Record<string, string> = {
          "source-map": "^0.6.1",
          "esbuild": "^0.17.0",
        };

        config.dependencies = config.dependencies || {};
        for (const pkg of externalsData.externals) {
          const version = packageVersions[pkg] || "latest";
          config.dependencies[pkg] = version;
        }

        if (context.verbose) {
          console.log(
            `  → Added ${externalsData.externals.length} external dependencies`,
          );
        }
      }

      // Clean up the externals file
      await remove(externalsFile);
    } catch (error) {
      console.warn(
        `\n⚠️ Failed to process externals: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  await writeJSONFile(join(distDir, "package.json"), config);
  if (context.verbose) {
    console.log(
      `  → NPM metadata written to ${join(distDir, "package.json")}`,
    );
  }
}

async function main() {
  const rawArgs = [...getArgs()];
  const { options, positional: _positional } = parseArgs(rawArgs);

  const platforms = getPlatformsFromArgs(rawArgs) as PlatformTarget[];
  if (platforms.length === 0) {
    console.error(
      "❌ No platforms specified. Use --all, --jsr, --npm or see --help.",
    );
    platformExit(1);
  }

  const entryPath = resolve(options.entryFile);
  if (!(await exists(entryPath))) {
    console.error(`❌ Entry file not found: ${entryPath}`);
    platformExit(1);
  }

  const entryStat = await platformStat(entryPath);
  if (!entryStat.isFile) {
    console.error(`❌ Entry path must be a file: ${entryPath}`);
    platformExit(1);
  }

  const baseDir = dirname(entryPath);

  console.log(`🔧 Building HQL module from ${entryPath}`);
  const distDir = await getCachedBuild(entryPath, { verbose: options.verbose });
  console.log(`📁 Build output directory: ${distDir}`);

  for (const platform of platforms) {
    await prepareMetadataForPlatform(platform, {
      baseDir,
      distDir,
      version: options.version,
      verbose: options.verbose,
    });
    console.log(
      `✅ Prepared ${platform.toUpperCase()} metadata in ${distDir}`,
    );
  }

  if (options.outputDir) {
    await copyArtifacts(distDir, options.outputDir);
  }

  console.log(
    `\n🎉 Build complete for ${
      platforms.map((p) => p.toUpperCase()).join(", ")
    }`,
  );
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(
      `\n❌ Build failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    platformExit(1);
  });
}
