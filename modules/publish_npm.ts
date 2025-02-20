import { join, resolve, basename, extname } from "https://deno.land/std@0.170.0/path/mod.ts";
import { exists, copy } from "https://deno.land/std@0.170.0/fs/mod.ts";
import { compileHQL } from "./compiler/transpiler.ts";

/**
 * Reads or creates a VERSION file and bumps its version.
 */
export async function getNextVersionInDir(outDir: string, provided?: string): Promise<string> {
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
 * Auto-detects the npm username.
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
 * Publishes the HQL module to npm.
 * It transpiles the HQL file, bundles it using deno bundle,
 * copies the runtime file to the output directory,
 * creates package.json and README.md, and publishes via npm.
 */
export async function publishNpm(options: { what: string; name?: string; version?: string; }): Promise<void> {
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
  
  const version = await getNextVersionInDir(outDir, options.version);
  
  // Find a .hql file in the output directory.
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
  
  // Transpile the HQL source to an intermediate JS file.
  const source = await Deno.readTextFile(hqlFile);
  const jsCode = await compileHQL(source, hqlFile, false);
  const intermediateJS = join(outDir, basename(hqlFile, extname(hqlFile)) + ".temp.js");
  await Deno.writeTextFile(intermediateJS, jsCode);
  console.log(`Transpiled ${hqlFile} -> ${intermediateJS}`);
  
  // Copy the runtime file from modules/ to outDir so the bundler can find it.
  const runtimeSrc = resolve("modules/hql_runtime.js");
  const runtimeDst = join(outDir, "hql_runtime.js");
  await copy(runtimeSrc, runtimeDst, { overwrite: true });
  console.log(`Copied runtime to ${runtimeDst}`);
  
  // Bundle the intermediate file into a self-contained bundle.
  const bundleJS = join(outDir, basename(hqlFile, extname(hqlFile)) + ".bundle.js");
  const bundleProc = Deno.run({
    cmd: [
      Deno.execPath(),
      "bundle",
      intermediateJS,
      bundleJS
    ],
    stdout: "inherit",
    stderr: "inherit"
  });
  const bundleStatus = await bundleProc.status();
  bundleProc.close();
  if (!bundleStatus.success) {
    console.error("Failed to bundle the transpiled output.");
    Deno.exit(bundleStatus.code);
  }
  console.log(`Bundled output written to ${bundleJS}`);
  
  // Create package.json
  const pkg = {
    name: pkgName,
    version,
    main: basename(bundleJS),
    module: basename(bundleJS),
    license: "MIT",
    description: "HQL module published to npm",
  };
  const pkgPath = join(outDir, "package.json");
  await Deno.writeTextFile(pkgPath, JSON.stringify(pkg, null, 2));
  console.log(`Created package.json at ${pkgPath}`);
  
  // Create README.md if missing.
  const readmePath = join(outDir, "README.md");
  if (!(await exists(readmePath))) {
    await Deno.writeTextFile(readmePath, `# ${pkgName}\n\nAutogenerated README. Please update this with details.`);
    console.log(`Generated README.md at ${readmePath}`);
  }
  
  console.log(`Publishing package "${pkgName}" to npm from ${outDir}...`);
  const publishProc = Deno.run({
    cmd: ["npm", "publish", "--access", "public"],
    cwd: outDir,
    stdout: "inherit",
    stderr: "inherit"
  });
  const publishStatus = await publishProc.status();
  publishProc.close();
  if (!publishStatus.success) {
    console.error("npm publish failed. Ensure you're logged in and have permission to publish the package:", pkgName);
    Deno.exit(publishStatus.code);
  }
  console.log("Package published successfully!");
  console.log(`Published URL: https://www.npmjs.com/package/${pkgName}`);
}
