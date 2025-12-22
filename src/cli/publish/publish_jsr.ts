import {
  cwd as platformCwd,
  exists,
  join,
  mkdir as platformMkdir,
  writeTextFile as platformWriteTextFile,
} from "../../platform/platform.ts";
import { globalLogger as logger } from "../../logger.ts";
import { getErrorMessage } from "../../common/utils.ts";
import {
  detectMetadataFiles,
  executeCommand,
  generatePackageMetadata,
  readJSONFile,
  type HqlConfig,
} from "./utils.ts";
import type { PublishOptions } from "./index.ts";
import type { PublishSummary } from "./publish_summary.ts";

/**
 * Publishes a package to JSR
 */
export async function publishJSR(
  config: HqlConfig, // Accept config
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
      const existingDenoJson = (await readJSONFile(denoJsonPath)) as HqlConfig;
      name = (existingDenoJson.name || config.name) as string;
      version = (existingDenoJson.version || config.version) as string;
    } else {
      // Generate temporary deno.json for publishing
      const { jsr } = await generatePackageMetadata(config, platformCwd());
      if (!jsr) {
        throw new Error("Failed to generate JSR metadata");
      }
      denoJsonPath = jsr.path;
      await platformWriteTextFile(denoJsonPath, jsr.content);
      logger.debug && logger.debug(`Generated temporary metadata at ${denoJsonPath}`);
    }

    // 2. Build JS module (not explicitly done here, assumed part of setup or handled by deno publish)
    const entryFile = config.exports || "./mod.hql";
    if (!(await exists(entryFile))) {
      throw new Error(`Entry file not found: ${entryFile}`);
    }

    const buildDir = join(platformCwd(), "dist_jsr");
    await platformMkdir(buildDir, { recursive: true });

    // 3. Run deno publish
    const publishCmd = ["deno", "publish"];
    
    if (options.dryRun) {
      publishCmd.push("--dry-run");
    }
    
    if (options.allowDirty) {
      publishCmd.push("--allow-dirty");
    }

    console.log(`\n🚀 Publishing to JSR...`);
    
    const result = await executeCommand({
      cmd: publishCmd,
      cwd: platformCwd(),
      dryRun: options.dryRun,
      verbose: true, // Always show output for publish
    });

    if (!result.success) {
      throw new Error(`JSR publish failed: ${result.error}`);
    }

    // Generate link (placeholder for now)
    link = `https://jsr.io/${name}@${version}`;
    console.log(`\n✅ JSR publish completed successfully!`);

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