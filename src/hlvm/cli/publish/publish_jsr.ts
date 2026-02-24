import { RuntimeError } from "../../../common/error.ts";
import {
  exists,
  join,
  platformCwd,
  writeTextFile as platformWriteTextFile,
} from "../utils/platform-helpers.ts";
import { globalLogger as logger } from "../../../logger.ts";
import { log } from "../../api/log.ts";
import { getErrorMessage } from "../../../common/utils.ts";
import {
  detectMetadataFiles,
  executeCommand,
  generatePackageMetadata,
  readJSONFile,
  type HqlPackageConfig,
} from "./utils.ts";
import type { PublishOptions } from "./publish_common.ts";
import type { PublishSummary } from "./publish_summary.ts";

/**
 * Publishes a package to JSR
 */
export async function publishJSR(
  config: HqlPackageConfig, // Accept config
  options: PublishOptions, // Accept options
): Promise<PublishSummary> {
  logger.debug &&
    logger.debug(`Publishing to JSR with config: ${JSON.stringify(config)}`);

  let name = config.name;
  let version = config.version;
  let link = `(unknown)`;

  try {
    // 1. Detect/validate deno.json
    const { jsr: jsrMeta } = await detectMetadataFiles(platformCwd());
    let denoJsonPath: string;

    if (jsrMeta) {
      denoJsonPath = join(platformCwd(), jsrMeta);
      logger.debug && logger.debug(`Using existing metadata file: ${jsrMeta}`);
      // Read name and version from actual deno.json if it exists
      const existingDenoJson = (await readJSONFile(denoJsonPath)) as HqlPackageConfig;
      name = existingDenoJson.name || config.name;
      version = existingDenoJson.version || config.version;
    } else {
      // Generate temporary deno.json for publishing
      const { jsr } = await generatePackageMetadata(config, platformCwd());
      if (!jsr) {
        throw new RuntimeError("Failed to generate JSR metadata");
      }
      denoJsonPath = jsr.path;
      await platformWriteTextFile(denoJsonPath, jsr.content);
      logger.debug && logger.debug(`Generated temporary metadata at ${denoJsonPath}`);
    }

    // 2. Build JS module (not explicitly done here, assumed part of setup or handled by deno publish)
    const entryFile = config.exports || "./mod.hql";
    if (!(await exists(entryFile))) {
      throw new RuntimeError(`Entry file not found: ${entryFile}`);
    }

    // 3. Run deno publish
    const publishCmd = ["deno", "publish"];
    
    if (options.dryRun) {
      publishCmd.push("--dry-run");
    }
    
    if (options.allowDirty) {
      publishCmd.push("--allow-dirty");
    }

    log.raw.log(`\n🚀 Publishing to JSR...`);
    
    const result = await executeCommand({
      cmd: publishCmd,
      cwd: platformCwd(),
      dryRun: options.dryRun,
      verbose: options.verbose !== false,
    });

    if (!result.success) {
      throw new RuntimeError(`JSR publish failed: ${result.error}`);
    }

    // Generate link (placeholder for now)
    link = `https://jsr.io/${name}@${version}`;
    log.raw.log(`\n✅ JSR publish completed successfully!`);

    return {
      registry: "jsr",
      name,
      version,
      link,
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    return {
      registry: "jsr",
      name,
      version,
      link: `❌ ${errorMessage}`,
    };
  }
}