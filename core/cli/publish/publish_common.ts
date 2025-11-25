// publish_common.ts
import { exists } from "jsr:@std/fs@1.0.13";
import type { PublishSummary, RegistryType } from "./publish_summary.ts";
import { confirmAllowDirtyPublish } from "./dirty_publish_prompt.ts";
import { ErrorType } from "./error_handlers.ts";
import {
  basename,
  dirname,
  getEnv,
  join,
} from "../../src/platform/platform.ts";
import {
  ensureReadmeExists,
  getCachedBuild,
  incrementPatchVersion,
  type MetadataFileType,
  promptUser,
  readJSONFile,
  visualizeTree,
} from "./utils.ts";

// Common interfaces for publishing options
export interface PublishOptions {
  entryFile: string;
  version?: string;
  hasMetadata: boolean;
  metadataType?: MetadataFileType;
  verbose?: boolean;
  dryRun?: boolean;
}

export interface PublishContext {
  distDir: string;
  packageName: string;
  config: Record<string, unknown>;
  metadataType?: MetadataFileType;
  dryRun?: boolean;
  verbose?: boolean;
}

// Interface representing a registry-specific publishing system
export interface RegistryPublisher {
  registryName: RegistryType;
  determinePackageInfo: (distDir: string, options: PublishOptions) => Promise<{
    packageName: string;
    packageVersion: string;
    config: Record<string, unknown>;
  }>;
  updateMetadata: (
    distDir: string,
    version: string,
    config: Record<string, unknown>,
  ) => Promise<void>;
  runPublish: (
    distDir: string,
    options: { dryRun?: boolean; verbose?: boolean; allowDirty?: boolean },
  ) => Promise<{
    success: boolean;
    error?: string;
  }>;
  analyzeError: (errorOutput: string) => { type: ErrorType; message: string };
  generateLink: (name: string, version: string) => string;
}

/**
 * Resolve the preferred metadata file path by checking common locations.
 */
export async function findMetadataSourcePath(
  entryFile: string,
  distDir: string,
  filename: string,
): Promise<string> {
  const sourceDir = dirname(entryFile);
  const directPath = join(sourceDir, filename);
  if (await exists(directPath)) {
    return directPath;
  }

  const nestedDistPath = join(sourceDir, "dist", filename);
  if (await exists(nestedDistPath)) {
    return nestedDistPath;
  }

  return join(distDir, filename);
}

/**
 * Produces a normalized module name based on the entry file location.
 */
export function sanitizeModuleName(
  rawName: string,
  fallback = "module",
): string {
  const sanitized = rawName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return sanitized || fallback;
}

export function deriveModuleBaseName(entryFile: string): string {
  const moduleDir = dirname(entryFile);
  const rawName = basename(moduleDir);

  return sanitizeModuleName(rawName);
}

/**
 * Creates a skeleton configuration object with default values
 */
export function createDefaultConfig(
  packageName: string,
  packageVersion: string,
  isJsr: boolean,
): Record<string, unknown> {
  // Common properties
  const config: Record<string, unknown> = {
    name: packageName,
    version: packageVersion,
    description: `HQL module: ${packageName}`,
    license: "MIT",
  };

  if (isJsr) {
    // JSR-specific defaults
    config.exports = "./esm/index.js";
    config.publish = {
      include: ["README.md", "esm/**/*", "types/**/*", "jsr.json"],
    };
  } else {
    // NPM-specific defaults
    config.module = "./esm/index.js";
    config.main = "./esm/index.js";
    config.types = "./types/index.d.ts";
    config.files = ["esm", "types", "README.md"];
    config.type = "module";
    config.author = getEnv("USER") || getEnv("USERNAME") || "HQL User";
  }

  return config;
}

export function mergeConfigWithDefaults(
  existingConfig: Record<string, unknown>,
  packageName: string,
  packageVersion: string,
  isJsr: boolean,
): Record<string, unknown> {
  return {
    ...createDefaultConfig(packageName, packageVersion, isJsr),
    ...existingConfig,
    name: packageName,
    version: packageVersion,
  };
}

/**
 * Attempts to publish a package to a registry with retry capability
 */
