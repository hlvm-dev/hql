import { prebundleHqlImportsInJs, transpileCLI } from "../../../hql/bundler.ts";
import { getPlatform } from "../../../platform/platform.ts";

const p = () => getPlatform();
const basename = (path: string) => p().path.basename(path);
const dirname = (path: string) => p().path.dirname(path);
const ensureDir = (path: string) => p().fs.ensureDir(path);
const join = (...paths: string[]) => p().path.join(...paths);
const readTextFile = (path: string) => p().fs.readTextFile(path);
const remove = (path: string, opts?: { recursive?: boolean }) => p().fs.remove(path, opts);
const resolve = (...paths: string[]) => p().path.resolve(...paths);
const stat = (path: string) => p().fs.stat(path);
const writeTextFile = (path: string, content: string) => p().fs.writeTextFile(path, content);
import { exists } from "jsr:@std/fs@1.0.13";
import { globalLogger as logger } from "../../../logger.ts";
import { checkForHqlImports, getErrorMessage } from "../../../common/utils.ts";
import {
  isHqlFile,
  isJsFile,
  isTypeScriptFile,
} from "../../../common/import-utils.ts";

/**
 * Removes the temporary build directory
 */
async function removeBuildDirectory(
  buildDir: string,
  verbose?: boolean,
): Promise<void> {
  try {
    if (await exists(buildDir)) {
      if (verbose) {
        logger.debug(`Removing build directory: ${buildDir}`);
      }
      await remove(buildDir, { recursive: true });
    }
  } catch (error) {
    // Log but don't fail the build process if cleanup fails
    console.warn(
      `\n⚠️ Failed to clean up build directory: ${
        getErrorMessage(error)
      }`,
    );
  }
}

async function checkIsFile(
  absolutePath: string,
  verbose?: boolean,
): Promise<boolean> {
  try {
    const fileInfo = await stat(absolutePath);
    const isFile = fileInfo.isFile;
    if (verbose) {
      logger.debug(
        `Input is a ${isFile ? "file" : "directory"}: ${absolutePath}`,
      );
    }
    return isFile;
  } catch (error) {
    console.error(
      `\n❌ Error accessing path: ${
        getErrorMessage(error)
      }`,
    );
    throw error;
  }
}

async function createBuildDirectories(
  buildDir: string,
  distDir: string,
  verbose?: boolean,
): Promise<void> {
  try {
    await ensureDir(buildDir);
    await ensureDir(distDir);

    if (verbose) {
      logger.debug(`Using build directory: ${buildDir}`);
      logger.debug(`Using distribution directory: ${distDir}`);
    }
  } catch (error) {
    console.error(
      `\n❌ Failed to create directories: ${
        getErrorMessage(error)
      }`,
    );
    throw error;
  }
}

async function processSourceFile(
  inputPath: string,
  outputPath: string,
  verbose?: boolean,
): Promise<{ externals?: string[] }> {
  if (isHqlFile(inputPath)) {
    await transpileCLI(inputPath, outputPath, { verbose });
    return {};
  } else if (isJsFile(inputPath)) {
    const source = await readTextFile(inputPath);
    let processedSource = source;

    if (checkForHqlImports(source)) {
      processedSource = await prebundleHqlImportsInJs(source, inputPath, {
        verbose,
      });
    }

    await ensureDir(dirname(outputPath));
    await writeTextFile(outputPath, processedSource);
    return {};
  } else if (isTypeScriptFile(inputPath)) {
    await ensureDir(dirname(outputPath));
    const externals = ["source-map", "esbuild"];
    await transpileCLI(inputPath, outputPath, {
      verbose,
      esbuildTarget: "esnext",
      external: externals,
    });
    return { externals };
  } else {
    throw new Error(`Unsupported file type: ${inputPath}`);
  }
}

async function bundleSourceFile(
  absoluteInputPath: string,
  jsOutputPath: string,
  verbose?: boolean,
): Promise<{ externals?: string[] }> {
  console.log(`\n🔨 Transpiling and bundling ${absoluteInputPath}...`);

  try {
    const result = await processSourceFile(absoluteInputPath, jsOutputPath, verbose);
    console.log(`✅ Successfully bundled to ${jsOutputPath}`);
    return result;
  } catch (error) {
    console.error(
      `\n❌ Bundling failed: ${
        getErrorMessage(error)
      }`,
    );
    throw error;
  }
}

