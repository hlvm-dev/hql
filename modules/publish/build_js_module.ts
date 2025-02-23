import {
    join,
    resolve,
    basename,
    dirname,
    mkdir,
    readTextFile,
    writeTextFile,
    exit
  } from "../../platform/platform.ts";
  
  import { exists } from "https://deno.land/std@0.170.0/fs/mod.ts";
  import { compile } from "../compiler.ts";
  import * as esbuild from "https://deno.land/x/esbuild@v0.17.11/mod.js";
  
  /**
  
  /**
   * Builds a finalized JavaScript module package from HQL source files.
   *
   * Options:
   *   - source: directory containing your .hql files.
   *   - out: output directory for the final JS module package.
   *   - name: (optional) package name; defaults to "@boraseoksoon/<basename(source)>".
   *   - version: (optional) package version; defaults to "0.0.1".
   *
   * The function:
   *   1. Compiles each .hql file into a .js file.
   *   2. Generates a mod.ts re‑export file and a minimal mod.d.ts.
   *   3. Creates sample package.json and README.md.
   *   4. Uses esbuild to bundle mod.ts and its dependencies into bundle.js.
   *
   * Returns the output directory path.
   */
  export async function buildJsModule(options: {
    source: string;
    out: string;
    name?: string;
    version?: string;
  }): Promise<string> {
    const sourceDir = resolve(options.source);
    const outDir = resolve(options.out);
  
    // Ensure the output directory exists.
    await mkdir(outDir, { recursive: true });
  
    // Compile all .hql files from the source directory.
    const compiledFiles: { fileName: string; outFile: string }[] = [];
    for await (const entry of Deno.readDir(sourceDir)) {
      if (entry.isFile && entry.name.endsWith(".hql")) {
        const filePath = join(sourceDir, entry.name);
        const sourceCode = await readTextFile(filePath);
        // Compile the HQL file.
        const compiled = await compile(sourceCode, filePath, false);
        // Write compiled output as "<filename>.hql.js" in the output directory.
        const outFile = join(outDir, entry.name + ".js");
        await writeTextFile(outFile, compiled);
        compiledFiles.push({ fileName: entry.name, outFile });
        console.log(`Compiled ${filePath} -> ${outFile}`);
      }
    }
  
    if (compiledFiles.length === 0) {
      console.error("No .hql files found in source directory:", sourceDir);
      exit(1);
    }
  
    // Generate mod.ts that re-exports all compiled modules.
    let modTsContent = "";
    for (const { outFile } of compiledFiles) {
      const base = basename(outFile);
      modTsContent += `export * from "./${base}";\n`;
    }
    const modTsPath = join(outDir, "mod.ts");
    await writeTextFile(modTsPath, modTsContent);
    console.log(`Generated mod.ts:\n${modTsContent}`);
  
    // Generate a minimal mod.d.ts.
    const modDtsContent = `// Auto-generated declaration file. All exports are typed as any.
  declare const _default: any;
  export default _default;
  `;
    const modDtsPath = join(outDir, "mod.d.ts");
    await writeTextFile(modDtsPath, modDtsContent);
    console.log("Generated mod.d.ts");
  
    // Create sample package.json.
    const pkgName = options.name || `@boraseoksoon/${basename(sourceDir)}`;
    const pkgVersion = options.version || "0.0.1";
    const pkg = {
      name: pkgName,
      version: pkgVersion,
      main: "bundle.js",  // We will update this after bundling.
      license: "MIT",
      description: "Sample test HQL module built as a JS package.",
    };
    const pkgPath = join(outDir, "package.json");
    await writeTextFile(pkgPath, JSON.stringify(pkg, null, 2));
    console.log("Created package.json at", pkgPath);
  
    // Create README.md if not exists.
    const readmePath = join(outDir, "README.md");
    if (!(await exists(readmePath))) {
      const readmeContent = `# ${pkgName}\n\nThis is a sample test package built from HQL sources.\n`;
      await writeTextFile(readmePath, readmeContent);
      console.log("Generated README.md at", readmePath);
    }
  
    // Bundle the module using esbuild.
    const bundleOutFile = join(outDir, "bundle.js");
    console.log("Bundling final JS module using esbuild...");
    await esbuild.build({
      entryPoints: [modTsPath],
      bundle: true,
      outfile: bundleOutFile,
      platform: "neutral",
      format: "esm",
      minify: false,
    });
    esbuild.stop();
    console.log(`Bundled final module to ${bundleOutFile}`);
  
    // Update package.json to point to the bundle.
    pkg.main = "bundle.js";
    await writeTextFile(pkgPath, JSON.stringify(pkg, null, 2));
    console.log("Updated package.json to point to bundle.js");
  
    return outDir;
  }
  