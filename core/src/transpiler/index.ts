// Core transpiler API entry point
import { transpileToJavascript } from "./hql-transpiler.ts";

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
}

export interface TranspileResult {
  code: string;
  sourceMap?: string;
}

/**
 * Transpile HQL source code to JavaScript
 */
export async function transpile(
  source: string,
  options: TranspileOptions = {},
): Promise<TranspileResult> {
  const { code, sourceMap } = await transpileToJavascript(source, {
    verbose: options.verbose,
    showTiming: options.showTiming,
    baseDir: options.baseDir,
    sourceDir: options.sourceDir,
    tempDir: options.tempDir,
    currentFile: options.currentFile,
    generateSourceMap: options.generateSourceMap,
    sourceContent: options.sourceContent || source, // Default to input source if not provided
  });

  return { code, sourceMap };
}

export { transpileToJavascript } from "./hql-transpiler.ts";
