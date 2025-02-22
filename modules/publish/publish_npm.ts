import { join, resolve, basename, runCmd, readTextFile } from "../../platform/platform.ts";
import { buildJsModule } from "./build_js_module.ts";
import { getNextVersionInDir, getNpmUsername } from "./publish_common.ts";


// Publishes the finalized JS module package to npm.
export async function publishNpm(options: {
  what: string;
  name?: string;
  version?: string;
}) {
  // Build the JS module package from the HQL sources.
  const builtDir = await buildJsModule({
    source: options.what,
    out: options.what, // For this example, we build in the same directory.
    name: options.name,
    version: options.version,
  });

  // Retrieve package.json from the built module.
  const pkgPath = join(builtDir, "package.json");
  const pkg = JSON.parse(await Deno.readTextFile(pkgPath));

  // Determine if we are in dry-run mode.
  const dryRun = Deno.env.get("DRY_RUN_PUBLISH");
  const publishCmd = dryRun
    ? ["npm", "publish", "--dry-run", "--access", "public"]
    : ["npm", "publish", "--access", "public"];

  console.log(`Publishing package "${pkg.name}" to npm from ${builtDir}...`);
  const proc = runCmd({
    cmd: publishCmd,
    cwd: builtDir,
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await proc.status();
  proc.close();
  if (!status.success) {
    console.error("npm publish failed. Ensure you're logged in and have permission to publish the package:", pkg.name);
    Deno.exit(status.code);
  }
  console.log("Package published successfully!");
  console.log(`Published URL: https://www.npmjs.com/package/${pkg.name}`);
}
