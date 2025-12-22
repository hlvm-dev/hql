// hql-runtime.ts - Stateful runtime for HQL REPL environment
// Manages macro state and provides runtime features while using pure compiler

import { Environment } from "../environment.ts";
import { parse } from "../transpiler/pipeline/parser.ts";
import { transformSyntax } from "../transpiler/pipeline/syntax-transformer.ts";
import { defineMacro } from "../s-exp/macro.ts";
import type {
  CompilerContext,
  CompilerOptions,
  MacroDefinition,
  MacroRegistry,
} from "../transpiler/compiler-context.ts";
import {
  expandHql,
  transpileToJavascript,
} from "../transpiler/hql-transpiler.ts";
import type { MacroFn } from "../environment.ts";
import {
  createList,
  createSymbol,
  isList,
  isLiteral,
  isSymbol,
  type SExp,
  type SList,
} from "../s-exp/types.ts";
import { globalLogger as logger } from "../logger.ts";
import { cwd as platformCwd } from "../platform/platform.ts";
import { loadSystemMacros } from "../transpiler/hql-transpiler.ts";

/**
 * Convert S-expression to JavaScript object
 * @private
 */
function toJs(sexp: SExp): unknown {
  if (isSymbol(sexp)) {
    return sexp.name;
  } else if (isLiteral(sexp)) {
    return sexp.value;
  } else if (isList(sexp)) {
    return sexp.elements.map(toJs);
  }
  return sexp;
}

/**
 * HQL Runtime - Manages stateful aspects of HQL in REPL environment
 *
 * This class provides:
 * - Persistent macro registry across evaluations
 * - Runtime macro expansion (macroexpand/macroexpand1)
 * - Macro definition detection and storage
 * - Integration with pure compiler via dependency injection
 */
export class HQLRuntime {
  private environment: Environment;
  private macroRegistry: MacroRegistry;
  private options: CompilerOptions;
  private baseDir: string;

  constructor(options: CompilerOptions = {}, baseDir: string = platformCwd()) {
    this.options = options;
    this.baseDir = baseDir;
    this.macroRegistry = {
      macros: new Map<string, MacroDefinition>(),
      functions: new Map<string, MacroFn>(),
    };
    // Initialize with a placeholder environment; initialize() will replace it with a fully configured instance.
    this.environment = new Environment(null);
  }

  /**
   * Initialize the runtime environment
   */
  async initialize(): Promise<void> {
    logger.debug("Initializing HQL runtime");

    // Create a fresh environment for the runtime
    const env = await Environment.createStandard();
    // Load system macros (core.hql, etc.) into this environment
    await loadSystemMacros(env, { baseDir: this.baseDir, verbose: this.options.verbose });
    
    this.environment = env;

    // Set up initial macro registry
    this.syncMacrosFromEnvironment();
  }

  /**
   * Evaluate HQL source code with persistent state
   * @param source - HQL source code to evaluate
   * @param currentFile - Optional file path for error reporting
   * @returns Transpiled JavaScript code
   */
  async eval(source: string, currentFile?: string): Promise<string> {
    // Parse and process the source to detect and compile macros
    const context = this.createCompilerContext(currentFile);
    await this.processAndCompileMacros(source, context);

    // Check if the source is only macro definitions
    const sexps = parse(source, currentFile);
    const canonical = transformSyntax(sexps);
    const nonMacroForms = canonical.filter((sexp) =>
      !this.isMacroDefinition(sexp)
    );

    // If there are no non-macro forms, sync and return empty (macro was already compiled)
    if (nonMacroForms.length === 0) {
      logger.debug("Source contains only macro definitions, returning empty");
      // IMPORTANT: Sync macros even when only defining macros!
      this.syncMacrosFromEnvironment();
      return "";
    }

    const evalContext = this.createCompilerContext(currentFile);

    // Use pure compiler with injected context
    const result = await transpileToJavascript(
      source,
      {
        baseDir: this.baseDir,
        currentFile,
        ...this.options,
      },
      context,
    );

    // Sync any new macros defined during compilation
    this.syncMacrosFromEnvironment();

    return result.code;
  }

