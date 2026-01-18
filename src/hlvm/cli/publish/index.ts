import { parseArgs } from "jsr:@std/cli@1.0.13/parse-args";
import { getPlatform } from "../../../platform/platform.ts";

const p = () => getPlatform();
const dirname = (path: string) => p().path.dirname(path);
const exists = (path: string) => p().fs.exists(path);
const exit = (code: number) => p().process.exit(code);
const platformGetArgs = () => p().process.args();
const platformGetEnv = (key: string) => p().env.get(key);
import { publishNpm } from "./publish_npm.ts";
import { publishJSR } from "./publish_jsr.ts";
import { printPublishSummary, type PublishSummary } from "./publish_summary.ts";
import { globalLogger as logger } from "../../../logger.ts";
import { log } from "../../api/log.ts";
import { getErrorMessage } from "../../../common/utils.ts";
import { SEMVER_REGEX } from "../commands/shared.ts";
import {
  detectMetadataFiles,
  getPlatformsFromArgs,
  type HlvmProjectConfig,
  readJSONFile, // Import readJSONFile
  writeJSONFile,
  type MetadataFileType,
  type MetadataStatus,
} from "./utils.ts";

// Re-export PublishOptions from single source of truth
export type { PublishOptions } from "./publish_common.ts";
import type { PublishOptions } from "./publish_common.ts";

function showHelp() {
  log.raw.log(`
HLVM Publish Tool - Publish HLVM modules to NPM or JSR

USAGE:
  hlvm publish <entry-file> [platform] [version] [options]

EXAMPLES:
  # Publish to JSR (default):
  hlvm publish ./my-module/index.hql

  # Publish to NPM:
  hlvm publish ./my-module/index.hql npm

  # Publish to JSR with specific version:
  hlvm publish ./my-module/index.hql jsr 1.2.3

  # Publish to NPM with specific version:
  hlvm publish ./my-module/index.hql npm 1.2.3

  # Publish to both JSR and NPM:
  hlvm publish ./my-module/index.hql all

  # Publish to both JSR and NPM with specific version:
  hlvm publish ./my-module/index.hql all 1.2.3

  # Dry run mode (no actual publishing):
  hlvm publish ./my-module/index.hql --dry-run

OPTIONS:
  --dry-run                   Test the publishing process without actually publishing
  --verbose                   Enable verbose logging
  -h, --help                  Show this help message

ENVIRONMENT VARIABLES:
  DRY_RUN_PUBLISH=1           Always perform a dry run
  SKIP_LOGIN_CHECK=1          Skip registry authentication check
`);
}

function parsePublishArgs(args: string[]): PublishOptions {
  if (args.includes("-h") || args.includes("--help")) {
    showHelp();
    exit(0);
  }

  const parsed = parseArgs(args, {
    boolean: ["verbose", "help", "dry-run"],
    alias: {
      h: "help",
    },
  });

  if (parsed._.length === 0) {
    log.raw.error(
      "\n❌ Error: Missing entry file path. You must specify the module's entry .hql file.",
    );
    showHelp();
    exit(1);
  }

  const entryFile = String(parsed._[0]);
  const platforms = getPlatformsFromArgs(args);

  let version: string | undefined;

  for (let i = 1; i < parsed._.length; i++) {
    const arg = String(parsed._[i]);
    if (SEMVER_REGEX.test(arg)) {
      version = arg;
      logger.debug &&
        logger.debug(`Found version parameter: ${version} at position ${i}`);
      break;
    }
  }

  if (version && !SEMVER_REGEX.test(version)) {
    log.raw.error(`\n❌ Invalid version format: ${version}. Expected "X.Y.Z"`);
    exit(1);
  }

  return {
    entryFile,
    platforms,
    version,
    verbose: !!parsed.verbose,
    dryRun: !!parsed["dry-run"] || platformGetEnv("DRY_RUN_PUBLISH") === "1",
  };
}

