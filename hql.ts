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

  // If any imports were remapped, write an import map file.
  if (Object.keys(importMap.imports).length > 0) {
    const importMapPath = join(projectRoot, "hql_import_map.json");
    await writeTextFile(importMapPath, JSON.stringify(importMap, null, 2));
  }

  const command = [
    execPath(),
    "run",
    ...(Object.keys(importMap.imports).length > 0
       ? [`--import-map=${join(projectRoot, "hql_import_map.json")}`]
       : []),
    "--allow-read",
    "--allow-write",
    "--allow-net",
    "--allow-env",
    "--allow-run",
    entryFile,
  ];

  await execute(command);
}

async function execute(cmd: string[]) {
  // Note: run expects a Deno.RunOptions object with a "cmd" property.
  const proc = run({ cmd });
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

interface PublishOptions {
  platform: "jsr" | "npm";
  targetDir: string;
  pkgName?: string;
  pkgVersion?: string;
}

/**
 * Helper to parse publish command arguments.
 * Accepts positional and single-dash named flags (-what, -name, -version, -where)
 * and returns an object with platform, target directory, package name, and version.
 */
function parsePublishOptions(args: string[]): PublishOptions {
  const parsed = parse(args, {
    string: ["what", "name", "version", "where"],
  });
  let platform: "jsr" | "npm" = "jsr";
  if (parsed.where) {
    const whereVal = String(parsed.where).toLowerCase();
    if (whereVal === "npm" || whereVal === "jsr") {
      platform = whereVal as "npm" | "jsr";
    } else {
      console.error("Invalid value for -where flag. Must be either 'npm' or 'jsr'.");
      Deno.exit(1);
    }
  }
  const pos = parsed._;
  let targetDir = pos.length > 0 ? String(pos[0]) : cwd();
  if (pos.length > 0 && ["npm", "jsr"].includes(String(pos[0]).toLowerCase())) {
    platform = String(pos[0]).toLowerCase() as "npm" | "jsr";
    targetDir = pos.length > 1 ? String(pos[1]) : cwd();
  }
  if (parsed.what) {
    targetDir = String(parsed.what);
  }
  if (!targetDir) {
    targetDir = cwd();
  }

  let pkgName: string | undefined;
  if (parsed.name) {
    pkgName = String(parsed.name);
  } else {
    if (platform === "npm") {
      if (pos.length >= 2 && !["npm", "jsr"].includes(String(pos[0]).toLowerCase())) {
        pkgName = String(pos[1]);
      } else if (pos.length >= 3) {
        pkgName = String(pos[2]);
      }
    } else {
      if (pos.length >= 2) {
        pkgName = String(pos[1]);
      }
      if (!pkgName) {
        pkgName = `@boraseoksoon/${basename(targetDir)}`;
      }
    }
  }

  let pkgVersion: string | undefined;
  if (parsed.version) {
    pkgVersion = String(parsed.version);
  } else {
    if (platform === "npm") {
      if (pos.length >= 3 && !["npm", "jsr"].includes(String(pos[0]).toLowerCase())) {
        pkgVersion = String(pos[2]);
      } else if (pos.length >= 4) {
        pkgVersion = String(pos[3]);
      }
    } else {
      if (pos.length >= 3) {
        pkgVersion = String(pos[2]);
      }
    }
  }
  return { platform, targetDir, pkgName, pkgVersion };
}

/**
 * Implements the publish command.
 * Supports both positional parameters and named flags:
 *   - Target directory: as first positional parameter or via -what.
 *   - Package/module name: as second positional parameter or via -name.
 *   - Version: as third positional parameter or via -version.
 *   - Platform: defaults to "jsr" but can be set via -where or by specifying "npm"/"jsr" as the first positional parameter.
 */
async function publish(args: string[]) {
  const options = parsePublishOptions(args);
  if (options.platform === "npm") {
    console.log(`Publishing npm package with:
  Directory: ${options.targetDir}
  Package Name: ${options.pkgName ?? "(auto-generated)"}
  Version: ${options.pkgVersion ?? "(auto-incremented)"}`);
    await publishNpm({ what: options.targetDir, name: options.pkgName, version: options.pkgVersion });
  } else {
    console.log(`Publishing JSR package with:
  Directory: ${options.targetDir}
  Package Name: ${options.pkgName}
  Version: ${options.pkgVersion ?? "(auto-incremented)"}`);
    await publishJSR({ what: options.targetDir, name: options.pkgName, version: options.pkgVersion });
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