  /**
   * Expand a macro form one level (macroexpand1)
   * @param form - S-expression or string to expand
   * @returns Expanded form
   */
  macroexpand1(form: string | SExp): Promise<SExp> {
    logger.debug("Runtime macroexpand1 called");

    // Parse and transform if string
    let sexp: SExp;
    if (typeof form === "string") {
      const parsed = parse(form);
      const transformed = transformSyntax(parsed);
      sexp = transformed[0];
    } else {
      sexp = form;
    }

    if (!isList(sexp)) {
      return Promise.resolve(sexp);
    }

    const list = sexp as SList;
    if (!list.elements || list.elements.length === 0) {
      return Promise.resolve(sexp);
    }

    const [head, ...args] = list.elements;
    if (!isSymbol(head)) {
      return Promise.resolve(sexp);
    }

    const macroName = head.name;
    const macro = this.environment.getMacro(macroName);

    if (!macro) {
      return Promise.resolve(sexp);
    }

    // Expand once
    try {
      const expanded = macro(args, this.environment);
      logger.debug(`Expanded ${macroName} macro`);
      return Promise.resolve(expanded);
    } catch (error) {
      logger.error(`Error expanding macro ${macroName}: ${error}`);
      throw error;
    }
  }

  /**
   * Fully expand a macro form (macroexpand)
   * @param form - S-expression or string to expand
   * @returns Fully expanded form
   */
  async macroexpand(form: string | SExp): Promise<SExp> {
    logger.debug("Runtime macroexpand called");

    // Parse if string
    const sexp = typeof form === "string" ? parse(form)[0] : form;

    const context = this.createCompilerContext(undefined);
    const expanded = await expandHql(
      typeof form === "string" ? form : this.sexpToString(sexp),
      { baseDir: this.baseDir, ...this.options },
      {
        verbose: this.options.verbose,
        iterationLimit: 1000,
        maxExpandDepth: 100,
      },
      context,
    );

    return expanded[0];
  }

  /**
   * Get all defined macros
   * @returns Map of macro names to definitions
   */
  getMacros(): Map<string, MacroDefinition> {
    return new Map(this.macroRegistry.macros);
  }

  /**
   * Check if a macro is defined
   * @param name - Macro name
   * @returns True if macro exists
   */
  hasMacro(name: string): boolean {
    return this.macroRegistry.macros.has(name);
  }

  /**
   * Get a specific macro definition
   * @param name - Macro name
   * @returns Macro definition or undefined
   */
  getMacro(name: string): MacroDefinition | undefined {
    return this.macroRegistry.macros.get(name);
  }

  /**
   * Clear all runtime state
   */
  async reset(): Promise<void> {
    logger.debug("Resetting HQL runtime");
    this.macroRegistry.macros.clear();
    this.macroRegistry.functions?.clear();
    
    // Create a fresh environment instead of reusing global
    const freshEnv = await Environment.createStandard();
    // Load system macros into the fresh environment
    await loadSystemMacros(freshEnv, { baseDir: this.baseDir, verbose: this.options.verbose });
    
    this.environment = freshEnv;
    // Reset gensym counter for reproducible builds (Common Lisp compatibility)
    const { resetGensymCounter } = await import("../gensym.ts");
    resetGensymCounter();
  }

  /**
   * Process source to detect and compile macro definitions
   * @private
   */
  private processAndCompileMacros(
    source: string,
    context: CompilerContext,
  ): void {
    try {
      // Parse source
      const sexps = parse(source, context.currentFile);
      const canonical = transformSyntax(sexps);

      // Look for macro definitions and compile them
      for (const sexp of canonical) {
        if (this.isMacroDefinition(sexp)) {
          // Store the definition
          this.storeMacroDefinition(sexp, context.currentFile);

          // Actually compile and register the macro in the environment
          if (isList(sexp)) {
            defineMacro(sexp as SList, this.environment, logger);
          }
        }
      }
    } catch (error) {
      logger.error(`Error processing macros: ${error}`);
    }
  }

  /**
   * Check if an S-expression is a macro definition
   * @private
   */
  private isMacroDefinition(sexp: SExp): boolean {
    if (!isList(sexp)) return false;
    const list = sexp as SList;
    if (!list.elements || list.elements.length === 0) return false;
    const head = list.elements[0];
    return isSymbol(head) && head.name === "macro";
  }

