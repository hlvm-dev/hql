import {
  join,
  resolve,
  readTextFile,
  writeTextFile,
  mkdir,
  runCmd,
  exit,
} from "../../platform/platform.ts";
import { exists, copy } from "https://deno.land/std@0.170.0/fs/mod.ts";
import { makeTempDir } from "../../platform/platform.ts";
import { buildJsModule } from "./build_js_module.ts";

export async function publishJSR(options: {
  what: string;
  name?: string;
  version?: string;
}) {
  const outDir = resolve(options.what);
  await mkdir(outDir, { recursive: true });
  // Build the npm folder using our build process.
  await buildJsModule(outDir);

  const npmDistDir = join(outDir, "npm");
  if (!(await exists(npmDistDir))) {
    console.error("npm/ folder not found. Did dnt build fail?");
    exit(1);
  }

  // Step 2: Read & update version from npm/package.json.
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

  // Step 3: Determine final package name.
  const dirName = outDir.split("/").pop() || "hql-package";
  const defaultScopedName = `@boraseoksoon/${dirName.toLowerCase().replace(/_/g, "-")}`;
  let finalName = (options.name || defaultScopedName)
    .toLowerCase()
    .replace(/_/g, "-");
  pkg.name = finalName;

  await writeTextFile(pkgJsonPath, JSON.stringify(pkg, null, 2));

  // Step 4: Create jsr.json inside npm/ referencing the ESM output.
  // dnt emits the shimmed bundle in npm/esm/bundle.js.
  const jsrPath = join(npmDistDir, "jsr.json");
  const jsrConfig = {
    name: finalName,
    version: newVersion,
    exports: "./esm/bundle.js",
    license: "MIT",
  };
  await writeTextFile(jsrPath, JSON.stringify(jsrConfig, null, 2));
  console.log(`Created jsr.json in npm/: ${jsrPath}`);
  console.log(`jsr.json content: ${JSON.stringify(jsrConfig, null, 2)}`);

  // Step 5: Ensure a README exists.
  const readmePath = join(npmDistDir, "README.md");
  if (!(await exists(readmePath))) {
    await writeTextFile(readmePath, `# ${finalName}\n\nAuto-generated README for JSR publish.`);
  }

  // Step 6: Copy the entire npm/ folder to a temporary directory and run "deno publish" from there.
  const tempDir = await makeTempDir();
  await copy(npmDistDir, tempDir, { overwrite: true });

  console.log(`Publishing ${finalName}@${newVersion} to JSR from npm/ folder...`);
  const publishProc = runCmd({
    cmd: ["deno", "publish", "--allow-dirty", "--allow-slow-types"],
    cwd: tempDir,
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await publishProc.status();
  publishProc.close();
  if (!status.success) {
    console.error("deno publish failed. Please fix errors and try again.");
    exit(status.code);
  }
  console.log(`JSR publish succeeded! See https://jsr.io/packages/${encodeURIComponent(finalName)}`);
}
