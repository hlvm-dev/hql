import { Env } from "./modules/env.ts";
import { repl } from "./modules/repl.ts";
import { compileHQL } from "./modules/compiler/transpiler.ts";
import { buildImportMap, buildImportMapForJS } from "./modules/importMap.ts";
import { join, dirname, basename, extname, isAbsolute, resolve } from "https://deno.land/std@0.170.0/path/mod.ts";
import { publishNpm } from "./modules/publish_npm.ts";
import { parse } from "https://deno.land/std@0.170.0/flags/mod.ts";

async function startRepl() {
  const env = new Env();
  await repl(env);
}

async function start(args: string[]) {
  if (args.length < 2) {
    console.log("Usage: hql run <file>");
    Deno.exit(1);
  }
  const file = args[1];
  const projectRoot = Deno.cwd();
  const cacheDir = join(projectRoot, ".hqlcache");
  const importMap: Record<string, any> = { imports: {} };
  let entryFile = file;
  if (file.endsWith(".hql")) {
    const absoluteInput = resolve(file);
    const source = await Deno.readTextFile(absoluteInput);
    const compiled = await compileHQL(source, absoluteInput, true);
    const outputFolder = absoluteInput.includes("/test/")
      ? join(dirname(absoluteInput), "transpiled")
      : dirname(absoluteInput);
    await Deno.mkdir(outputFolder, { recursive: true });
    const baseName = basename(absoluteInput, extname(absoluteInput));
    const outputFile = join(outputFolder, `${baseName}.hql.js`);
    await Deno.writeTextFile(outputFile, compiled);
    entryFile = outputFile;
    importMap.imports = await buildImportMap(absoluteInput, cacheDir);
  } else {
    entryFile = resolve(file);
    importMap.imports = await buildImportMapForJS(entryFile, cacheDir);
  }
  if (Object.keys(importMap.imports).length > 0) {
    const importMapPath = join(projectRoot, "hql_import_map.json");
    await Deno.writeTextFile(importMapPath, JSON.stringify(importMap, null, 2));
    const command = [
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
    await execute(command);
  } else {
    const command = [
      Deno.execPath(),
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-net",
      "--allow-env",
      "--allow-run",
      entryFile,
    ];
    await execute(command);
  }
}

async function transpile(args: string[]) {
  if (args.length < 2) {
    console.log("Usage: hql transpile <inputFile> [outputFile]");
    Deno.exit(1);
  }
  const inputFile = args[1];
  const absoluteInput = resolve(inputFile);
  const projectRoot = Deno.cwd();
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
  const source = await Deno.readTextFile(absoluteInput);
  const compiled = await compileHQL(source, absoluteInput, false);
  await Deno.mkdir(dirname(outputFile), { recursive: true });
  await Deno.writeTextFile(outputFile, compiled);
  console.log(`Transpiled ${absoluteInput} -> ${outputFile}`);
}

async function execute(cmd: string[]) {
  const proc = Deno.run({ cmd });
  const status = await proc.status();
  proc.close();
  Deno.exit(status.code);
}

async function main() {
  const parsed = parse(Deno.args);
  const command = parsed._[0];
  switch (command) {
    case "repl":
      await startRepl();
      break;
    case "run":
      await start(Deno.args);
      break;
    case "transpile":
      await transpile(Deno.args);
      break;
    case "publish": {
      let what: string;
      let pkgName: string | undefined;
      let version: string | undefined;
      if (parsed.what) {
        what = String(parsed.what);
      } else if (parsed._.length >= 2) {
        what = String(parsed._[1]);
      } else {
        console.log("Usage: hql publish <outputDir> [packageName] [version]");
        Deno.exit(1);
      }
      if (parsed.name) {
        pkgName = String(parsed.name);
      } else if (parsed._.length >= 3) {
        pkgName = String(parsed._[2]);
      }
      if (!pkgName) {
        const npmUser = await getNpmUsername();
        const dirName = what.split("/").pop() || "hql-package";
        pkgName = npmUser ? `@${npmUser}/${dirName}` : dirName;
      }
      if (parsed.version) {
        version = String(parsed.version);
      } else if (parsed._.length >= 4) {
        version = String(parsed._[3]);
      } else {
        version = undefined;
      }
      await publishNpm({ what, name: pkgName, version });
      break;
    }
    default:
      console.log("Unknown command.");
      console.log("Usage:");
      console.log("  hql repl");
      console.log("  hql run <file>");
      console.log("  hql transpile <inputFile> [outputFile]");
      console.log("  Minimal publish: deno run -A hql.ts publish <outputDir> [packageName] [version]");
      console.log("  Named flags: deno run -A hql.ts publish --what <outputDir> [--name <packageName>] [--version <version>]");
      Deno.exit(1);
  }
}

async function getNpmUsername(): Promise<string | undefined> {
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

if (import.meta.main) {
  main();
}

export { getExport } from "./modules/exports.ts";
export { runHQLFile } from "./modules/compiler/transpiler.ts";
