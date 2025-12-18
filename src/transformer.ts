// File: src/transformer.ts
// ------------------------------------------------
// HQL transformer with improved source map and error handling support
// ------------------------------------------------

import { transformToIR } from "./transpiler/pipeline/hql-ast-to-hql-ir.ts";
import { globalLogger as logger } from "./logger.ts";
import { Environment } from "./environment.ts";
import { HQLError, TransformError } from "./common/error.ts";
import { getErrorMessage } from "./common/utils.ts";
import { Timer } from "./common/timer.ts";
import type { HQLNode } from "./transpiler/type/hql_ast.ts";
import {
  extractImportInfo,
  findExistingImports,
  findExternalModuleReferences,
  importSourceRegistry,
} from "./common/import-utils.ts";

/**
 * Options controlling transformation behavior.
 */
export interface TransformOptions {
  verbose?: boolean;
  replMode?: boolean;
  sourceFile?: string;
  currentFile?: string;
  /** Whether to generate source maps (default: false) */
  generateSourceMap?: boolean;
  /** Original HQL source code for embedding in source map */
  sourceContent?: string;
  /** Enable TypeScript type checking (default: true when types present) */
  typeCheck?: boolean;
  /** Fail compilation on type errors (default: false - emit anyway) */
  failOnTypeErrors?: boolean;
}

/**
 * Deduplicate and inject missing imports in AST.
 */
function processImportNodes(ast: HQLNode[], env: Environment): HQLNode[] {
  const existing = new Map<string, string>(findExistingImports(ast));
  const references = findExternalModuleReferences(ast, env);
  const processed = new Set(existing.keys());
  const importNodes: HQLNode[] = [];

  for (const reference of references) {
    if (processed.has(reference) || !importSourceRegistry.has(reference)) {
      continue;
    }
    const importPath = importSourceRegistry.get(reference);
    if (!importPath) continue;
    importNodes.push({
      type: "list",
      elements: [
        { type: "symbol", name: "import" },
        { type: "symbol", name: reference },
        { type: "symbol", name: "from" },
        { type: "literal", value: importPath },
      ],
    });
    processed.add(reference);
  }

  const filtered = ast.filter((node) => {
    const [modName] = extractImportInfo(node);
    if (!modName) return true;
    if (processed.has(modName) && !existing.has(modName)) {
      return false;
    }
    processed.add(modName);
    return true;
  });

  return [...importNodes, ...filtered];
}

/**
 * Transforms HQL AST nodes through all pipeline phases and outputs TS code.
 */
// Update transformAST function in transformer.ts
export async function transformAST(
  astNodes: HQLNode[],
  currentDir: string,
  options: TransformOptions = {},
  env?: Environment,
): Promise<{ code: string; sourceMap?: string; ir?: unknown }> {
  try {
    const timer = new Timer(logger);

    logger.debug(`Starting transformation: ${astNodes.length} nodes`);
    timer.phase("initialization");

    // Use injected env or create a new standard one (stateless fallback)
    const contextEnv = env || await Environment.createStandard();

    timer.phase("environment init");

    // Note: Macros are already expanded in hql-transpiler.ts before calling transformAST.
    // Second expansion here was causing macros to run twice (BUG #1).
    // Removed duplicate expansion - astNodes already have expanded macros.

    const imports = processImportNodes(astNodes, contextEnv);

    timer.phase("import processing");

    const ir = transformToIR(imports, currentDir);

    timer.phase("IR transformation");

    // Validate semantics BEFORE optimization (BUG #3 Fix)
    // Industry standard: TypeScript, Rust, Go all validate before optimizing
    // This ensures error messages show original code with accurate line numbers
    // Validation includes: duplicate declarations, TDZ violations, etc.
    const { validateSemantics } = await import("./transpiler/pipeline/semantic-validator.ts");
    validateSemantics(ir);

    timer.phase("semantic validation");

    // Note: Pattern-specific optimizers (for-loop-optimizer, pipeline-optimizer) were removed.
    // They were band-aids for eager evaluation. The proper solution is lazy sequences.
    // TCO optimization is kept (in ir-to-typescript.ts) as it's a legitimate compiler technique.

    // Use currentFile for source map references, not the directory
    const sourceFilePath = options.currentFile || "<anonymous>.hql";
    const { generateJavaScript } = await import("./transpiler/pipeline/js-code-generator.ts");

    // Single TypeScript pipeline for ALL code
    // Type checking enabled by default, can be disabled with typeCheck: false
    const result = await generateJavaScript(ir, {
      sourceFilePath: sourceFilePath,
      currentFilePath: options.currentFile,
      generateSourceMap: options.generateSourceMap,
      sourceContent: options.sourceContent,
      typeCheck: options.typeCheck !== false,
      failOnTypeErrors: options.failOnTypeErrors,
    });

    // Log type errors if any
    if (result.typeErrors && result.typeErrors.length > 0) {
      for (const err of result.typeErrors) {
        logger.warn(`Type error at ${sourceFilePath}:${err.line}:${err.column}: ${err.message}`);
      }
    }

    const javascript = result;

    timer.phase("JS code generation");

    timer.breakdown();

    return {
      code: javascript.code,
      sourceMap: javascript.sourceMap,
      ir: ir,
    };
  } catch (error) {
    // If it's already an HQLError (ValidationError, ParseError, etc.), preserve it
    // Don't wrap it in TransformError which would lose the original error code and info
    if (error instanceof HQLError) {
      // Ensure file path is set if not present
      if (!error.sourceLocation.filePath && options.currentFile) {
        error.sourceLocation.filePath = options.currentFile;
      } else if (!error.sourceLocation.filePath && options.sourceFile) {
        error.sourceLocation.filePath = options.sourceFile;
      }
      throw error;
    }

    // For non-HQL errors, wrap in TransformError
    throw new TransformError(
      `Transformation failed: ${
        getErrorMessage(error)
      }`,
      "Transformation failed",
      {
        filePath: options.currentFile || options.sourceFile || currentDir,
        originalError: error instanceof Error ? error : undefined,
      },
    );
  }
}
