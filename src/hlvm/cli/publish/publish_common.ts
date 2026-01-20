// publish_common.ts
import type { PublishSummary, RegistryType } from "./publish_summary.ts";
import { confirmAllowDirtyPublish } from "./dirty_publish_prompt.ts";
import { ErrorType } from "./error_handlers.ts";
import { getPlatform } from "../../../platform/platform.ts";

// SSOT: Use platform layer for all file/path operations
const p = () => getPlatform();
const basename = (path: string) => p().path.basename(path);
const dirname = (path: string) => p().path.dirname(path);
const exists = (path: string) => p().fs.exists(path);
const getEnv = (key: string) => p().env.get(key);
const join = (...paths: string[]) => p().path.join(...paths);
import {
  ensureReadme,
  getCachedBuild,
  incrementPatchVersion,
  type MetadataFileType,
  promptUser,
  readJSONFile,
  visualizeTree,
  type HlvmProjectConfig,
} from "./utils.ts";
import { getErrorMessage } from "../../../common/utils.ts";
import { log } from "../../api/log.ts";

// Common interfaces for publishing options - Single Source of Truth
export interface PublishOptions {
  entryFile: string;
  platforms?: ("jsr" | "npm")[]; // Optional - only used by CLI entry point
  version?: string;
  hasMetadata?: boolean;
  metadataType?: MetadataFileType;
  verbose?: boolean;
  dryRun?: boolean;
  allowDirty?: boolean;
}

export interface PublishContext {
  distDir: string;
  packageName: string;
  config: HlvmProjectConfig; // Changed to HlvmProjectConfig
  metadataType?: MetadataFileType;
  dryRun?: boolean;
  verbose?: boolean;
}

// Interface representing a registry-specific publishing system
export interface RegistryPublisher {
  registryName: RegistryType;
  determinePackageInfo: (
    distDir: string,
    options: PublishOptions,
    config: HlvmProjectConfig, // Added config
  ) => Promise<{
    packageName: string;
    packageVersion: string;
    config: HlvmProjectConfig; // Changed to HlvmProjectConfig
  }>;
  updateMetadata: (
    distDir: string,
    version: string,
    config: HlvmProjectConfig, // Changed to HlvmProjectConfig
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
): HlvmProjectConfig { // Changed return type
  // Common properties
  const config: HlvmProjectConfig = { // Changed type
    name: packageName,
    version: packageVersion,
    exports: isJsr ? "./esm/index.js" : "./mod.hql", // Default export
    description: `HLVM module: ${packageName}`,
    license: "MIT",
  };

  if (isJsr) {
    // JSR-specific defaults
    config.publish = {
      include: ["README.md", "esm/**/*", "types/**/*", "jsr.json"],
    };
  } else {
    // NPM-specific defaults
    config.main = "./esm/index.js";
    config.types = "./types/index.d.ts";
    config.files = ["esm", "types", "README.md"];
    config.type = "module";
    config.author = getEnv("USER") || getEnv("USERNAME") || "HLVM User";
  }

  return config;
}

export function mergeConfigWithDefaults(
  existingConfig: HlvmProjectConfig, // Changed type
  packageName: string,
  packageVersion: string,
  isJsr: boolean,
): HlvmProjectConfig { // Changed return type
  return {
    ...createDefaultConfig(packageName, packageVersion, isJsr),
    ...(existingConfig as Record<string, unknown>), // Cast here for spread
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

  log.raw.log(
    `\n🚀 Publishing ${packageName}@${currentVersion} to ${publisher.registryName}...`,
  );

  // NPM requires metadata update before publishing
  await publisher.updateMetadata(distDir, currentVersion, config);

  // Visualize the files to be published
  const highlightFiles = ["esm/index.js", "types/index.d.ts"];
  const tree = await visualizeTree(distDir, highlightFiles);
  log.raw.log(tree);

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
    log.raw.log(
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

  log.raw.error(
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
  config: HlvmProjectConfig, // Added config
  options: PublishOptions,
  publisher: RegistryPublisher,
): Promise<PublishSummary> {
  try {
    log.raw.log(`\n🔨 Building module from "${options.entryFile}"...`);
    const distDir = await getCachedBuild(options.entryFile, {
      verbose: options.verbose,
      dryRun: options.dryRun,
    });
    log.raw.log(`  → Module built successfully to: ${distDir}`);

    log.raw.log(
      `\n📝 Configuring ${publisher.registryName.toUpperCase()} package...`,
    );
    const { packageName, packageVersion, config: newConfig } = await publisher
      .determinePackageInfo(distDir, options, config); // Pass config

    await ensureReadme(distDir, newConfig);

    if (options.dryRun) {
      log.raw.log(
        `\n🔍 Dry run mode - package ${packageName}@${packageVersion} would be published to ${publisher.registryName.toUpperCase()}`,
      );

      await publisher.updateMetadata(distDir, packageVersion, newConfig);

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
      config: newConfig, // Use newConfig
      metadataType: options.metadataType,
      dryRun: options.dryRun,
      verbose: options.verbose,
    };

    // Start the publish process with initial version
    return await attemptPublish(context, packageVersion, 0, publisher);
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    log.raw.error(
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
