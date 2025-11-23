import { exists, exit as platformExit } from "../../src/platform/platform.ts";
import { parseArgs } from "jsr:@std/cli@1.0.13/parse-args";
import {
  incrementPatchVersion,
  promptUser,
  readJSONFile,
  writeJSONFile,
} from "../publish/utils.ts";
import { publish as publishCore } from "../publish/index.ts";
import type { HqlConfig } from "./init.ts";
import {
  generateDefaultPackageName,
  validatePackageName,
  validateVersion,
} from "./shared.ts";

/**
 * Ensure hql.json exists, creating it if necessary with smart prompting
 */
async function ensureConfig(options: { yesFlag: boolean }): Promise<HqlConfig> {
  const configPath = "./hql.json";

  // If hql.json exists, read and return it
  if (await exists(configPath)) {
    const config = await readJSONFile(configPath) as HqlConfig;

    // Validate required fields
    if (!config.name || !config.version || !config.exports) {
      console.error("\n❌ Error: Invalid hql.json");
      console.error("Required fields: name, version, exports");
      console.error("\nRun: hql init");
      platformExit(1);
    }

    // Validate package name format
    validatePackageName(config.name);

    return config;
  }

  // No hql.json - need to create one
  console.log("\n⚠️  No hql.json found. Let's create one!\n");

  const defaultName = generateDefaultPackageName();
  const defaultVersion = "0.0.1";
  const defaultEntry = "mod.hql";

  let name: string;
  let version: string;
  let entryPoint: string;

  if (options.yesFlag) {
    // Auto-create with defaults
    name = defaultName;
    version = defaultVersion;
    entryPoint = defaultEntry;

    console.log(`Auto-detected:`);
    console.log(`  Name: ${name}`);
    console.log(`  Version: ${version}`);
    console.log(`  Entry: ${entryPoint}\n`);
  } else {
    // Prompt user with smart defaults
    console.log(`Auto-detected values (press Enter to accept):\n`);

    name = await promptUser(`Package name`, defaultName);
    version = await promptUser(`Version`, defaultVersion);
    entryPoint = await promptUser(`Entry point`, defaultEntry);
  }

  // Validate package name and version
  validatePackageName(name);
  validateVersion(version);

  // Check if entry point exists
  if (!await exists(entryPoint)) {
    console.error(`\n❌ Entry point not found: ${entryPoint}`);
    console.error(`\nCreate ${entryPoint} first, or run: hql init`);
    platformExit(1);
  }

  // Create hql.json
  const config: HqlConfig = {
    name,
    version,
    exports: `./${entryPoint}`,
  };

  await writeJSONFile(configPath, config);

  console.log(`\n✨ Created hql.json`);
  console.log(`  → ${name} v${version}\n`);

  return config;
}

/**
 * Update version in hql.json after successful publish
 */
async function updateConfigVersion(newVersion: string): Promise<void> {
  const configPath = "./hql.json";

  if (!await exists(configPath)) {
    return; // No config to update
  }

  const config = await readJSONFile(configPath) as HqlConfig;
  config.version = newVersion;

  await writeJSONFile(configPath, config);
  console.log(`\n  → Updated hql.json to version ${newVersion}`);
}

/**
 * Parse command-line arguments for publish command
 */
function parsePublishArgs(args: string[]): {
  entryFile?: string;
  registries: ("jsr" | "npm")[];
  version?: string;
  dryRun: boolean;
  verbose: boolean;
  yesFlag: boolean;
} {
  const parsed = parseArgs(args, {
    boolean: ["verbose", "dry-run", "y", "yes"],
    string: ["r", "registry", "v", "version"],
    alias: {
      r: "registry",
      v: "version",
    },
  });

  // Entry file is optional (defaults to hql.json exports field)
  const entryFile = parsed._[0] ? String(parsed._[0]) : undefined;

  // Parse registries
  let registries: ("jsr" | "npm")[] = ["jsr", "npm"]; // Default: both

  const registry = parsed.registry || parsed.r;
  if (registry) {
    if (registry === "jsr") {
      registries = ["jsr"];
    } else if (registry === "npm") {
      registries = ["npm"];
    } else if (registry === "all") {
      registries = ["jsr", "npm"];
    } else {
      console.error(`\n❌ Invalid registry: ${registry}`);
      console.error(`Valid options: jsr, npm, all`);
      platformExit(1);
    }
  }

  return {
    entryFile,
    registries,
    version: parsed.version || parsed.v,
    dryRun: !!parsed["dry-run"],
    verbose: !!parsed.verbose,
    yesFlag: !!parsed.y || !!parsed.yes,
  };
}

