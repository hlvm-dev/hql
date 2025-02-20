// modules/publish_npm.ts
import { join, resolve } from "https://deno.land/std@0.170.0/path/mod.ts";
import { exists } from "https://deno.land/std@0.170.0/fs/mod.ts";

/**
 * Reads (or creates/bumps) a VERSION file inside outDir.
 * If a version is provided, that value is used.
 */
export async function getNextVersionInDir(
  outDir: string,
  provided?: string,
): Promise<string> {
  if (provided) return provided;
  const versionFile = join(outDir, "VERSION");
  if (!(await exists(versionFile))) {
    const defaultVersion = "0.0.1";
    await Deno.writeTextFile(versionFile, defaultVersion);
    console.log(`No VERSION file found in ${outDir}. Setting version to ${defaultVersion}`);
    return defaultVersion;
  }
  const current = (await Deno.readTextFile(versionFile)).trim();
  const parts = current.split(".");
  if (parts.length !== 3) throw new Error(`Invalid version format in ${versionFile}`);
  const [major, minor] = parts;
  let patch = parseInt(parts[2], 10);
  patch++;
  const newVersion = `${major}.${minor}.${patch}`;
  await Deno.writeTextFile(versionFile, newVersion);
  console.log(`Bumped version from ${current} to ${newVersion} in ${outDir}`);
  return newVersion;
}

/**
 * (Optional) You could extend the version bump strategy here.
 * For now, the code simply bumps the patch.
 */

/**
 * Auto-detects the npm username.
 * First, checks the NPM_USERNAME environment variable.
 * If not set, attempts to run "npm whoami".
 */
export async function getNpmUsername(): Promise<string | undefined> {
  let npmUser = Deno.env.get("NPM_USERNAME");
  if (npmUser) return npmUser.trim();
  try {
    const proc = Deno.run({
      cmd: ["npm", "whoami"],
      stdout: "piped",
      stderr: "null",
    });
    const output = await proc.output();
    proc.close();
    npmUser = new TextDecoder().decode(output).trim();
    return npmUser || undefined;
  } catch (e) {
    console.error("Failed to auto-detect npm username:", e);
    return undefined;
  }
}

/**
 * Publishes your HQL module to npm.
 *
 * Options:
 *   - what: The output directory (package root) where your .hql file resides.
 *   - name: (Optional) The desired package name.
 *           • If provided as a simple name (e.g. "add") and if NPM_USERNAME is set,
 *             it becomes "@<NPM_USERNAME>/add".
 *           • If it starts with "@", it’s used as-is.
 *           • If not provided, it defaults to "@<NPM_USERNAME>/<basename(outDir)>"
 *             if NPM_USERNAME is available, or just the directory's basename.
 *   - version: (Optional) The version string; if omitted, a VERSION file in outDir is used and bumped.
 *
 * If the environment variable DRY_RUN_PUBLISH is set, then npm publish is run in dry-run mode.
 *
 * The tool:
 *   1. Locates a single .hql file in outDir.
 *   2. Compiles it using compileHQL.
 *   3. Writes the compiled JavaScript (as <filename>.hql.js) in outDir.
 *   4. Creates a minimal package.json and README.md in outDir.
 *   5. Publishes the package to npm (with --access public or --dry-run if requested).
 *   6. Prints the final npm URL.
 */
export async function publishNpm(options: {
  what: string;
  name?: string;
  version?: string;
}) {
  const outDir = resolve(options.what);
  await Deno.mkdir(outDir, { recursive: true });

  // Determine package name.
  let pkgName: string;
  if (options.name) {
    pkgName = options.name.startsWith("@")
      ? options.name
      : (() => {
          const npmUser = Deno.env.get("NPM_USERNAME") || "";
          return npmUser ? `@${npmUser.trim()}/${options.name}` : options.name;
        })();
  } else {
    const npmUser = await getNpmUsername();
    const dirName = outDir.split("/").pop() || "hql-package";
    pkgName = npmUser ? `@${npmUser}/${dirName}` : dirName;
  }
  console.log(`Using package name: ${pkgName}`);

  // Determine version.
  let version = await getNextVersionInDir(outDir, options.version);

  // (Optional) Here you could add more sophisticated version bumping logic.

  // Locate a .hql file in outDir.
  let hqlFile: string | null = null;
  for await (const entry of Deno.readDir(outDir)) {
    if (entry.isFile && entry.name.endsWith(".hql")) {
      hqlFile = join(outDir, entry.name);
      break;
    }
  }
  if (!hqlFile) {
    console.error(`No .hql file found in ${outDir}. Please place your HQL source (e.g., add.hql) there.`);
    Deno.exit(1);
  }

  // Compile the HQL file.
  const { compileHQL } = await import("./compiler/compiler.ts");
  const source = await Deno.readTextFile(hqlFile);
  const compiledJS = await compileHQL(source, hqlFile, false);
  const outJS = hqlFile + ".js";
  await Deno.writeTextFile(outJS, compiledJS);
  console.log(`Compiled ${hqlFile} -> ${outJS}`);

  // Create a minimal package.json.
  const pkg = {
    name: pkgName,
    version,
    main: (hqlFile.split("/").pop() || "module.hql") + ".js",
    license: "MIT",
    description: "HQL module published to npm",
  };
  const pkgPath = join(outDir, "package.json");
  await Deno.writeTextFile(pkgPath, JSON.stringify(pkg, null, 2));
  console.log(`Created package.json at ${pkgPath}`);

  // Create a minimal README.md if missing.
  const readmePath = join(outDir, "README.md");
  if (!(await exists(readmePath))) {
    await Deno.writeTextFile(
      readmePath,
      `# ${pkgName}\n\nAutogenerated README. Please update this with details.`,
    );
    console.log(`Generated README.md at ${readmePath}`);
  }

  // Determine if dry-run mode is enabled.
  const dryRun = Deno.env.get("DRY_RUN_PUBLISH");

  // Publish to npm.
  const publishCmd = dryRun
    ? ["npm", "publish", "--dry-run", "--access", "public"]
    : ["npm", "publish", "--access", "public"];
  console.log(`Publishing package "${pkgName}" to npm from ${outDir}...`);
  const proc = Deno.run({
    cmd: publishCmd,
    cwd: outDir,
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await proc.status();
  proc.close();
  if (!status.success) {
    console.error("npm publish failed. Ensure you're logged in and have permission to publish the package:", pkgName);
    Deno.exit(status.code);
  }
  console.log("Package published successfully!");
  console.log(`Published URL: https://www.npmjs.com/package/${pkgName}`);
}