function printPublishInfo(
  entryFile: string,
  options: PublishOptions,
  metadataStatus: MetadataStatus,
): void {
  const targetPlatforms = (options.platforms ?? []).map((p) => p.toUpperCase()).join(
    ", ",
  );

  const jsrMetadataStatus = metadataStatus.jsr
    ? "Using existing metadata"
    : "Will create metadata";
  const npmMetadataStatus = metadataStatus.npm
    ? "Using existing metadata"
    : "Will create metadata";

  log.raw.log(`
🚀 Preparing to publish your HLVM module!
  Entry file: "${entryFile}"
  Version: ${options.version ? options.version : "(auto-determined)"}
  Target platforms: ${targetPlatforms}
  JSR: ${jsrMetadataStatus}
  NPM: ${npmMetadataStatus}
  Mode: ${options.dryRun ? "Dry run (no actual publishing)" : "Live publish"}`);
}

function buildFailureSummary(
  registry: "jsr" | "npm",
  metadataType: MetadataFileType | null,
  version: string | undefined,
  error: unknown,
): PublishSummary {
  const errorMessage = getErrorMessage(error);
  log.raw.error(
    `\n❌ ${registry.toUpperCase()} publish failed: ${errorMessage}`,
  );

  return {
    registry,
    name: metadataType ? `(from ${metadataType})` : "(unknown)",
    version: version ?? "(auto)",
    link: `❌ ${errorMessage}`,
  };
}

async function publishToRegistry(
  config: HlvmProjectConfig, // Added config
  registry: "jsr" | "npm",
  options: PublishOptions,
  metadataType: MetadataFileType | null,
): Promise<PublishSummary> {
  log.raw.log(
    `\n📦 Starting ${registry.toUpperCase()} package publishing process`,
  );

  try {
    // publishOptions argument must be type PublishOptions, not a new object
    const publishOptions = options;

    return registry === "jsr"
      ? await publishJSR(config, publishOptions) // Pass config here
      : await publishNpm(config, publishOptions); // Pass config here
  } catch (error) {
    return buildFailureSummary(registry, metadataType, options.version, error);
  }
}

async function migrateLegacyProjectConfig(moduleDir: string): Promise<void> {
  const configPath = `${moduleDir}/hlvm.json`;
  const legacyPath = `${moduleDir}/hql.json`;
  if (await exists(configPath)) {
    return;
  }
  if (!await exists(legacyPath)) {
    return;
  }
  const legacyConfig = await readJSONFile(legacyPath);
  await writeJSONFile(configPath, legacyConfig as Record<string, unknown>);
  log.raw.log(`✅ Migrated ${legacyPath} to ${configPath}`);
}

export async function publish(args: string[]): Promise<void> {
  try {
    const options = parsePublishArgs(args);

    if (options.verbose) {
      logger.debug("Running with verbose logging enabled");
      logger.debug(`Parsed options: ${JSON.stringify(options, null, 2)}`);
    }

    const moduleDir = dirname(options.entryFile);
    await migrateLegacyProjectConfig(moduleDir);

    // Read config from hlvm.json
    const configPath = `${moduleDir}/hlvm.json`;
    if (!await exists(configPath)) {
      log.raw.error(
        `\n❌ hlvm.json not found in entry file directory: ${moduleDir}`,
      );
      exit(1);
    }
    const config = (await readJSONFile(configPath)) as unknown as HlvmProjectConfig;

    if (!await exists(options.entryFile)) {
      log.raw.error(`\n❌ Entry file not found: ${options.entryFile}`);
      exit(1);
    }

    const metadataStatus = await detectMetadataFiles(moduleDir);

    if (options.verbose) {
      logger.debug(
        `Metadata status: ${JSON.stringify(metadataStatus, null, 2)}`,
      );
    }

    printPublishInfo(options.entryFile, options, metadataStatus);

    const summaries: PublishSummary[] = [];
    for (const platform of options.platforms ?? []) {
      const metadataType = platform === "jsr"
        ? metadataStatus.jsr
        : metadataStatus.npm;
      // Pass config to publishToRegistry
      const summary = await publishToRegistry(config, platform, options, metadataType);
      summaries.push(summary);
    }

    printPublishSummary(summaries);

    const allFailed = summaries.every((summary) =>
      summary.link.startsWith("❌")
    );
    if (allFailed) {
      exit(1);
    } else if (summaries.some((summary) => summary.link.startsWith("❌"))) {
      log.raw.log(
        "\n⚠️ Some publishing operations failed. Check the summary for details.",
      );
    }
  } catch (error) {
    log.raw.error(
      `\n❌ Publish failed: ${
        getErrorMessage(error)
      }`,
    );
    exit(1);
  }
}

if (import.meta.main) {
  publish(platformGetArgs());
}
