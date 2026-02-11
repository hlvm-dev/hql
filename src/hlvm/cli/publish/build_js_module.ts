import { prebundleHqlImportsInJs, transpileCLI } from "../../../hql/bundler.ts";
import { RuntimeError } from "../../../common/error.ts";
import {
  basename,
  dirname,
  ensureDir,
  exists,
  join,
  readTextFile,
  remove,
  resolve,
  stat,
  writeTextFile,
} from "../utils/platform-helpers.ts";
import { globalLogger as logger } from "../../../logger.ts";
import { log } from "../../api/log.ts";
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
    log.raw.warn(
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
    log.raw.error(
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
    log.raw.error(
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
    throw new RuntimeError(`Unsupported file type: ${inputPath}`);
  }
}

async function bundleSourceFile(
  absoluteInputPath: string,
  jsOutputPath: string,
  verbose?: boolean,
): Promise<{ externals?: string[] }> {
  log.raw.log(`\n🔨 Transpiling and bundling ${absoluteInputPath}...`);

  try {
    const result = await processSourceFile(absoluteInputPath, jsOutputPath, verbose);
    log.raw.log(`✅ Successfully bundled to ${jsOutputPath}`);
    return result;
  } catch (error) {
    log.raw.error(
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
  _externals?: string[],
): Promise<void> {
  const esmDir = join(distDir, "esm");
  const typesDir = join(distDir, "types");

  try {
    await ensureDir(esmDir);
    await ensureDir(typesDir);

    const readmePath = join(distDir, "README.md");
    const [hasJs, hasDts, hasReadme] = await Promise.all([
      exists(jsOutputPath),
      exists(dtsOutputPath),
      exists(readmePath),
    ]);

    if (hasJs) {
      const jsContent = await readTextFile(jsOutputPath);
      const esmIndexPath = join(esmDir, "index.js");
      await writeTextFile(esmIndexPath, jsContent);
      await rewriteExternalSpecifiers(esmIndexPath, verbose);
      if (verbose) {
        logger.debug(`Copied JS bundle to ${esmIndexPath}`);
      }
    } else {
      log.raw.warn(
        `\n⚠️ Transpiled output file not found. Package may be incomplete.`,
      );
    }

    if (hasDts) {
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

    if (!hasReadme) {
      await writeTextFile(
        readmePath,
        `# ${packageName}\n\nGenerated HLVM module.\n`,
      );
      if (verbose) {
        logger.debug(`Created README.md file`);
      }
    }

  } catch (error) {
    log.raw.error(
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
    log.raw.warn(
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

    buildDir = join(baseDir, ".build");
    const jsOutputPath = join(buildDir, `${fileName}.js`);
    const dtsOutputPath = join(buildDir, `${fileName}.d.ts`);
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

    log.raw.log(`\n✅ Module build completed successfully in ${distDir}`);

    return distDir;
  } catch (error) {
    log.raw.error(
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