async function prepareDistributionFiles(
  jsOutputPath: string,
  dtsOutputPath: string,
  distDir: string,
  packageName: string,
  verbose?: boolean,
  externals?: string[],
): Promise<void> {
  const esmDir = join(distDir, "esm");
  const typesDir = join(distDir, "types");

  try {
    await ensureDir(esmDir);
    await ensureDir(typesDir);

    if (await exists(jsOutputPath)) {
      const jsContent = await readTextFile(jsOutputPath);
      const esmIndexPath = join(esmDir, "index.js");
      await writeTextFile(esmIndexPath, jsContent);
      await rewriteExternalSpecifiers(esmIndexPath, verbose);
      if (verbose) {
        logger.debug(`Copied JS bundle to ${esmIndexPath}`);
      }
    } else {
      console.warn(
        `\n⚠️ Transpiled output file not found. Package may be incomplete.`,
      );
    }

    if (await exists(dtsOutputPath)) {
      const dtsContent = await readTextFile(dtsOutputPath);
      await writeTextFile(join(typesDir, "index.d.ts"), dtsContent);
      if (verbose) {
        logger.debug(
          `Copied TypeScript definitions to ${join(typesDir, "index.d.ts")}`,
        );
      }
    } else {
      await writeTextFile(
        join(typesDir, "index.d.ts"),
        `declare const _default: any;\nexport default _default;\n`,
      );
      if (verbose) {
        logger.debug(`Created minimal TypeScript definition file`);
      }
    }

    const readmePath = join(distDir, "README.md");
    if (!await exists(readmePath)) {
      await writeTextFile(
        readmePath,
        `# ${packageName}\n\nGenerated HLVM module.\n`,
      );
      if (verbose) {
        logger.debug(`Created README.md file`);
      }
    }

    // Save externals to a file for later use by package.json generation
    if (externals && externals.length > 0) {
      const externalsFile = join(distDir, ".hlvm-build-externals.json");
      await writeTextFile(
        externalsFile,
        JSON.stringify({ externals }, null, 2),
      );
      if (verbose) {
        logger.debug(`Saved externals list to ${externalsFile}`);
      }
    }
  } catch (error) {
    console.error(
      `\n❌ Error preparing distribution files: ${
        getErrorMessage(error)
      }`,
    );
    throw error;
  }
}

async function rewriteExternalSpecifiers(
  filePath: string,
  verbose?: boolean,
): Promise<void> {
  try {
    if (!await exists(filePath)) {
      return;
    }

    const original = await readTextFile(filePath);
    const rewritten = original
      .replace(
        /from\s+["']npm:([^@"']+?)(?:@[^"']+)?["']/g,
        (_match, pkg: string) => `from "${pkg}"`,
      )
      .replace(
        /import\(\s*["']npm:([^@"']+?)(?:@[^"']+)?["']\s*\)/g,
        (_match, pkg: string) => `import("${pkg}")`,
      );

    if (rewritten !== original) {
      await writeTextFile(filePath, rewritten);
      if (verbose) {
        logger.debug(`Normalized module specifiers in ${filePath}`);
      }
    }
  } catch (error) {
    console.warn(
      `\n⚠️ Failed to normalize module specifiers in ${filePath}: ${
        getErrorMessage(error)
      }`,
    );
  }
}

export async function buildJsModule(
  inputPath: string,
  options: {
    verbose?: boolean;
    dryRun?: boolean;
  } = {},
): Promise<string> {
  let buildDir = "";
  try {
    const absoluteInputPath = resolve(inputPath);
    const isFile = await checkIsFile(absoluteInputPath, options.verbose);

    const baseDir = isFile ? dirname(absoluteInputPath) : absoluteInputPath;
    const fileName = isFile
      ? basename(absoluteInputPath).replace(/\.(hql|js|ts)$/, "")
      : "index";

    const packageName = fileName !== "index" ? fileName : basename(baseDir);
    const jsOutputPath = join(buildDir, `${fileName}.js`);
    const dtsOutputPath = join(buildDir, `${fileName}.d.ts`);

    buildDir = join(baseDir, ".build");
    const distDir = join(baseDir, "dist");

    await createBuildDirectories(buildDir, distDir, options.verbose);

    const { externals } = await bundleSourceFile(absoluteInputPath, jsOutputPath, options.verbose);

    await prepareDistributionFiles(
      jsOutputPath,
      dtsOutputPath,
      distDir,
      packageName,
      options.verbose,
      externals,
    );

    console.log(`\n✅ Module build completed successfully in ${distDir}`);

    return distDir;
  } catch (error) {
    console.error(
      `\n❌ Module build failed: ${
        getErrorMessage(error)
      }`,
    );
    throw error;
  } finally {
    // Clean up the build directory regardless of success or failure
    if (buildDir) {
      await removeBuildDirectory(buildDir, options.verbose);
    }
  }
}
