// hql.ts
import { compileHQL } from "./modules/compiler/compiler.ts";
import { runHQLFile } from "./modules/compiler/transpiler.ts";
import {
  join,
  dirname,
  basename,
  extname,
  isAbsolute,
  resolve,
} from "https://deno.land/std@0.170.0/path/mod.ts";
import { buildImportMap, buildImportMapForJS } from "./modules/import_map.ts";

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
    let importMap: Record<string, any> = { imports: {} };

    if (file.endsWith(".hql")) {
      // Entry file is an HQL file.
      const absoluteInput = resolve(file);
      const source = await Deno.readTextFile(absoluteInput);

      // Compile using skipEvaluation=true (so only definitions are recorded)
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
      const outputFile = join(outputFolder, `${baseName}.hql.js`);
      await Deno.writeTextFile(outputFile, compiled);
      entryFile = outputFile;

      // Build an import map for the dependency graph of the entry HQL file.
      importMap.imports = await buildImportMap(absoluteInput, cacheDir);
    } else {
      // Entry file is a JS file.
      entryFile = resolve(file);
      // Build an import map by scanning the JS file for static HQL imports.
      importMap.imports = await buildImportMapForJS(entryFile, cacheDir);
    }

    if (Object.keys(importMap.imports).length > 0) {
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
      // No HQL dependencies found—run the entry file directly.
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
    // Full evaluation for transpile mode.
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
