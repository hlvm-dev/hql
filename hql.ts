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

  if (command === "run") {
    let entryFile = file;
    // If the input file ends with .hql, transpile it first.
    if (file.endsWith(".hql")) {
      const absoluteInput = resolve(file);
      const source = await Deno.readTextFile(absoluteInput);
      // Use skipEvaluation=true so that evaluation is deferred to runtime.
      const compiled = await compileHQL(source, absoluteInput, true);
      // Determine output folder:
      // If the input file is under "./test/", place output into "./test/transpiled"
      let outputFolder: string;
      if (absoluteInput.includes("/test/")) {
        outputFolder = join(dirname(absoluteInput), "transpiled");
      } else {
        outputFolder = dirname(absoluteInput);
      }
      await Deno.mkdir(outputFolder, { recursive: true });
      const base = basename(absoluteInput, extname(absoluteInput));
      const outputFile = join(outputFolder, `${base}.hql.js`);
      await Deno.writeTextFile(outputFile, compiled);
      entryFile = outputFile;
    }
    // Run the (possibly transpiled) entry file.
    const cmdRun = [
      Deno.execPath(),
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-net",
      "--allow-env",
      entryFile,
    ];
    const proc = Deno.run({ cmd: cmdRun });
    const status = await proc.status();
    Deno.exit(status.code);
  } else if (command === "transpile") {
    const inputFile = file;
    const absoluteInput = resolve(inputFile);
    let outputFile = "";
    if (args.length >= 3) {
      outputFile = args[2];
      // If outputFile is not absolute, resolve it relative to the current working directory.
      if (!isAbsolute(outputFile)) {
        outputFile = resolve(join(Deno.cwd(), outputFile));
      }
    } else {
      const base = basename(absoluteInput, extname(absoluteInput));
      outputFile = join(dirname(absoluteInput), `${base}.hql.js`);
    }
    const source = await Deno.readTextFile(absoluteInput);
    // For transpile, we want to evaluate the forms (if needed); set skipEvaluation=false.
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

export { runHQLFile }
export { getExport } from "./modules/exports.ts";
