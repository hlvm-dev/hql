import { globalLogger as logger } from "@core/logger.ts";
import { buildJsModule } from "./build_js_module.ts";
import {
  dirname,
  exists,
  join,
  mkdir as platformMkdir,
  readDir,
  readTextFile as platformReadTextFile,
  runCmd,
  writeTextFile as platformWriteTextFile,
} from "../../platform/platform.ts";
export interface RunCommandOptions {
  cmd: string[];
  cwd: string;
  dryRun?: boolean;
  verbose?: boolean;
  extraFlags?: string[];
}

export type MetadataFileType = "package.json" | "deno.json" | "jsr.json";
export interface MetadataStatus {
  npm: MetadataFileType | null;
  jsr: MetadataFileType | null;
}

const buildCache = new Map<string, Promise<string>>();

async function collectDirectoryEntries(
  dir: string,
  entries: Array<{ path: string; isFile: boolean }>,
): Promise<void> {
  for await (const entry of readDir(dir)) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory) {
      entries.push({ path: entryPath, isFile: false });
      await collectDirectoryEntries(entryPath, entries);
    } else if (entry.isFile) {
      entries.push({ path: entryPath, isFile: true });
    }
  }
}

export function getCachedBuild(
  entryFile: string,
  options: { verbose?: boolean; dryRun?: boolean },
): Promise<string> {
  if (!buildCache.has(entryFile)) {
    logger.debug && logger.debug(`Creating new build for ${entryFile}`);
    const buildPromise = buildJsModule(entryFile, options);
    buildCache.set(entryFile, buildPromise);

    buildPromise.catch(() => {
      buildCache.delete(entryFile);
    });

    return buildPromise;
  }

  logger.debug && logger.debug(`Reusing cached build for ${entryFile}`);
  return buildCache.get(entryFile)!;
}

export async function detectMetadataFiles(
  dir: string,
): Promise<MetadataStatus> {
  const result: MetadataStatus = {
    npm: null,
    jsr: null,
  };

  const dirsToCheck = [dir, join(dir, "dist")];

  for (const checkDir of dirsToCheck) {
    if (!result.npm && await exists(join(checkDir, "package.json"))) {
      result.npm = "package.json";
      logger.debug && logger.debug(`Found package.json in ${checkDir}`);
    }

    if (!result.jsr && await exists(join(checkDir, "deno.json"))) {
      result.jsr = "deno.json";
      logger.debug && logger.debug(`Found deno.json in ${checkDir}`);
    } else if (!result.jsr && await exists(join(checkDir, "jsr.json"))) {
      result.jsr = "jsr.json";
      logger.debug && logger.debug(`Found jsr.json in ${checkDir}`);
    }
  }

  logger.debug &&
    logger.debug(`Detected metadata files: ${JSON.stringify(result)}`);

  return result;
}

export function getPlatformsFromArgs(args: string[]): ("jsr" | "npm")[] {
  const allForms = new Set(["all", "-all", "--all", "-a"]);
  const npmForms = new Set(["npm", "-npm", "--npm"]);
  const jsrForms = new Set(["jsr", "-jsr", "--jsr"]);

  let isAll = false, isNpm = false, isJsr = false;

  for (const arg of args) {
    if (allForms.has(arg)) isAll = true;
    else if (npmForms.has(arg)) isNpm = true;
    else if (jsrForms.has(arg)) isJsr = true;
  }

  if (!isAll && !isNpm && !isJsr) {
    return ["jsr"];
  }

  if (isAll) {
    return ["jsr", "npm"];
  }

  const platforms: ("jsr" | "npm")[] = [];
  if (isJsr) platforms.push("jsr");
  if (isNpm) platforms.push("npm");

  return platforms;
}

export async function readJSONFile(
  path: string,
): Promise<Record<string, unknown>> {
  try {
    logger.debug && logger.debug(`Reading JSON file: ${path}`);
    const text = await platformReadTextFile(path);
    return JSON.parse(text);
  } catch (error) {
    logger.debug && logger.debug(`Error reading JSON file ${path}: ${error}`);
    return {};
  }
}

