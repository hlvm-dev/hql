// Core transpiler API entry point
import { transpileToJavascript, transpileToJavascriptWithIR } from "./hql-transpiler.ts";
import { generateDts } from "./dts-generator.ts";

export interface TranspileOptions {
  /** Enable verbose logging */
  verbose?: boolean;
  /** Show performance timing information */
  showTiming?: boolean;
  /** Base directory for resolving imports */
  baseDir?: string;
  /** Source directory */
  sourceDir?: string;
  /** Temporary directory */
  tempDir?: string;
  /** Current file being transpiled */
  currentFile?: string;
  /** Generate source maps (default: false) */
  generateSourceMap?: boolean;
  /** Original HQL source code for embedding in source map */
  sourceContent?: string;
  /** Generate TypeScript declaration file (.d.ts) content */
  generateDts?: boolean;
}

export interface TranspileResult {
  code: string;
  sourceMap?: string;
  /** TypeScript declaration file content (if generateDts was true) */
  dts?: string;
}

/**
 * Transpile HQL source code to JavaScript
 */
export async function transpile(
  source: string,
  options: TranspileOptions = {},
): Promise<TranspileResult> {
  // If .d.ts generation is requested, use the IR-returning variant
  if (options.generateDts) {
    const { code, sourceMap, ir } = await transpileToJavascriptWithIR(source, {
      verbose: options.verbose,
      showTiming: options.showTiming,
      baseDir: options.baseDir,
      sourceDir: options.sourceDir,
      tempDir: options.tempDir,
      currentFile: options.currentFile,
      generateSourceMap: options.generateSourceMap,
      sourceContent: options.sourceContent || source,
    });

    let dts: string;
    try {
      dts = generateDts(ir);
    } catch {
      dts = "export {};\n";
    }

    return { code, sourceMap, dts };
  }

  // Standard transpilation without .d.ts
  const { code, sourceMap } = await transpileToJavascript(source, {
    verbose: options.verbose,
    showTiming: options.showTiming,
    baseDir: options.baseDir,
    sourceDir: options.sourceDir,
    tempDir: options.tempDir,
    currentFile: options.currentFile,
    generateSourceMap: options.generateSourceMap,
    sourceContent: options.sourceContent || source,
  });

  return { code, sourceMap };
}

export { transpileToJavascript } from "./hql-transpiler.ts";
export { generateDts } from "./dts-generator.ts";
