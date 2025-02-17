// cli.ts
import { precompile } from "./compiler/precompiler.ts";
import { join } from "https://deno.land/std@0.170.0/path/mod.ts";

async function main() {
  const args = Deno.args;
  if (args.length < 2 || args[0] !== "run") {
    console.log("Usage: hql run <entry_file>");
    Deno.exit(1);
  }
  const entryFile = args[1];

  // Use Deno.cwd() as the project root.
  const rootDir = Deno.cwd();
  const cacheDir = join(rootDir, ".hqlcache");

  // Precompile all .hql files under the project root.
  const mappings = await precompile(rootDir, cacheDir);

  // Generate an import map that maps original HQL file URLs to their compiled JS URLs.
  const importMap = { imports: mappings };
  const importMapPath = join(rootDir, "hql_import_map.json");
  await Deno.writeTextFile(importMapPath, JSON.stringify(importMap, null, 2));

  // Spawn a new Deno process using the generated import map.
  const cmd = [
    Deno.execPath(),
    "run",
    `--import-map=${importMapPath}`,
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