export async function writeJSONFile(
  path: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const dir = dirname(path);
    try {
      await platformMkdir(dir, { recursive: true });
    } catch (_e) {
      // Ignore if directory already exists
    }

    logger.debug && logger.debug(`Writing JSON file: ${path}`);
    await platformWriteTextFile(path, JSON.stringify(data, null, 2));
  } catch (error) {
    logger.debug && logger.debug(`Error writing JSON file ${path}: ${error}`);
    throw new Error(`Failed to write JSON file ${path}: ${error}`);
  }
}

export function incrementPatchVersion(version: string): string {
  const parts = version.split(".");
  if (parts.length !== 3) {
    return "0.0.1";
  }

  try {
    const major = parseInt(parts[0], 10);
    const minor = parseInt(parts[1], 10);
    let patch = parseInt(parts[2], 10);
    patch++;

    return `${major}.${minor}.${patch}`;
  } catch {
    return "0.0.1";
  }
}

export function promptUser(
  message: string,
  defaultValue = "",
): Promise<string> {
  const promptMessage = defaultValue
    ? `${message} (${defaultValue}):`
    : `${message}:`;

  console.log(promptMessage);

  const input = prompt("> ") ?? "";
  return Promise.resolve(input.trim() || defaultValue);
}

/**
 * Compare two semver version strings (e.g., "1.2.3").
 * Returns -1 if a < b, 1 if a > b, 0 if equal.
 */
/**
 * Resolves the next version to publish by comparing remote and local versions.
 * If the remote version is lower than local, prompts the user to confirm the next version.
 * @param remoteVersion Version string from the registry (may be null)
 * @param localVersion Version string from local metadata (may be null)
 * @param promptUserFn Function to prompt the user (message, defaultValue) => Promise<string>
 * @param incrementPatchVersionFn Function to increment a version string (semver)
 * @param registryName Name of the registry (for messages)
 * @returns The version string to use for publish
 */
export async function resolveNextPublishVersion(
  remoteVersion: string | null,
  localVersion: string | null,
  promptUserFn: (msg: string, def: string) => Promise<string>,
  incrementPatchVersionFn: (v: string) => string,
  registryName: string,
): Promise<string> {
  if (remoteVersion && localVersion) {
    const comparison = compareVersions(remoteVersion, localVersion);

    if (comparison < 0) {
      const suggested = incrementPatchVersionFn(localVersion);
      console.warn(
        `  → Warning: Remote ${registryName} version (${remoteVersion}) is lower than local version (${localVersion}).`,
      );
      return await promptUserFn(
        `Remote ${registryName} version (${remoteVersion}) is lower than your local metadata version (${localVersion}).\nPlease confirm the version to publish`,
        suggested,
      );
    }

    const baseVersion = comparison > 0 ? remoteVersion : localVersion;
    return incrementPatchVersionFn(baseVersion);
  }

  if (remoteVersion) {
    return incrementPatchVersionFn(remoteVersion);
  }

  if (localVersion) {
    return incrementPatchVersionFn(localVersion);
  }

  return "0.0.1";
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
  }
  return 0;
}

export async function updateSourceMetadataFiles(
  distDir: string,
  metaFiles: string[],
  version: string,
): Promise<void> {
  const sourceDir = dirname(distDir);
  for (const metaFile of metaFiles) {
    const sourceMetaPath = join(sourceDir, metaFile);
    if (await exists(sourceMetaPath)) {
      try {
        const sourceConfig = await readJSONFile(sourceMetaPath);
        sourceConfig.version = version;
        await writeJSONFile(sourceMetaPath, sourceConfig);
        console.log(
          `  → Updated source ${metaFile} file with version ${version}`,
        );
      } catch (e) {
        console.warn(`  → Warning: Could not update source ${metaFile}: ${e}`);
      }
    }
  }
}

