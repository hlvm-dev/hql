import {
  join,
  resolve,
  readTextFile,
  writeTextFile,
  mkdir,
  runCmd,
  exit,
  readDir,
} from "../../platform/platform.ts";
import { compile } from "../compiler.ts";

/**
 * Build process:
 * 1. Find all .hql files in `inputDir` and transpile them to .hql.js.
 * 2. Create an aggregator file (all_hql_modules.ts) that re-exports all transpiled files.
 *    (Note: We now use `export * from "./file.js"` instead of `export * as name from "./file.js"` so that named exports come through directly.)
 * 3. Use `deno bundle` on the aggregator to create bundle.js.
 * 4. Generate a dnt build script (build.ts) with options that force the shimmed ESM file to be output
 *    as per your manual process.
 * 5. Run dnt (via build.ts) to produce the final npm/ folder.
 */
export async function buildJsModule(inputDir: string): Promise<void> {
  const outDir = resolve(inputDir);
  await mkdir(outDir, { recursive: true });

  // Step 1: Transpile each .hql file to .hql.js.
  const hqlFiles: string[] = [];
  for await (const entry of readDir(outDir)) {
    if (entry.isFile && entry.name.endsWith(".hql")) {
      hqlFiles.push(entry.name);
    }
  }
  if (hqlFiles.length === 0) {
    console.error(`No .hql files found in ${outDir}`);
    exit(1);
  }
  for (const file of hqlFiles) {
    const filePath = join(outDir, file);
    const source = await readTextFile(filePath);
    const compiled = await compile(source, filePath, false);
    const outJS = filePath + ".js";
    await writeTextFile(outJS, compiled);
    console.log(`Transpiled ${filePath} -> ${outJS}`);
  }

  // Step 2: Create aggregator file that re-exports everything.
  // Instead of "export * as name from ..." we use "export * from ..." so that named exports remain at top level.
  const aggregatorPath = join(outDir, "all_hql_modules.ts");
  const lines = hqlFiles.map((file) => {
    return `export * from "./${file}.js";`;
  });
  await writeTextFile(aggregatorPath, lines.join("\n"));
  console.log(`Created aggregator file at ${aggregatorPath}`);

  // Step 3: Bundle the aggregator into bundle.js.
  const bundlePath = join(outDir, "bundle.js");
  console.log(`Bundling aggregator into ${bundlePath}...`);
  const bundleProc = runCmd({
    cmd: ["deno", "bundle", aggregatorPath, bundlePath],
    stdout: "inherit",
    stderr: "inherit",
  });
  const bundleStatus = await bundleProc.status();
  bundleProc.close();
  if (!bundleStatus.success) {
    console.error("deno bundle failed.");
    exit(bundleStatus.code);
  }
  console.log(`Created bundle at ${bundlePath}`);

  // Step 4: Generate dnt build script (build.ts) with your dnt config.
  // Note: We do not modify the npm folder after dnt runs.
  const dntConfigContent = `
import { build, emptyDir } from "https://deno.land/x/dnt@0.37.0/mod.ts";

await emptyDir("./npm");

await build({
  entryPoints: ["./bundle.js"],
  outDir: "./npm",
  // By default, dnt emits the final ESM package into npm/esm.
  // We leave that as is—your jsr.json will reference "./esm/bundle.js".
  shims: {
    deno: true,
  },
  scriptModule: false,
  test: false,
  package: {
    name: "",
    version: "0.0.0"
  },
});
`.trim();
  const buildTsPath = join(outDir, "build.ts");
  await writeTextFile(buildTsPath, dntConfigContent);
  console.log(`Created build.ts at ${buildTsPath}`);

  // Step 5: Run dnt build script.
  console.log("Running dnt build via build.ts...");
  const dntProc = runCmd({
    cmd: ["deno", "run", "-A", "build.ts"],
    cwd: outDir,
    stdout: "inherit",
    stderr: "inherit",
  });
  const dntStatus = await dntProc.status();
  dntProc.close();
  if (!dntStatus.success) {
    console.error("dnt build failed.");
    exit(dntStatus.code);
  }
  console.log(`dnt build succeeded. npm directory created at ${join(outDir, "npm")}`);
}
