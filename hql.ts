// hql.ts
import { compileHQL } from "./modules/compiler/compiler.ts";
import {
  join,
  dirname,
  basename,
  extname,
  isAbsolute,
  resolve,
} from "https://deno.land/std@0.170.0/path/mod.ts";
import { runHQLFile } from "./modules/compiler/transpiler.ts";

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
      // Convert input file to absolute path (based on current working directory).
      const absoluteInput = resolve(file);
      // Read and compile the HQL source.
      const source = await Deno.readTextFile(absoluteInput);
      const compiled = await compileHQL(source, absoluteInput);

      // If the input file is under "./test/", place output in "./test/transpiled".
      let outputFolder: string;
      if (absoluteInput.includes("/test/")) {
        outputFolder = join(dirname(absoluteInput), "transpiled");
      } else {
        // Otherwise, place it in the same folder as the input file.
        outputFolder = dirname(absoluteInput);
      }
      await Deno.mkdir(outputFolder, { recursive: true });

      // Build the output file name: base + ".hql.js"
      const base = basename(absoluteInput, extname(absoluteInput));
      const outputFile = join(outputFolder, `${base}.hql.js`);
      await Deno.writeTextFile(outputFile, compiled);
      entryFile = outputFile;
    }
    // Now run the (possibly transpiled) entry file via Deno.
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
    // "hql transpile <inputFile> [outputFile]"
    const inputFile = file;
    const absoluteInput = resolve(inputFile);

    let outputFile = "";
    if (args.length >= 3) {
      // If user provided an output file, check if it is absolute or relative.
      outputFile = args[2];
      if (!isAbsolute(outputFile)) {
        // Resolve relative to the current working directory.
        outputFile = resolve(join(Deno.cwd(), outputFile));
      }
    } else {
      // No output file given -> place the output in the same folder as input, with .hql.js appended.
      const base = basename(absoluteInput, extname(absoluteInput));
      outputFile = join(dirname(absoluteInput), `${base}.hql.js`);
    }

    // Read and compile.
    const source = await Deno.readTextFile(absoluteInput);
    const compiled = await compileHQL(source, absoluteInput);

    // Ensure the folder for output exists.
    await Deno.mkdir(dirname(outputFile), { recursive: true });

    // Write the transpiled file.
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

// Re‐export from your modules:
export { runHQLFile }
export { getExport } from "./modules/exports.ts";
