// File: /modules/publish/build_js_module.ts

import {
    join,
    resolve,
    basename,
    dirname,
    mkdir,
    readTextFile,
    writeTextFile,
  } from "../platform/platform.ts";
  import { exists } from "https://deno.land/std@0.170.0/fs/mod.ts";
  import { compile } from "./compiler.ts";
  
  /**
   * Builds a JS module package from HQL source files.
   * Steps:
   *   1. Compile each .hql file -> .hql.js
   *   2. Generate mod.ts that re-exports all .hql.js files
   *   3. Create a minimal package.json, README.md, and mod.d.ts
   * 
   * Returns the output directory path.
   */
  export async function buildJsModule(options: {
    source: string;   // Directory containing .hql files
    out: string;      // Output directory for final package
    name?: string;    // Optional package name
    version?: string; // Optional package version
  }): Promise<string> {
    const sourceDir = resolve(options.source);
    const outDir = resolve(options.out);
  
    // Ensure the output directory exists
    await mkdir(outDir, { recursive: true });
  
    // 1. Compile .hql files to .hql.js
    const compiledFiles: string[] = [];
    for await (const entry of Deno.readDir(sourceDir)) {
      if (entry.isFile && entry.name.endsWith(".hql")) {
        const filePath = join(sourceDir, entry.name);
        const sourceCode = await readTextFile(filePath);
        const compiled = await compile(sourceCode, filePath, false);
        const outJS = filePath + ".js"; // e.g. add.hql -> add.hql.js
        await writeTextFile(outJS, compiled);
        compiledFiles.push(outJS);
        console.log(`Compiled ${filePath} -> ${outJS}`);
      }
    }
    if (compiledFiles.length === 0) {
      console.error(`No .hql files found in ${sourceDir}. Cannot build package.`);
      Deno.exit(1);
    }
  
    // 2. Generate mod.ts re-exporting all .hql.js files
    let modTsContent = "";
    for (const jsFile of compiledFiles) {
      const base = basename(jsFile);
      modTsContent += `export * from "./${base}";\n`;
    }
    const modTsPath = join(outDir, "mod.ts");
    await writeTextFile(modTsPath, modTsContent);
    console.log(`Generated mod.ts:\n${modTsContent}`);
  
    // 3. Create a minimal mod.d.ts, package.json, README
    const modDtsPath = join(outDir, "mod.d.ts");
    const modDtsContent = `// Auto-generated declaration file. All exports typed as any.
  declare const _default: any;
  export default _default;
  `;
    await writeTextFile(modDtsPath, modDtsContent);
    console.log("Generated mod.d.ts");
  
    const pkgName = options.name || `@boraseoksoon/${basename(sourceDir)}`;
    const pkgVersion = options.version || "0.0.1";
    const pkgJson = {
      name: pkgName,
      version: pkgVersion,
      main: "mod.ts",
      license: "MIT",
      description: "Sample test package built from HQL sources.",
    };
    const pkgPath = join(outDir, "package.json");
    await writeTextFile(pkgPath, JSON.stringify(pkgJson, null, 2));
    console.log(`Created package.json at ${pkgPath}`);
  
    const readmePath = join(outDir, "README.md");
    if (!(await exists(readmePath))) {
      await writeTextFile(
        readmePath,
        `# ${pkgName}\n\nSample test package built from HQL sources.\n`,
      );
      console.log(`Generated README.md at ${readmePath}`);
    }
  
    return outDir;
  }
  