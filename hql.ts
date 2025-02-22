import { Env } from "./modules/env.ts";
import { repl } from "./modules/repl.ts";
import { compileHQL } from "./modules/compiler.ts";
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
  runCmd as run
} from "./platform/platform.ts";
import { publishNpm } from "./modules/publish_npm.ts";
import { publishJSR } from "./modules/publish_jsr.ts";
import { parse } from "https://deno.land/std@0.170.0/flags/mod.ts";

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
    const compiled = await compileHQL(source, absoluteInput, true);
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

  if (Object.keys(importMap.imports).length > 0) {
    const importMapPath = join(projectRoot, "hql_import_map.json");
    await writeTextFile(importMapPath, JSON.stringify(importMap, null, 2));
    const command = [
      execPath(),
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
      execPath(),
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

async function execute(cmd: string[]) {
  const proc = run(cmd);
  const status = await proc.status();
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
  const compiled = await compileHQL(source, absoluteInput, false);
  await mkdir(dirname(outputFile), { recursive: true });
  await writeTextFile(outputFile, compiled);
  console.log(`Transpiled ${absoluteInput} -> ${outputFile}`);
}

/**
 * Implements the publish command.
 *
 * Accepts positional and named flags with a single dash:
 *   - Target directory: either as the first positional parameter or via -what.
 *   - Package/module name: positional (second parameter) or via -name.
 *   - Version: positional (third parameter) or via -version.
 *   - Platform: default is "jsr" but can be overridden with -where or by
 *     specifying "npm" or "jsr" as the first positional argument.
 *
 * Examples:
 *   hql publish target_module_directory
 *   hql publish -name "ayo" -version 1.0.0
 *   hql publish npm target_module_directory
 *   hql publish -where jsr
 */
async function publish(args: string[]) {
  // Parse provided flags (using single-dash names)
  const parsed = parse(args, {
    string: ["what", "name", "version", "where"],
  });

  // Determine target platform; default is "jsr"
  let targetPlatform: "jsr" | "npm" = "jsr";
  if (parsed.where) {
    const whereVal = String(parsed.where).toLowerCase();
    if (whereVal === "npm" || whereVal === "jsr") {
      targetPlatform = whereVal as "npm" | "jsr";
    } else {
      console.error("Invalid value for -where flag. Must be either 'npm' or 'jsr'.");
      Deno.exit(1);
    }
  }

  // Process positional parameters (if any)
  const pos = parsed._;
  let targetDir: string = "";
  if (pos.length > 0) {
    const first = String(pos[0]).toLowerCase();
    if (first === "npm" || first === "jsr") {
      targetPlatform = first as "npm" | "jsr";
      if (pos.length > 1) {
        targetDir = String(pos[1]);
      } else {
        targetDir = cwd();
      }
    } else {
      targetDir = String(pos[0]);
    }
  } else {
    targetDir = cwd();
  }
  // Override with -what flag if provided
  if (parsed.what) {
    targetDir = String(parsed.what);
  }
  if (!targetDir) {
    targetDir = cwd();
  }

  // Determine package (module) name
  let pkgName: string | undefined;
  if (parsed.name) {
    pkgName = String(parsed.name);
  } else {
    if (targetPlatform === "npm") {
      if (pos.length >= 2 && (String(pos[0]).toLowerCase() !== "npm" && String(pos[0]).toLowerCase() !== "jsr")) {
        pkgName = String(pos[1]);
      } else if (pos.length >= 3) {
        pkgName = String(pos[2]);
      }
      // If still undefined, publishNpm will auto-generate a name.
    } else { // for jsr
      if (pos.length >= 2) {
        pkgName = String(pos[1]);
      }
      if (!pkgName) {
        pkgName = `@boraseoksoon/${basename(targetDir)}`;
      }
    }
  }

  // Determine version (if provided)
  let pkgVersion: string | undefined;
  if (parsed.version) {
    pkgVersion = String(parsed.version);
  } else {
    if (targetPlatform === "npm") {
      if (pos.length >= 3 && (String(pos[0]).toLowerCase() !== "npm" && String(pos[0]).toLowerCase() !== "jsr")) {
        pkgVersion = String(pos[2]);
      } else if (pos.length >= 4) {
        pkgVersion = String(pos[3]);
      }
      // Otherwise, leave undefined to trigger auto versioning.
    } else { // for jsr
      if (pos.length >= 3) {
        pkgVersion = String(pos[2]);
      }
      // Otherwise, leave undefined.
    }
  }

  if (targetPlatform === "npm") {
    console.log(`Publishing npm package with:
  Directory: ${targetDir}
  Package Name: ${pkgName ?? "(auto-generated)"}
  Version: ${pkgVersion ?? "(auto-incremented)"}`);
    await publishNpm({ what: targetDir, name: pkgName, version: pkgVersion });
  } else {
    console.log(`Publishing JSR package with:
  Directory: ${targetDir}
  Package Name: ${pkgName}
  Version: ${pkgVersion ?? "(auto-incremented)"}`);
    await publishJSR({ what: targetDir, name: pkgName, version: pkgVersion });
  }
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