export async function ensureReadmeExists(
  distDir: string,
  packageName: string,
): Promise<void> {
  const readmePath = join(distDir, "README.md");
  if (!(await exists(readmePath))) {
    console.log(`  → Creating default README.md`);
    await writeTextFile(
      readmePath,
      `# ${packageName}\n\n> **This is a template README automatically generated by [HQL Publish](https://github.com/boraseoksoon/hql-dev).**\n> Please update this file with your own project details!\n\n---\n\n## 📦 About\n\nThis is a module published with [HQL](https://github.com/boraseoksoon/hql-dev).\nDescribe your project here!\n\n## 🚀 Getting Started\n\nInstall via your preferred registry:\n\n- **JSR:**\n  \`\`\`sh\n  deno add ${packageName}\n  \`\`\`\n- **NPM:**\n  \`\`\`sh\n  npm install ${packageName}\n  \`\`\`\n\n## 🛠 Publishing with HQL\n\nTo publish updates, run:\n\n\`\`\`sh\nhql publish <entry-file> [jsr|npm] [version] [--dry-run]\n\`\`\`\nSee [HQL Publish Guide](https://github.com/boraseoksoon/hql-dev) for full details.\n\n## 📄 Customizing this README\n\nEdit this file (\`README.md\`) to add your own project description, usage examples, API docs, contribution guidelines, and more.\n\n## 📚 Resources\n\n- [HQL Documentation](https://github.com/boraseoksoon/hql-dev)\n- [Report Issues](https://github.com/boraseoksoon/hql-dev/issues)\n\n---\n\n## 📝 License\n\n[MIT](./LICENSE) (or your preferred license)\n`,
    );
  }
}

/**
 * Executes a command and handles its output and errors in a standardized way
 *
 * @param options The command options
 * @returns A result object with success status and optional error output
 */
export async function executeCommand(
  options: RunCommandOptions,
): Promise<{ success: boolean; error?: string }> {
  const { cmd, cwd, extraFlags = [] } = options;

  try {
    // CRITICAL: All stdio must be "inherit" for interactive browser auth to work
    // deno publish checks if it's running in a real TTY before showing auth URL
    const process = runCmd({
      cmd: [...cmd, ...extraFlags],
      cwd,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit", // Must inherit for interactive auth
    });

    const status = await process.status;

    if (status.success) {
      return { success: true };
    } else {
      return { success: false, error: "Command failed" };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ANSI color codes for production-ready formatting
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  blue: "\x1b[34m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

function colorize(text: string, color: keyof typeof colors) {
  return `${colors[color]}${text}${colors.reset}`;
}

export async function visualizeTree(
  distDir: string,
  highlightFiles: string[] = [],
): Promise<string> {
  if (!(await exists(distDir))) {
    return colorize(`(No build output at ${distDir})`, "yellow");
  }
  const treeLines: string[] = [];
  const base = distDir.endsWith("/") ? distDir.slice(0, -1) : distDir;
  const baseLen = base.length + 1;

  // Gather all files/dirs
  const entries: { path: string; isFile: boolean }[] = [];
  await collectDirectoryEntries(distDir, entries);

  // Sort by directory depth then alphabetically
  entries.sort((a, b) => a.path.localeCompare(b.path));

  // Build tree
  for (let i = 0; i < entries.length; ++i) {
    const { path, isFile } = entries[i];
    const relPath = path.slice(baseLen);
    const parts = relPath.split("/");
    let prefix = "";
    for (let j = 0; j < parts.length - 1; ++j) {
      prefix += (j === 0 ? "" : "  ") + "│ ";
    }
    const isLast = i === entries.length - 1 ||
      (entries[i + 1].path.slice(0, path.length + 1) !== path + "/");
    const branch = isLast ? "└─" : "├─";
    let display = `${prefix}${branch} ${parts[parts.length - 1]}`;
    if (highlightFiles.some((hf) => relPath.endsWith(hf))) {
      display = colorize(display, "green") + colorize(" ← bundled", "cyan");
    } else if (!isFile) {
      display = colorize(display, "blue") + "/";
    }
    treeLines.push(display);
  }
  return colorize(`\nFiles to be published from ${distDir}:\n`, "bold") +
    treeLines.join("\n");
}
