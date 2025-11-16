// publish_npm.ts
import type { PublishSummary } from "./publish_summary.ts";
import { getNpmLatestVersion } from "./remote_registry.ts";
import { detectNpmError } from "./error_handlers.ts";
import { globalLogger as logger } from "../../src/logger.ts";
import { join } from "../../src/platform/platform.ts";
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
  PublishOptions,
  publishPackage,
  RegistryPublisher,
} from "./publish_common.ts";

const npmPublisher: RegistryPublisher = {
  registryName: "npm",

  async determinePackageInfo(distDir: string, options: PublishOptions) {
    let config: Record<string, unknown> = {};
    let packageName: string;
    let packageVersion: string;

    if (options.hasMetadata) {
      const metadataSourcePath = await findMetadataSourcePath(
        options.entryFile,
        distDir,
        "package.json",
      );

      const existingConfig = await readJSONFile(metadataSourcePath);
      logger.debug &&
        logger.debug(`Loaded metadata from: ${metadataSourcePath}`);

      packageName = String(existingConfig.name || "");

      if (options.version) {
        packageVersion = options.version;
        console.log(`  → Using specified version: ${packageVersion}`);
      } else {
        let latestVersion: string | null = null;
        const localVersion: string | null = existingConfig.version
          ? String(existingConfig.version)
          : null;

        try {
          latestVersion = await getNpmLatestVersion(packageName);
        } catch (_error) {
          latestVersion = null;
        }

        const candidateVersion = await resolveNextPublishVersion(
          latestVersion,
          localVersion,
          promptUser,
          incrementPatchVersion,
          "NPM",
        );
        packageVersion = candidateVersion;
        if (latestVersion) {
          console.log(`  → Found latest version on NPM: ${latestVersion}`);
        }
        if (localVersion) {
          console.log(`  → Local package.json version: ${localVersion}`);
        }
        console.log(`  → Using next available version: ${packageVersion}`);
      }

      config = mergeConfigWithDefaults(
        existingConfig,
        packageName,
        packageVersion,
        false,
      );
    } else {
      const defaultName = deriveModuleBaseName(options.entryFile);

      if (options.dryRun) {
        packageName = defaultName;
        console.log(
          `  → Using auto-generated package name: ${packageName} (dry-run)`,
        );
      } else {
        packageName = await promptUser(
          `Enter a name for your NPM package`,
          defaultName,
        );
      }

      const defaultVersion = options.version || "0.0.1";
      if (options.dryRun) {
        packageVersion = defaultVersion;
        console.log(`  → Using default version: ${packageVersion} (dry-run)`);
      } else {
        packageVersion = await promptUser(`Enter version`, defaultVersion);
      }

      config = mergeConfigWithDefaults({}, packageName, packageVersion, false);
      console.log(
        `  → Will create new package.json file after successful publish`,
      );
    }
    return { packageName, packageVersion, config };
  },

  async updateMetadata(distDir, packageVersion, config) {
    config.version = packageVersion;

    const packageJsonPath = join(distDir, "package.json");
    await writeJSONFile(packageJsonPath, config);
    console.log(
      `  → Updated dist/package.json file with version ${packageVersion}`,
    );

    await updateSourceMetadataFiles(distDir, ["package.json"], packageVersion);
  },

  async runPublish(
    distDir,
    options: { dryRun?: boolean; verbose?: boolean; allowDirty?: boolean },
  ) {
    if (options.dryRun) {
      console.log(`  → Skipping actual npm publish in dry-run mode`);
      return { success: true };
    }

    const extraFlags = ["--access", "public"];
    if (options.allowDirty) {
      extraFlags.push("--allow-dirty");
    }

    const baseCmd = ["npm", "publish"];
    console.log(`  → Running: ${[...baseCmd, ...extraFlags].join(" ")}`);

    return await executeCommand({
      cmd: baseCmd,
      cwd: distDir,
      extraFlags,
    });
  },

  analyzeError(errorOutput) {
    return detectNpmError(errorOutput);
  },

  generateLink(name: string, version?: string) {
    if (version) {
      return `https://www.npmjs.com/package/${name}/v/${version}`;
    }
    return `https://www.npmjs.com/package/${name}`;
  },
};

// Main export function for NPM publishing
export function publishNpm(options: PublishOptions): Promise<PublishSummary> {
  return publishPackage(options, npmPublisher);
}
