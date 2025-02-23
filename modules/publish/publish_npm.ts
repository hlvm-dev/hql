// modules/publish/publish_npm.ts

import {
  join,
  resolve,
  readTextFile,
  writeTextFile,
  mkdir,
  runCmd,
  exit,
  getEnv,
} from "../../platform/platform.ts";
import { exists } from "https://deno.land/std@0.170.0/fs/mod.ts";
import { buildJsModule } from "./build_js_module.ts";
import { getNpmUsername } from "./publish_common.ts";

/**
 * Publishes the npm/ folder to npm.
 * Steps:
 * 1. Build the npm/ folder using buildJsModule().
 * 2. Read and update version in package.json.
 * 3. Update package.json with a proper package name.
 * 4. Run "npm publish" from within npm/ folder.
 */
export async function publishNpm(options: {
  what: string;
  name?: string;
  version?: string;
}) {
  const outDir = resolve(options.what);
  await mkdir(outDir, { recursive: true });
  await buildJsModule(outDir);

  const npmDistDir = join(outDir, "npm");
  if (!(await exists(npmDistDir))) {
    console.error("npm/ folder not found. Did dnt build fail?");
    exit(1);
  }

  const pkgJsonPath = join(npmDistDir, "package.json");
  if (!(await exists(pkgJsonPath))) {
    console.error("package.json not found in npm/.");
    exit(1);
  }
  let pkg = JSON.parse(await readTextFile(pkgJsonPath));
  let currentVersion = pkg.version || "0.0.1";
  let newVersion: string;
  if (options.version) {
    newVersion = options.version;
  } else {
    const [major, minor, patch] = currentVersion.split(".");
    newVersion = `${major}.${minor}.${Number(patch) + 1}`;
  }
  pkg.version = newVersion;

  let pkgName: string;
  if (options.name) {
    pkgName = options.name.startsWith("@")
      ? options.name
      : (() => {
          const npmUser = getEnv("NPM_USERNAME") || "";
          return npmUser ? `@${npmUser.trim()}/${options.name}` : options.name;
        })();
  } else {
    const npmUser = await getNpmUsername();
    const dirName = outDir.split("/").pop() || "hql-package";
    pkgName = npmUser ? `@${npmUser}/${dirName}` : dirName;
  }
  pkgName = pkgName.toLowerCase().replace(/_/g, "-");
  pkg.name = pkgName;

  await writeTextFile(pkgJsonPath, JSON.stringify(pkg, null, 2));
  console.log(`Updated package.json in npm/ with name=${pkgName} version=${newVersion}`);

  const readmePath = join(npmDistDir, "README.md");
  if (!(await exists(readmePath))) {
    await writeTextFile(readmePath, `# ${pkgName}\n\nAuto-generated README. Please update.`);
  }

  const dryRun = getEnv("DRY_RUN_PUBLISH");
  const publishCmd = dryRun
    ? ["npm", "publish", "--dry-run", "--access", "public"]
    : ["npm", "publish", "--access", "public"];

  console.log(`Publishing package "${pkgName}" to npm from ${npmDistDir}...`);
  const proc = runCmd({
    cmd: publishCmd,
    cwd: npmDistDir,
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await proc.status();
  proc.close();
  if (!status.success) {
    console.error("npm publish failed. Make sure you're logged in and have permission.");
    exit(status.code);
  }
  console.log(`Package published successfully! See https://www.npmjs.com/package/${pkgName}`);
}
