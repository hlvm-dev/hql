import { Env } from "./modules/env.ts";
import { repl } from "./modules/repl.ts";
import { publish } from "./modules/publish/publish.ts";
import { compile } from "./modules/compiler.ts";
import { buildImportMap, buildImportMapForJS } from "./modules/importMap.ts";
import {
  join,
  dirname,
  basename,
  extname,
  isAbsolute,
  resolve,
  cwd,
  readTextFile,
  mkdir,
  writeTextFile,
  execPath, 
  runCmd
} from "./platform/platform.ts";

async function startRepl() {
  const env = new Env();
  await repl(env);
}

async function startCmd(args: string[]) {
  if (args.length < 2) {
    console.log("Usage:");
    console.log("  hql run <file>");
    Deno.exit(1);
  }
  const file = args[1];
  const projectRoot = cwd();
  const cacheDir = join(projectRoot, ".hqlcache");
  const importMap: Record<string, any> = { imports: {} };
  let entryFile = file;

  if (file.endsWith(".hql")) {
    const absoluteInput = resolve(file);
    const source = await readTextFile(absoluteInput);
    const compiled = await compile(source, absoluteInput, true);
    const outputFolder = absoluteInput.includes("/test/")
      ? join(dirname(absoluteInput), "transpiled")
      : dirname(absoluteInput);
    await mkdir(outputFolder, { recursive: true });
    const baseName = basename(absoluteInput, extname(absoluteInput));
    const outputFile = join(outputFolder, `${baseName}.hql.js`);
    await writeTextFile(outputFile, compiled);
    entryFile = outputFile;
    importMap.imports = await buildImportMap(absoluteInput, cacheDir);
  } else {
    entryFile = resolve(file);
    importMap.imports = await buildImportMapForJS(entryFile, cacheDir);
  }

  // If any imports were remapped, write an import map file.
  let importMapPath: string | undefined;
  if (Object.keys(importMap.imports).length > 0) {
    importMapPath = join(projectRoot, "hql_import_map.json");
    await writeTextFile(importMapPath, JSON.stringify(importMap, null, 2));
  }

  const command = [
    execPath(),
    "run",
    ...(importMapPath ? [`--import-map=${importMapPath}`] : []),
    "--allow-read",
    "--allow-write",
    "--allow-net",
    "--allow-env",
    "--allow-run",
    entryFile,
  ];

  const process = runCmd({ cmd: command });
  const status = await process.status();

  if (importMapPath) {
    await Deno.remove(importMapPath);
  }
  
  Deno.exit(status.code);
}

async function transpile(args: string[]) {
  if (args.length < 2) {
    console.log("Usage:");
    console.log("  hql transpile <inputFile> [outputFile]");
    Deno.exit(1);
  }
  const inputFile = args[1];
  const absoluteInput = resolve(inputFile);
  const projectRoot = cwd();
  let outputFile: string;
  if (args.length >= 3) {
    outputFile = args[2];
    if (!isAbsolute(outputFile)) {
      outputFile = resolve(join(projectRoot, outputFile));
    }
  } else {
    const baseName = basename(absoluteInput, extname(absoluteInput));
    outputFile = join(dirname(absoluteInput), `${baseName}.hql.js`);
  }
  const source = await readTextFile(absoluteInput);
  const compiled = await compile(source, absoluteInput, false);
  await mkdir(dirname(outputFile), { recursive: true });
  await writeTextFile(outputFile, compiled);
  console.log(`Transpiled ${absoluteInput} -> ${outputFile}`);
}

async function main() {
  const args = Deno.args;
  
  if (args.length === 0) {
    await startRepl();
    return;
  }

  const command = args[0];
  switch (command) {
    case "repl":
      await startRepl();
      break;
    case "run":
      await startCmd(args);
      break;
    case "transpile":
      await transpile(args);
      break;
    case "publish":
      await publish(args.slice(1));
      break;
    default:
      console.log("Unknown command.");
      console.log("Usage:");
      console.log("  hql repl");
      console.log("  hql run <file>");
      console.log("  hql transpile <inputFile> [outputFile]");
      console.log("  hql publish [targetDir] [-name <packageName>] [-version <version>] [-where <npm|jsr>]");
      Deno.exit(1);
  }
}

if ((import.meta as { main?: boolean }).main) {
  main();
}

export { exportHqlModules, getHqlModule } from "./modules/export.ts";