  /**
   * Store a macro definition in the registry
   * @private
   */
  private storeMacroDefinition(sexp: SExp, definedAt?: string): void {
    const list = sexp as SList;
    if (!list.elements || list.elements.length < 3) {
      logger.error("Invalid macro definition - missing parts");
      return;
    }

    const [_, nameSymbol, params, ...body] = list.elements;

    if (!isSymbol(nameSymbol)) {
      logger.error("Invalid macro definition - name must be symbol");
      return;
    }

    const name = nameSymbol.name;

    // Extract parameter information
    // Handle vector form: [a b c] parses as (vector a b c)
    // Handle empty vector: [] parses as (empty-array)
    // We need to skip the 'vector' or 'empty-array' symbol at the start
    let paramElements = isList(params) ? params.elements : [];
    if (paramElements.length > 0 && isSymbol(paramElements[0])) {
      const firstElem = paramElements[0].name;
      if (firstElem === "vector") {
        paramElements = paramElements.slice(1);
      } else if (firstElem === "empty-array") {
        paramElements = []; // empty-array means no params
      }
    }
    const paramList = paramElements;
    const paramNames: string[] = [];
    let restParam: string | null = null;

    for (let i = 0; i < paramList.length; i++) {
      const param = paramList[i];
      if (isSymbol(param)) {
        const paramName = param.name;
        // HQL uses & for rest parameters, not &rest
        if (paramName === "&" && i + 1 < paramList.length) {
          const rest = paramList[i + 1];
          if (isSymbol(rest)) {
            restParam = rest.name;
          }
          break;
        }
        paramNames.push(paramName);
      }
    }

    // Create macro definition
    const definition: MacroDefinition = {
      name,
      params: paramNames,
      restParam,
      body: this.buildMacroBody(body),
      source: this.sexpToString(sexp),
      definedAt: definedAt || "runtime",
    };

    // Store in registry
    this.macroRegistry.macros.set(name, definition);

    // Let environment handle the actual macro compilation
    // This will be done during eval

    logger.debug(`Stored macro definition: ${name}`);
  }

  private buildMacroBody(body: SExp[]): SExp {
    if (body.length === 0) {
      return createList();
    }
    if (body.length === 1) {
      return body[0];
    }
    return createList(createSymbol("do"), ...body);
  }

  /**
   * Sync macros from environment to registry
   * @private
   */
  private syncMacrosFromEnvironment(): void {
    // Get all macros from environment
    const envMacros = this.environment.macros;

    for (const [name, fn] of envMacros) {
      // Store function reference
      if (!this.macroRegistry.functions) {
        this.macroRegistry.functions = new Map();
      }
      this.macroRegistry.functions.set(name, fn);

      // If we don't have definition, create placeholder
      if (!this.macroRegistry.macros.has(name)) {
        this.macroRegistry.macros.set(name, {
          name,
          params: [],
          restParam: null,
          body: createList(),
          source: "(built-in)",
          definedAt: "system",
        });
      }
    }
  }

  /**
   * Create compiler context from current runtime state
   * @private
   */
  private createCompilerContext(currentFile?: string): CompilerContext {
    return {
      macroRegistry: this.macroRegistry,
      environment: this.environment,
      options: this.options,
      currentFile,
      baseDir: this.baseDir,
    };
  }

  /**
   * Convert S-expression to string representation
   * @private
   */
  private sexpToString(sexp: SExp): string {
    if (isList(sexp)) {
      const list = sexp as SList;
      const items = list.elements.map((s) => this.sexpToString(s));
      return `(${items.join(" ")})`;
    } else if (isSymbol(sexp)) {
      return sexp.name;
    } else if (isLiteral(sexp)) {
      return sexp.value === null
        ? "nil"
        : typeof sexp.value === "string"
        ? `"${sexp.value}"`
        : String(sexp.value);
    } else {
      return JSON.stringify(toJs(sexp));
    }
  }
}

// Export singleton instance for REPL use
let _runtime: HQLRuntime | null = null;

/**
 * Get or create the global HQL runtime
 */
export async function getHQLRuntime(): Promise<HQLRuntime> {
  if (!_runtime) {
    _runtime = new HQLRuntime();
    await _runtime.initialize();
  }
  return Promise.resolve(_runtime);
}

/**
 * Reset the global runtime
 */
export async function resetHQLRuntime(): Promise<void> {
  if (_runtime) {
    await _runtime.reset();
  }
  // Force creation of new runtime with fresh environment
  _runtime = null;
}
