// hql.ts
import { compileHQL } from "./modules/compiler/compiler.ts";
import { runHQLFile } from "./modules/compiler/transpiler.ts";
import { join, dirname, basename, extname, isAbsolute, resolve } from "https://deno.land/std@0.170.0/path/mod.ts";
import { buildImportMap } from "./modules/lazy_import_map.ts";

async function buildImportMapForJS(entryJs: string, cacheDir: string): Promise<Record<string, string>> {
  const mappings: Record<string, string> = {};
  const absEntryJs = resolve(entryJs);
  const content = await Deno.readTextFile(absEntryJs);
  // Regex to match static import statements ending with ".hql"
  const regex = /import\s+.*?from\s+["'](.+?\.hql)["']/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const hqlPath = match[1];
    const importedAbs = resolve(dirname(absEntryJs), hqlPath);
    const subMap = await buildImportMap(importedAbs, cacheDir);
    Object.assign(mappings, subMap);
  }
  return mappings;
}

async function main() {
  const args = Deno.args;
  if (args.length < 2) {
    console.log("Usage:");
    console.log("  hql run <file>");
    console.log("  hql transpile <inputFile> [outputFile]");
    Deno.exit(1);
  }

  const command = args[0];
  const file = args[1];

  // Define project root and cache directory.
  const projectRoot = Deno.cwd();
  const cacheDir = join(projectRoot, ".hqlcache");

  if (command === "run") {
    let entryFile = file;
    let importMap: Record<string, any> | null = null;

    if (file.endsWith(".hql")) {
      // Entry file is an HQL file.
      const absoluteInput = resolve(file);
      const source = await Deno.readTextFile(absoluteInput);

      // Use skipEvaluation=true so that side effects are deferred.
      const compiled = await compileHQL(source, absoluteInput, true);

      // Determine output folder.
      let outputFolder: string;
      if (absoluteInput.includes("/test/")) {
        outputFolder = join(dirname(absoluteInput), "transpiled");
      } else {
        outputFolder = dirname(absoluteInput);
      }
      await Deno.mkdir(outputFolder, { recursive: true });
      const baseName = basename(absoluteInput, extname(absoluteInput));
      // Write transpiled file with a recognized extension.
      const outputFile = join(outputFolder, `${baseName}.hql.js`);
      await Deno.writeTextFile(outputFile, compiled);
      entryFile = outputFile;

      // Build import map for the entry HQL file (and its dependencies).
      importMap = { imports: await buildImportMap(absoluteInput, cacheDir) };
    } else {
      // Entry file is a JS file.
      entryFile = resolve(file);
      // Build import map for any .hql files statically imported from the JS file.
      const mappings = await buildImportMapForJS(entryFile, cacheDir);
      if (Object.keys(mappings).length > 0) {
        importMap = { imports: mappings };
      }
    }

    if (importMap) {
      // Write the generated import map to disk.
      const importMapPath = join(projectRoot, "hql_import_map.json");
      await Deno.writeTextFile(importMapPath, JSON.stringify(importMap, null, 2));
      // Spawn a new Deno process with the generated import map.
      const cmd = [
        Deno.execPath(),
        "run",
        `--import-map=${importMapPath}`,
        "--allow-read",
        "--allow-write",
        "--allow-net",
        "--allow-env",
        "--allow-run",
        entryFile,
      ];
      const proc = Deno.run({ cmd });
      const status = await proc.status();
      Deno.exit(status.code);
    } else {
      // No .hql dependency found: run the entry file directly.
      const cmdRun = [
        Deno.execPath(),
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-net",
        "--allow-env",
        "--allow-run",
        entryFile,
      ];
      const proc = Deno.run({ cmd: cmdRun });
      const status = await proc.status();
      Deno.exit(status.code);
    }
  } else if (command === "transpile") {
    const inputFile = file;
    const absoluteInput = resolve(inputFile);
    let outputFile = "";
    if (args.length >= 3) {
      outputFile = args[2];
      if (!isAbsolute(outputFile)) {
        outputFile = resolve(join(projectRoot, outputFile));
      }
    } else {
      const baseName = basename(absoluteInput, extname(absoluteInput));
      outputFile = join(dirname(absoluteInput), `${baseName}.hql.js`);
    }
    const source = await Deno.readTextFile(absoluteInput);
    // In transpile mode, perform full evaluation.
    const compiled = await compileHQL(source, absoluteInput, false);
    await Deno.mkdir(dirname(outputFile), { recursive: true });
    await Deno.writeTextFile(outputFile, compiled);
    console.log(`Transpiled ${absoluteInput} -> ${outputFile}`);
  } else {
    console.log("Unknown command.");
    console.log("Usage:");
    console.log("  hql run <file>");
    console.log("  hql transpile <inputFile> [outputFile]");
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}

export { runHQLFile };
export { getExport } from "./modules/exports.ts";