/**
 * Ensure metadata files (package.json, deno.json) exist in source directory
 * This allows core publish to use the package name from hql.json
 */
async function ensureMetadataFiles(
  packageName: string,
  version: string,
): Promise<void> {
  // Create package.json for NPM
  const packageJsonPath = "./package.json";
  if (!await exists(packageJsonPath)) {
    const packageJson = {
      name: packageName,
      version: version,
      type: "module",
      // Don't set exports here - let core publish system handle it
    };
    await writeJSONFile(packageJsonPath, packageJson);
  }

  // Create deno.json for JSR
  const denoJsonPath = "./deno.json";
  if (!await exists(denoJsonPath)) {
    const denoJson = {
      name: packageName,
      version: version,
      // Don't set exports here - core publish will set it to "./esm/index.js"
    };
    await writeJSONFile(denoJsonPath, denoJson);
  }
}

/**
 * Main publish command with smart prompting
 */
export async function publishCommand(args: string[]): Promise<void> {
  // Parse arguments
  const parsedArgs = parsePublishArgs(args);

  // Ensure hql.json exists (prompt if missing)
  const config = await ensureConfig({ yesFlag: parsedArgs.yesFlag });

  // Determine entry file
  const entryFile = parsedArgs.entryFile || config.exports.replace(/^\.\//, "");

  // Check entry file exists
  if (!await exists(entryFile)) {
    console.error(`\n❌ Entry file not found: ${entryFile}`);
    console.error(`\nSpecified in hql.json: ${config.exports}`);
    platformExit(1);
  }

  // Determine version
  let publishVersion = parsedArgs.version || config.version;

  // If no explicit version, bump version (even in dry-run to show what would happen)
  if (!parsedArgs.version) {
    publishVersion = incrementPatchVersion(config.version);
  }

  console.log(`\n📦 Publishing ${config.name}@${publishVersion}...`);
  console.log(`  → Entry: ${entryFile}`);
  console.log(
    `  → Registries: ${parsedArgs.registries.join(", ").toUpperCase()}`,
  );
  if (parsedArgs.dryRun) {
    console.log(`  → Mode: Dry run (no actual publishing)`);
  }
  console.log();

  // Create metadata files in source directory so core publish can use them
  // This ensures the package name from hql.json is used instead of prompting
  await ensureMetadataFiles(config.name, publishVersion);

  // Build arguments for core publish function
  const publishArgs: string[] = [
    entryFile,
    ...parsedArgs.registries,
    publishVersion,
  ];

  if (parsedArgs.dryRun) {
    publishArgs.push("--dry-run");
  }

  if (parsedArgs.verbose) {
    publishArgs.push("--verbose");
  }

  // Call core publish logic
  await publishCore(publishArgs);

  // Update version in hql.json (only if not dry-run and no explicit version)
  if (!parsedArgs.dryRun && !parsedArgs.version) {
    await updateConfigVersion(publishVersion);
  }
}

/**
 * Show help for publish command
 */
export function showPublishHelp(): void {
  console.log(`
HQL Publish - Publish HQL modules to JSR and NPM

USAGE:
  hql publish [file] [options]

BEHAVIOR:
  First time:  Prompts for package name (if no hql.json)
  After that:  Automatic (reads from hql.json)

EXAMPLES:
  # Zero-config publish (first time: prompts, after: automatic)
  hql publish

  # Zero-interaction (all defaults, no prompts)
  hql publish -y

  # Publish to specific registry
  hql publish -r jsr            # JSR only
  hql publish -r npm            # NPM only
  hql publish -r all            # Both (default)

  # Explicit version (skips auto-bump)
  hql publish -v 1.0.0

  # Dry run (preview without publishing)
  hql publish --dry-run

  # Explicit entry file (overrides hql.json)
  hql publish src/lib.hql

OPTIONS:
  -r, --registry <name>   Target registry: jsr, npm, or all (default: all)
  -v, --version <ver>     Explicit version (skips auto-bump)
  -y, --yes               Auto-accept defaults (no prompts)
  --dry-run               Preview without publishing
  --verbose               Enable verbose logging
  -h, --help              Show this help message

WORKFLOW:
  1. Checks for hql.json (prompts to create if missing)
  2. Auto-bumps version (unless --version specified)
  3. Builds and publishes to registries
  4. Updates hql.json with new version
`);
}
