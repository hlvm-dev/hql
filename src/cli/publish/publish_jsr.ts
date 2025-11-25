// publish_jsr.ts
import type { PublishSummary } from "./publish_summary.ts";
import { getJsrLatestVersion } from "./remote_registry.ts";
import { detectJsrError, ErrorType } from "./error_handlers.ts";
import { globalLogger as logger } from "../../logger.ts";
import { getEnv, join, runCmd } from "../../platform/platform.ts";
import {
  executeCommand,
  incrementPatchVersion,
  promptUser,
  readJSONFile,
  resolveNextPublishVersion,
  updateSourceMetadataFiles,
  writeJSONFile,
} from "./utils.ts";
import {
  deriveModuleBaseName,
  findMetadataSourcePath,
  mergeConfigWithDefaults,
  type PublishOptions,
  publishPackage,
  type RegistryPublisher,
} from "./publish_common.ts";

async function writeJsrMetadata(
  distDir: string,
  config: Record<string, unknown>,
): Promise<void> {
  await writeJSONFile(join(distDir, "jsr.json"), config);
  await writeJSONFile(join(distDir, "deno.json"), config);
}

const jsrPublisher: RegistryPublisher = {
  registryName: "jsr",

  async determinePackageInfo(distDir: string, options: PublishOptions) {
    let config: Record<string, unknown> = {};
    let packageName: string;
    let packageVersion: string;

    const metadataType = options.metadataType || "jsr.json";

    let createdMetadata = false;

    if (options.hasMetadata) {
      const metadataSourcePath = await findMetadataSourcePath(
        options.entryFile,
        distDir,
        metadataType,
      );

      const existingConfig = await readJSONFile(metadataSourcePath);
      packageName = String(existingConfig.name || "");

      // FIX: If existing metadata has no name, auto-generate it
      if (!packageName || packageName.trim() === "") {
        const defaultName = deriveModuleBaseName(options.entryFile);
        const jsrUser = getEnv("JSR_USER") || getEnv("USER") ||
          getEnv("USERNAME") || "user";
        packageName = `@${jsrUser}/${defaultName}`;
        console.log(
          `  → Auto-generated package name: ${packageName} (metadata missing name)`,
        );
      }

      if (options.version) {
        packageVersion = options.version;
        console.log(`  → Using specified version: ${packageVersion}`);
      } else {
        try {
          let latestVersion: string | null = null;

          if (packageName.startsWith("@")) {
            const [_, scope, name] = packageName.match(/^@([^/]+)\/(.+)$/) ||
              [];
            if (scope && name) {
              latestVersion = await getJsrLatestVersion(scope, name);
              if (latestVersion) {
                console.log(
                  `  → Found latest version on JSR: ${latestVersion}`,
                );
              }
            }
          }

          const candidateVersion = await resolveNextPublishVersion(
            latestVersion,
            existingConfig.version ? String(existingConfig.version) : null,
            promptUser,
            incrementPatchVersion,
            "JSR",
          );
          packageVersion = candidateVersion;
          console.log(`  → Using next available version: ${packageVersion}`);
        } catch (_error) {
          packageVersion = existingConfig.version
            ? String(existingConfig.version)
            : "0.0.1";
          console.log(
            `  → Error fetching remote version, using: ${packageVersion}`,
          );
        }
      }

      config = mergeConfigWithDefaults(
        existingConfig,
        packageName,
        packageVersion,
        true,
      );
    } else {
      const defaultName = deriveModuleBaseName(options.entryFile);

      const jsrUser = getEnv("JSR_USER") || getEnv("USER") ||
        getEnv("USERNAME") || "user";

      if (options.dryRun) {
        packageName = `@${jsrUser}/${defaultName}`;
        console.log(
          `  → Using auto-generated package name: ${packageName} (dry-run)`,
        );
      } else {
        const moduleName = await promptUser(
          `Enter a project name for your JSR package`,
          defaultName,
        );
        packageName = `@${jsrUser}/${moduleName}`;
      }

      const defaultVersion = options.version || "0.0.1";
      if (options.version) {
        packageVersion = options.version;
        console.log(`  → Using specified version: ${packageVersion}`);
      } else if (options.dryRun) {
        packageVersion = defaultVersion;
        console.log(`  → Using default version: ${packageVersion} (dry-run)`);
      } else {
        packageVersion = await promptUser(`Enter version`, defaultVersion);
      }

      config = mergeConfigWithDefaults({}, packageName, packageVersion, true);
      createdMetadata = true;
    }

    await writeJsrMetadata(distDir, config);
    if (createdMetadata) {
      console.log(`  → Created new JSR metadata files (jsr.json, deno.json)`);
    }
    logger.debug &&
      logger.debug(
        `Updated jsr.json and deno.json with version: ${packageVersion}`,
      );
    return { packageName, packageVersion, config };
  },

  async updateMetadata(distDir, packageVersion, config) {
    config.version = packageVersion;

    await writeJsrMetadata(distDir, config);
    console.log(
      `  → Updated dist/jsr.json and dist/deno.json with version ${packageVersion}`,
    );

    await updateSourceMetadataFiles(
      distDir,
      ["jsr.json", "deno.json"],
      packageVersion,
    );
  },

  async runPublish(
    distDir,
    options: { dryRun?: boolean; verbose?: boolean; allowDirty?: boolean },
  ) {
    const publishFlags: string[] = [];

    if (options.dryRun) {
      publishFlags.push("--dry-run");
    }

    if (options.verbose) {
      publishFlags.push("--verbose");
    }

    if (options.allowDirty) {
      publishFlags.push("--allow-dirty");
    }

    const jsrAvailable = await checkCommandAvailable("jsr", distDir);
    if (jsrAvailable) {
      return executeCommand({
        cmd: ["jsr", "publish"],
        cwd: distDir,
        extraFlags: publishFlags,
      });
    }

    const denoAvailable = await checkCommandAvailable("deno", distDir);
    if (denoAvailable) {
      return executeCommand({
        cmd: ["deno", "publish"],
        cwd: distDir,
        extraFlags: publishFlags,
      });
    }

    const userInput = await promptUser(
      "Neither jsr nor deno CLI found. Would you like to install jsr now? (y/n)",
      "y",
    );
    if (userInput.trim().toLowerCase().startsWith("y")) {
      const installResult = await executeCommand({
        cmd: ["deno", "install", "-A", "-n", "jsr", "jsr@0.4.4"],
        cwd: distDir,
      });
      if (!installResult.success) {
        return {
          success: false,
          error: `Failed to install jsr CLI: ${installResult.error}`,
        };
      }
      return executeCommand({
        cmd: ["jsr", "publish"],
        cwd: distDir,
        extraFlags: publishFlags,
      });
    } else {
      return {
        success: false,
        error:
          "JSR CLI not available. Please install it with: deno install -A jsr@0.4.4",
      };
    }
  },

  analyzeError(errorOutput) {
    if (
      errorOutput.includes("Aborting due to uncommitted changes") ||
      errorOutput.includes("run with --allow-dirty")
    ) {
      return {
        type: ErrorType.UNKNOWN,
        message:
          "Publish aborted: You have uncommitted changes. Please commit your changes or run with --allow-dirty.",
      };
    }
    return detectJsrError(errorOutput);
  },

  generateLink(name, version) {
    if (!name.startsWith("@")) {
      return `https://jsr.io/p/${name}@${version}`;
    }

    const [_, scope, pkgName] = name.match(/^@([^/]+)\/(.+)$/) || [];
    if (!scope || !pkgName) {
      return `https://jsr.io`;
    }

    return `https://jsr.io/@${scope}/${pkgName}@${version}`;
  },
};

async function checkCommandAvailable(
  cmd: string,
  cwd: string,
): Promise<boolean> {
  try {
    const process = runCmd({
      cmd: ["which", cmd],
      cwd,
      stdout: "piped",
      stderr: "piped",
    });
    const status = await process.status;
    return status.success;
  } catch {
    return false;
  }
}

export function publishJSR(
  options: PublishJSROptions,
): Promise<PublishSummary> {
  return publishPackage(options, jsrPublisher);
}