export async function attemptPublish(
  context: PublishContext,
  currentVersion: string,
  attempt: number,
  publisher: RegistryPublisher,
): Promise<PublishSummary> {
  const maxRetries = 3;
  const { distDir, packageName, config, dryRun, verbose, metadataType } =
    context;

  console.log(
    `\n🚀 Publishing ${packageName}@${currentVersion} to ${publisher.registryName}...`,
  );

  if (publisher.registryName === "npm") {
    // NPM requires metadata update before publishing
    await publisher.updateMetadata(distDir, currentVersion, config);
  }

  // Visualize the files to be published
  const highlightFiles = ["esm/index.js", "types/index.d.ts"];
  const tree = await visualizeTree(distDir, highlightFiles);
  console.log(tree);

  let publishResult = await publisher.runPublish(distDir, { dryRun, verbose });

  // If uncommitted changes error, prompt for --allow-dirty and retry if confirmed
  if (
    publishResult.error &&
    typeof publishResult.error === "string" &&
    publishResult.error.includes("uncommitted changes")
  ) {
    const details =
      publishResult.error.match(/Uncommitted changes: ([^\n]+)/)?.[1] || "";
    const allowDirty = await confirmAllowDirtyPublish(details);
    if (allowDirty) {
      // Try again with --allow-dirty (do not show tree again)
      publishResult = await publisher.runPublish(distDir, {
        dryRun,
        verbose,
        allowDirty: true,
      });
    }
  }

  if (publishResult.success) {
    console.log(
      `\n✅ Successfully published ${packageName}@${currentVersion} to ${publisher.registryName}`,
    );
    await publisher.updateMetadata(distDir, currentVersion, config);
    return {
      registry: publisher.registryName,
      name: packageName,
      version: currentVersion,
      link: publisher.generateLink(packageName, currentVersion),
    };
  }

  const errorOutput = publishResult.error || "Unknown error";
  const errorAnalysis = publisher.analyzeError(errorOutput);

  if (
    errorAnalysis.type === ErrorType.VERSION_CONFLICT && attempt < maxRetries
  ) {
    let localVersion = currentVersion;

    // The path to metadata file depends on the registry type
    const metaPath = join(
      distDir,
      publisher.registryName === "npm"
        ? "package.json"
        : (metadataType || "deno.json"),
    );

    const metaJson = await readJSONFile(metaPath);
    if (metaJson && typeof metaJson.version === "string") {
      localVersion = metaJson.version;
    }

    const suggested = incrementPatchVersion(localVersion);
    const userInput = await promptUser(
      `${publisher.registryName.toUpperCase()} publish failed: Version ${currentVersion} already exists. Enter a new version to try`,
      suggested,
    );

    // Recursive call with incremented attempt counter
    return attemptPublish(context, userInput, attempt + 1, publisher);
  }

  console.error(
    `\n❌ ${publisher.registryName.toUpperCase()} publish failed: ${errorAnalysis.message}`,
  );
  return {
    registry: publisher.registryName,
    name: packageName,
    version: currentVersion,
    link: `❌ ${errorAnalysis.message}`,
  };
}

/**
 * Generic publish function that orchestrates the whole publishing process
 */
export async function publishPackage(
  options: PublishOptions,
  publisher: RegistryPublisher,
): Promise<PublishSummary> {
  try {
    console.log(`\n🔨 Building module from "${options.entryFile}"...`);
    const distDir = await getCachedBuild(options.entryFile, {
      verbose: options.verbose,
      dryRun: options.dryRun,
    });
    console.log(`  → Module built successfully to: ${distDir}`);

    console.log(
      `\n📝 Configuring ${publisher.registryName.toUpperCase()} package...`,
    );
    const { packageName, packageVersion, config } = await publisher
      .determinePackageInfo(distDir, options);

    await ensureReadmeExists(distDir, packageName);

    if (options.dryRun) {
      console.log(
        `\n🔍 Dry run mode - package ${packageName}@${packageVersion} would be published to ${publisher.registryName.toUpperCase()}`,
      );

      await publisher.updateMetadata(distDir, packageVersion, config);

      return {
        registry: publisher.registryName,
        name: packageName,
        version: packageVersion,
        link: publisher.generateLink(packageName, packageVersion),
      };
    }

    const context: PublishContext = {
      distDir,
      packageName,
      config,
      metadataType: options.metadataType,
      dryRun: options.dryRun,
      verbose: options.verbose,
    };

    // Start the publish process with initial version
    return await attemptPublish(context, packageVersion, 0, publisher);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `\n❌ ${publisher.registryName.toUpperCase()} publish failed: ${errorMessage}`,
    );
    return {
      registry: publisher.registryName,
      name: options.hasMetadata ? "(from metadata)" : "(unknown)",
      version: options.version || "(auto)",
      link: `❌ ${errorMessage}`,
    };
  }
}
