// cli.ts
import { compileHQL } from "./compiler/compiler.ts";

async function main() {
  const args = Deno.args;
  let entryFile: string;

  if (args.length === 0) {
    console.log("Usage: hql run <entry_file> or hql <entry_file>");
    Deno.exit(1);
  }
  
  // If the first argument is "run", then use the second argument as the entry file.
  if (args[0] === "run") {
    if (args.length < 2) {
      console.log("Usage: hql run <entry_file>");
      Deno.exit(1);
    }
    entryFile = args[1];
  } else {
    entryFile = args[0];
  }

  // If the entry file has a .hql extension, transpile it on demand.
  // We pass skipEvaluation=true so that the file's side effects are not executed during compilation.
  if (entryFile.endsWith(".hql")) {
    const source = await Deno.readTextFile(entryFile);
    const compiled = await compileHQL(source, entryFile, true);
    // Write the compiled JavaScript to a temporary file.
    const tempFile = await Deno.makeTempFile({ suffix: ".js" });
    await Deno.writeTextFile(tempFile, compiled);
    entryFile = tempFile;
  }

  // Spawn a new Deno process to run the (possibly transpiled) entry file.
  const cmd = [
    Deno.execPath(),
    "run",
    "--allow-read",
    "--allow-write",
    "--allow-net",
    "--allow-env",
    entryFile,
  ];
  const proc = Deno.run({ cmd });
  const status = await proc.status();
  Deno.exit(status.code);
}

if (import.meta.main) {
  main();
}
