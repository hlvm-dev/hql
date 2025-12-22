// core/src/environment.ts - Final cleanup of user macro references

import {
  createList,
  createNilLiteral,
  isList,
  isSymbol,
  isVector,
  type SExp,
} from "./s-exp/types.ts";
import { Logger } from "./logger.ts";
import { MacroRegistry } from "./s-exp/macro-registry.ts";
import {
  MacroError,
  TranspilerError,
  ValidationError,
} from "./common/error.ts";
import { LRUCache } from "./common/lru-cache.ts";
import { globalLogger as logger } from "./logger.ts";
import { globalSymbolTable } from "./transpiler/symbol_table.ts";
import {
  createBasicSymbolInfo,
  enrichSymbolInfoWithValueType,
} from "./transpiler/utils/symbol_info_utils.ts";
import { STDLIB_PUBLIC_API } from "./lib/stdlib/js/stdlib.js";
import { gensym } from "./gensym.ts";
import { isEmbeddedFile } from "./lib/embedded-macros.ts";
import { getErrorMessage, hyphenToUnderscore, isObjectValue, addWithSanitized, isNullish } from "./common/utils.ts";

type CallableValue = (...args: unknown[]) => unknown;

export type Value =
  | string
  | number
  | boolean
  | null
  | SExp
  | CallableValue
  | MacroFn
  | Record<string, unknown>
  | unknown[];

export type MacroFn = ((args: SExp[], env: Environment) => SExp) & {
  isMacro?: boolean;
  macroName?: string;
  sourceFile?: string;
};

function isSExpValue(value: unknown): value is SExp {
  return typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as { type: unknown }).type === "string";
}

export class Environment {
  public variables = new Map<string, Value>();
  public macros = new Map<string, MacroFn>();
  public moduleExports = new Map<string, Record<string, Value>>();

  private parent: Environment | null;
  private processedFiles = new Set<string>();
  private lookupCache = new LRUCache<string, Value>(500);
  private macroRegistry: MacroRegistry;
  private currentFilePath: string | null = null;
  private currentMacroContext: string | null = null;
  public logger: Logger;

  // Track which file each user macro belongs to: macroName -> sourceFile
  private macroSourceFiles = new Map<string, string>();
  // Track which macros are exported from each file: sourceFile -> Set<macroName>
  private exportedMacros = new Map<string, Set<string>>();
  // Track which macros have been imported into the current file: macroName -> true
  private importedMacros = new Set<string>();

  /**
   * Create a standard environment with built-ins loaded.
   * This is the factory method for creating a fresh environment.
   */
  static createStandard(): Promise<Environment> {
    const env = new Environment(null, logger);
    env.initializeBuiltins();
    return Promise.resolve(env);
  }

  /**
   * Create a shallow clone of this environment for isolated compilation.
   * Copies all macros and variables but creates fresh state for per-compilation data.
   * This allows reusing a cached base environment without state pollution.
   */
  clone(): Environment {
    const cloned = new Environment(this.parent, this.logger);

    // Copy macros (immutable definitions - safe to share references)
    for (const [name, macro] of this.macros) {
      cloned.macros.set(name, macro);
    }

    // Copy variables (builtin functions are immutable - safe to share)
    for (const [name, value] of this.variables) {
      cloned.variables.set(name, value);
    }

    // Copy module exports (reference to existing exports)
    for (const [path, exports] of this.moduleExports) {
      cloned.moduleExports.set(path, exports);
    }

    // Copy processed files (so we don't re-process system macros)
    for (const file of this.processedFiles) {
      cloned.processedFiles.add(file);
    }

    // Copy macro source tracking
    for (const [name, source] of this.macroSourceFiles) {
      cloned.macroSourceFiles.set(name, source);
    }
    for (const [file, macros] of this.exportedMacros) {
      cloned.exportedMacros.set(file, new Set(macros));
    }

    // Share the macro registry (contains parsed macro definitions)
    cloned.macroRegistry = this.macroRegistry;

    // Fresh state for per-compilation data
    // lookupCache, importedMacros, currentFilePath, currentMacroContext are fresh

    return cloned;
  }

  // Legacy singleton removed to enforce dependency injection and statelessness.
  // Use Environment.createStandard() instead.

  constructor(parent: Environment | null = null, logger?: Logger) {
    this.parent = parent;
    this.logger = logger || new Logger(false);
    this.macroRegistry = parent
      ? parent.macroRegistry
      : new MacroRegistry(this.logger.enabled);
  }

  initializeBuiltins(): void {
    try {
      const ensureNonZero = (
        value: number,
        operation: "division" | "modulo",
      ): void => {
        if (value === 0) {
          throw new ValidationError(
            `${operation === "division" ? "Division" : "Modulo"} by zero`,
            "arithmetic operation",
            { expectedType: "number", actualType: "zero" },
          );
        }
      };

      const ensureObjectTarget = (
        obj: unknown,
        message: string,
        operation: string,
      ): Record<string, unknown> => {
        if (isNullish(obj)) {
          throw new ValidationError(
            message,
            operation,
            {
              expectedType: "object",
              actualType: obj === null ? "null" : "undefined",
            },
          );
        }
        return obj as Record<string, unknown>;
      };

      const getListElements = (value: unknown): SExp[] | null => {
        if (isSExpValue(value) && isList(value)) {
          return value.elements;
        }
        return null;
      };

      // Helper to check if a value is a "vector" symbol (used in [a b c] syntax)
      const isVectorSymbol = (val: unknown): boolean => {
        if (!val || typeof val !== "object") return false;
        const obj = val as { type?: string; name?: string };
        return obj.type === "symbol" && (obj.name === "vector" || obj.name === "empty-array");
      };

      // Helper to check if collection is a JS Array representing vector syntax
      const isJSArrayVector = (coll: unknown): coll is unknown[] => {
        return Array.isArray(coll) && coll.length > 0 && isVectorSymbol(coll[0]);
      };

      this.define(
        "+",
        (...args: unknown[]) => (args as number[]).reduce((a, b) => a + b, 0),
      );
      this.define("-", (a: unknown, b?: unknown) => {
        const first = a as number;
        return b === undefined ? -first : first - (b as number);
      });
      this.define(
        "*",
        (...args: unknown[]) => (args as number[]).reduce((a, b) => a * b, 1),
      );
      this.define("/", (a: unknown, b: unknown) => {
        const dividend = a as number;
        const divisor = b as number;
        ensureNonZero(divisor, "division");
        return dividend / divisor;
      });
      this.define("%", (a: unknown, b: unknown) => {
        const left = a as number;
        const right = b as number;
        ensureNonZero(right, "modulo");
        return left % right;
      });
      this.define("=", (a: unknown, b: unknown) => a === b);
      // v2.0: Add strict/loose equality for use in macro expansion
      this.define("===", (a: unknown, b: unknown) => a === b);
      this.define("==", (a: unknown, b: unknown) => a == b);
      this.define("!=", (a: unknown, b: unknown) => a !== b);
      this.define(
        "<",
        (a: unknown, b: unknown) => (a as number) < (b as number),
      );
      this.define(
        ">",
        (a: unknown, b: unknown) => (a as number) > (b as number),
      );
      this.define(
        "<=",
        (a: unknown, b: unknown) => (a as number) <= (b as number),
      );
      this.define(
        ">=",
        (a: unknown, b: unknown) => (a as number) >= (b as number),
      );
      this.define(
        "get",
        (coll: unknown, key: unknown, notFound: Value = null) => {
          if (coll == null) return notFound;
          if (Array.isArray(coll)) {
            if (typeof key === "number" && key >= 0 && key < coll.length) {
              return coll[key];
            }
            return notFound;
          }
          if (isObjectValue(coll)) {
            const record = coll;
            const propKey = typeof key === "number"
              ? String(key)
              : String(key ?? "");
            return propKey in record ? record[propKey] : notFound;
          }
          return notFound;
        },
      );
      this.define("js-get", (obj: unknown, prop: unknown) => {
        const target = ensureObjectTarget(
          obj,
          "Cannot access property on null or undefined",
          "js-get operation",
        );
        const property = typeof prop === "string" ? prop : String(prop);
        return target[property];
      });
      this.define(
        "js-call",
        (obj: unknown, method: unknown, ...args: unknown[]) => {
          const target = ensureObjectTarget(
            obj,
            "Cannot call method on null or undefined",
            "js-call operation",
          );
          const methodName = typeof method === "string"
            ? method
            : String(method);
          const callable = target[methodName];
          if (typeof callable !== "function") {
            throw new ValidationError(
              `${methodName} is not a function on the given object`,
              "js-call operation",
              { expectedType: "function", actualType: typeof callable },
            );
          }
          return callable(...args);
        },
      );
      this.define("throw", (message: unknown) => {
        throw new TranspilerError(String(message));
      });

      // Macro-time helper functions for S-expression introspection
      // These execute during macro expansion to inspect S-expression types
      this.define(
        "list?",
        (value: unknown) => isSExpValue(value) && isList(value),
      );
      this.define(
        "symbol?",
        (value: unknown) => isSExpValue(value) && isSymbol(value),
      );
      this.define("name", (value: unknown) => {
        if (isSExpValue(value) && isSymbol(value)) {
          return value.name;
        }
        if (isObjectValue(value) && "name" in value) {
          const record = value as { name?: unknown };
          return typeof record.name === "string" ? record.name : null;
        }
        return null;
      });

      // Macro-time helper functions for collection operations
      // These execute during macro expansion and work with both JS arrays and S-expression lists

      this.define("%first", (coll: unknown) => {
        // Return S-expression nil for JS primitives (boolean, number, string, null, undefined)
        if (isNullish(coll)) {
          return createNilLiteral();
        }
        if (
          typeof coll === "boolean" || typeof coll === "number" ||
          typeof coll === "string"
        ) {
          return createNilLiteral();
        }

        // 1. Handle Vector as S-Expression Object
        if (isSExpValue(coll) && isVector(coll)) {
          const list = coll as unknown as { elements: SExp[] };
          return list.elements.length > 1 ? list.elements[1] : createNilLiteral();
        }

        // 2. Handle Vector as JS Array (Internal Parser Representation)
        if (isJSArrayVector(coll)) {
          // [vector, x, y, z] -> first is x (index 1)
          return coll.length > 1 ? coll[1] : createNilLiteral();
        }

        // Handle S-expression lists
        const elements = getListElements(coll);
        if (elements) {
          return elements.length > 0 ? elements[0] : createNilLiteral();
        }
        // Handle JS arrays
        if (Array.isArray(coll) && coll.length > 0) {
          return coll[0];
        }
        // Return S-expression nil for all other non-collection values
        return createNilLiteral();
      });
      this.define("%rest", (coll: unknown) => {
        // Special handling for vector syntax: (vector x y) as SExp
        if (isSExpValue(coll) && isVector(coll)) {
          const list = coll as unknown as { elements: SExp[] };
          // (vector x y z) -> rest is (y z) -> elements 2+
          return list.elements.length > 2
            ? createList(...list.elements.slice(2))
            : createList();
        }

        // Handle S-expression lists
        const elements = getListElements(coll);
        if (elements) {
          return elements.length > 0
            ? createList(...elements.slice(1))
            : createList();
        }

        // Handle JS arrays - check for vector syntax first
        if (isJSArrayVector(coll)) {
          // [vector, x, y, z] -> rest is [y, z] (indices 2+)
          return coll.length > 2 ? createList(...(coll.slice(2) as SExp[])) : createList();
        }

        // Handle regular JS arrays - convert to S-expression list
        if (Array.isArray(coll)) {
          return coll.length > 0 ? createList(...(coll.slice(1) as SExp[])) : createList();
        }
        return createList();
      });
      this.define("%length", (coll: unknown) => {
        if (isNullish(coll)) {
          return 0;
        }

        // Special handling for vector syntax: (vector x y) as SExp
        if (isSExpValue(coll) && isVector(coll)) {
          const list = coll as unknown as { elements: SExp[] };
          return Math.max(0, list.elements.length - 1);
        }

        // Handle S-expression lists
        const elements = getListElements(coll);
        if (elements) {
          return elements.length;
        }

        // Handle JS arrays - check for vector syntax first
        if (isJSArrayVector(coll)) {
          // [vector, x, y, z] -> length is 3 (excluding vector symbol)
          return Math.max(0, coll.length - 1);
        }

        // Handle regular JS arrays
        if (Array.isArray(coll)) {
          return coll.length;
        }
        return 0;
      });
      this.define("%empty?", (coll: unknown) => {
        if (isNullish(coll)) {
          return true;
        }

        // Special handling for vector syntax: (vector x y) as SExp
        if (isSExpValue(coll) && isVector(coll)) {
          const list = coll as unknown as { elements: SExp[] };
          return list.elements.length <= 1;
        }

        // Handle S-expression lists
        const elements = getListElements(coll);
        if (elements) {
          return elements.length === 0;
        }

        // Handle JS arrays - check for vector syntax first
        if (isJSArrayVector(coll)) {
          // [vector] -> empty, [vector, x] -> not empty
          return coll.length <= 1;
        }

        // Handle regular JS arrays
        if (Array.isArray(coll)) {
          return coll.length === 0;
        }
        return true;
      });
      this.define("%nth", (coll: unknown, index: unknown) => {
        if (isNullish(coll)) {
          return null;
        }

        let numericIndex = Number(index);
        if (!Number.isInteger(numericIndex) || numericIndex < 0) {
          return null;
        }

        // Special handling for vector syntax: (vector x y) as SExp
        if (isSExpValue(coll) && isVector(coll)) {
          const list = coll as unknown as { elements: SExp[] };
          numericIndex += 1;
          return numericIndex < list.elements.length
            ? list.elements[numericIndex]
            : null;
        }

        // Handle S-expression lists
        const elements = getListElements(coll);
        if (elements) {
          if (numericIndex < elements.length) {
            return elements[numericIndex] as Value;
          }
        }

        // Handle JS arrays - check for vector syntax first
        if (isJSArrayVector(coll)) {
          // [vector, x, y, z] -> nth(0) is x (index 1), nth(1) is y (index 2)
          const adjustedIndex = numericIndex + 1;
          return adjustedIndex < coll.length ? coll[adjustedIndex] : null;
        }

        // Handle regular JS arrays
        if (Array.isArray(coll)) {
          if (numericIndex < coll.length) {
            return coll[numericIndex];
          }
        }
        return null;
      });

      // Macro-time gensym for hygiene
      // Generates unique symbols to prevent variable capture in macros
      this.define("gensym", (prefix?: unknown) => {
        const prefixStr = typeof prefix === "string" ? prefix : "g";
        return gensym(prefixStr);
      });

      // Auto-load stdlib functions (lazy sequence operations)
      // This loop automatically registers all functions from STDLIB_PUBLIC_API
      for (const [name, func] of Object.entries(STDLIB_PUBLIC_API)) {
        this.define(name, func as unknown as Value);
      }

      // Register all builtins in the symbol table
      this.registerBuiltinsInSymbolTable();

      this.logger.debug("Built-in functions initialized successfully");
    } catch (error) {
      const msg = getErrorMessage(error);
      this.logger.error(`Failed to initialize built-in functions: ${msg}`);
      throw new ValidationError(
        `Failed to initialize built-in functions: ${msg}`,
        "environment",
      );
    }
  }

  /**
   * Register all builtin functions in the global symbol table
   */
  private registerBuiltinsInSymbolTable(): void {
    const builtins = [
      "+",
      "-",
      "*",
      "/",
      "%",
      "=",
      "!=",
      "<",
      ">",
      "<=",
      ">=",
      "get",
      "js-get",
      "js-call",
      "throw",
      "list?",
      "symbol?",
      "name",
      "%first",
      "%rest",
      "%length",
      "%empty?",
      "%nth",
    ];

    for (const name of builtins) {
      globalSymbolTable.set({
        name,
        kind: "builtin",
        scope: "global",
        type: "Function",
        meta: { isCore: true },
      });
    }
  }

  define(key: string, value: Value): void {
    try {
      this.logger.debug(`Defining symbol: ${key}`);
      this.variables.set(key, value);
      this.lookupCache.delete(key);
      if (typeof value === "function") {
        Object.defineProperty(value, "isDefFunction", { value: true });
      }

      // Create a basic symbol info and enrich it with type information
      const scope = this.currentFilePath ? "local" : "global";
      const filePath = this.currentFilePath || undefined; // Convert null to undefined
      const symbolInfo = createBasicSymbolInfo(key, scope, filePath);

      // Use the utility function to enrich with value type information
      const enrichedSymbolInfo = enrichSymbolInfoWithValueType(
        symbolInfo,
        value,
      );

      // Pass the properly typed SymbolInfo object to the symbol table
      globalSymbolTable.set(enrichedSymbolInfo);
    } catch (error) {
      const msg = getErrorMessage(error);
      throw new ValidationError(
        `Failed to define symbol ${key}: ${msg}`,
        "environment",
      );
    }
  }

  lookup(key: string): Value {
    try {
      const cachedValue = this.lookupCache.get(key);
      if (cachedValue !== undefined) return cachedValue;
      if (key.includes(".")) {
        const result = this.lookupDotNotation(key);
        this.lookupCache.set(key, result);
        return result;
      }
      const sanitizedKey = hyphenToUnderscore(key);
      if (this.variables.has(sanitizedKey)) {
        const v = this.variables.get(sanitizedKey);
        this.lookupCache.set(key, v!);
        this.lookupCache.set(sanitizedKey, v!);
        return v!;
      }
      if (this.variables.has(key)) {
        const v = this.variables.get(key);
        this.lookupCache.set(key, v!);
        return v!;
      }
      if (this.parent) {
        try {
          const v = this.parent.lookup(key);
          this.lookupCache.set(key, v);
          return v;
        } catch {
          // Parent lookup failed, continue with local lookup
        }
      }
      this.logger.debug(`Symbol not found: ${key}`);
      throw new ValidationError(
        `Symbol not found: ${key}`,
        "variable lookup",
        { expectedType: "defined symbol", actualType: "undefined symbol" },
      );
    } catch (error) {
      const msg = getErrorMessage(error);
      if (error instanceof ValidationError) throw error;
      throw new ValidationError(
        `Error looking up symbol ${key}: ${msg}`,
        "variable lookup",
      );
    }
  }

  private lookupDotNotation(key: string): Value {
    const [moduleName, ...propertyParts] = key.split(".");
    const propertyPath = propertyParts.join(".");
    if (this.moduleExports.has(moduleName)) {
      const moduleObj = this.moduleExports.get(moduleName)!;
      try {
        return this.getPropertyFromPath(moduleObj, propertyPath);
      } catch (error) {
        if (error instanceof ValidationError) throw error;
        throw new ValidationError(
          `Property '${propertyPath}' not found in module '${moduleName}'`,
          "module property lookup",
          {
            expectedType: "defined property",
            actualType: "undefined property",
          },
        );
      }
    }
    try {
      const moduleValue = this.lookup(moduleName);
      return this.getPropertyFromPath(moduleValue, propertyPath);
    } catch (error) {
      if (error instanceof ValidationError) {
        if (error.message.includes("Symbol not found")) {
          throw new ValidationError(
            `Module not found: ${moduleName}`,
            "module lookup",
            { expectedType: "defined module", actualType: "undefined module" },
          );
        }
        throw error;
      }
      const msg = getErrorMessage(error);
      throw new ValidationError(
        `Error accessing ${key}: ${msg}`,
        "dot notation lookup",
      );
    }
  }

  private getPropertyFromPath(obj: unknown, path: string): Value {
    if (!path) return obj as Value;
    if (isNullish(obj)) {
      throw new ValidationError(
        `Cannot access property '${path}' of ${
          obj === null ? "null" : "undefined"
        }`,
        "property access",
        {
          expectedType: "object",
          actualType: obj === null ? "null" : "undefined",
        },
      );
    }
    const parts = path.split(".");
    let current: unknown = obj;
    for (const part of parts) {
      if (!isObjectValue(current)) {
        throw new ValidationError(
          `Cannot access property '${part}' of ${typeof current}`,
          "property path access",
          { expectedType: "object", actualType: typeof current },
        );
      }
      const c = current as Record<string, unknown>;
      if (part in c) {
        current = c[part];
        continue;
      }
      const sanitizedPart = hyphenToUnderscore(part);
      if (sanitizedPart !== part && sanitizedPart in c) {
        current = c[sanitizedPart];
        continue;
      }
      throw new ValidationError(
        `Property '${part}' not found in path: ${path}`,
        "property path access",
        { expectedType: "defined property", actualType: "undefined property" },
      );
    }
    return current as Value;
  }

  importModule(moduleName: string, exports: Record<string, Value>): void {
    try {
      this.logger.debug(`Importing module: ${moduleName}`);
      // Use a single stable object per module to support circular/live bindings
      let targetObj: Record<string, Value> | undefined = undefined;
      if (this.moduleExports.has(moduleName)) {
        targetObj = this.moduleExports.get(moduleName)!;
      } else {
        // Check if already defined as a variable (from a prior pre-registration)
        const existing = this.variables.get(moduleName);
        if (isObjectValue(existing)) {
          targetObj = existing as Record<string, Value>;
        } else {
          targetObj = {} as Record<string, Value>;
        }
        // Ensure the environment maps point to the same object
        this.moduleExports.set(moduleName, targetObj);
        // Define the module symbol if not already defined
        if (!existing) {
          this.define(moduleName, targetObj);
        }
      }
      // Merge/overwrite exports into the stable object (live binding semantics)
      for (const [k, v] of Object.entries(exports)) {
        (targetObj as Record<string, Value>)[k] = v;
      }

      // Register module in symbol table
      globalSymbolTable.set({
        name: moduleName,
        kind: "module",
        scope: "global",
        isImported: true,
        meta: { importPath: this.currentFilePath || "unknown" },
      });

      for (const [exportName, exportValue] of Object.entries(exports)) {
        if (typeof exportValue === "function") {
          if ("isMacro" in exportValue) {
            this.macros.set(
              `${moduleName}.${exportName}`,
              exportValue as MacroFn,
            );
            if (moduleName === "core" || moduleName === "lib/core") {
              this.defineMacro(exportName, exportValue as MacroFn);
            }

            // Register macro in symbol table
            globalSymbolTable.set({
              name: `${moduleName}.${exportName}`,
              kind: "macro",
              scope: "module",
              parent: moduleName,
              isImported: true,
              sourceModule: moduleName,
            });
          } else if ("isDefFunction" in exportValue) {
            this.define(`${moduleName}.${exportName}`, exportValue);

            // Register function in symbol table
            globalSymbolTable.set({
              name: `${moduleName}.${exportName}`,
              kind: "function",
              scope: "module",
              parent: moduleName,
              type: "Function",
              isImported: true,
              sourceModule: moduleName,
            });
          }
        } else {
          // Register other exported values in symbol table
          const baseType = typeof exportValue;
          const typeDescription = exportValue === null
            ? "Null"
            : Array.isArray(exportValue)
            ? "Array"
            : baseType.charAt(0).toUpperCase() + baseType.slice(1);

          globalSymbolTable.set({
            name: `${moduleName}.${exportName}`,
            kind: "variable",
            scope: "module",
            parent: moduleName,
            type: typeDescription,
            isImported: true,
            sourceModule: moduleName,
          });
        }
      }
      this.logger.debug(`Module ${moduleName} imported with exports`);
    } catch (error) {
      const msg = getErrorMessage(error);
      if (error instanceof ValidationError || error instanceof MacroError) {
        throw error;
      }
      throw new ValidationError(
        `Failed to import module ${moduleName}: ${msg}`,
        "module import",
      );
    }
  }

  private tagMacroFunction(macro: MacroFn, name: string, sourceFile?: string) {
    try {
      // Only define properties if they don't already exist
      if (!Object.prototype.hasOwnProperty.call(macro, "isMacro")) {
        Object.defineProperty(macro, "isMacro", { value: true });
      }
      if (!Object.prototype.hasOwnProperty.call(macro, "macroName")) {
        Object.defineProperty(macro, "macroName", { value: name });
      }
      if (
        sourceFile && !Object.prototype.hasOwnProperty.call(macro, "sourceFile")
      ) {
        Object.defineProperty(macro, "sourceFile", { value: sourceFile });
      }
    } catch (error) {
      this.logger.warn(
        `Could not tag macro function ${name}: ${
          getErrorMessage(error)
        }`,
      );
    }
  }

  defineMacro(key: string, macro: MacroFn, isSystemMacro: boolean = false): void {
    try {
      const sourceFile = this.currentFilePath;

      // Auto-detect system macros from embedded macro files
      const isSystem = isSystemMacro || !sourceFile || isEmbeddedFile(sourceFile);

      this.logger.debug(`Defining macro: ${key} (system: ${isSystem}, file: ${sourceFile || "none"})`);
      this.tagMacroFunction(macro, key);

      if (isSystem) {
        // System macro - add to registry for global access
        this.macroRegistry.defineSystemMacro(key, macro);
        globalSymbolTable.set({
          name: key,
          kind: "macro",
          scope: "global",
          meta: { isSystemMacro: true },
        });
      } else {
        // User macro - track source file for proper scoping
        this.macroSourceFiles.set(key, sourceFile);
        const sanitizedKey = hyphenToUnderscore(key);
        if (sanitizedKey !== key) {
          this.macroSourceFiles.set(sanitizedKey, sourceFile);
        }
        globalSymbolTable.set({
          name: key,
          kind: "macro",
          scope: "local",
          meta: { isSystemMacro: false, sourceFile },
        });
      }

      // Always store in local macros map for lookup
      this.macros.set(key, macro);
      const sanitizedKey = hyphenToUnderscore(key);
      if (sanitizedKey !== key) {
        this.macros.set(sanitizedKey, macro);
      }
    } catch (error) {
      const msg = getErrorMessage(error);
      throw new MacroError(
        `Failed to define macro ${key}: ${msg}`,
        key,
        { filePath: this.currentFilePath ?? undefined },
      );
    }
  }

  /**
   * Mark a macro as exported from the current file
   */
  markMacroExported(macroName: string): void {
    const sourceFile = this.currentFilePath;
    if (!sourceFile) {
      this.logger.debug(`Cannot mark macro ${macroName} as exported: no current file`);
      return;
    }

    let exports = this.exportedMacros.get(sourceFile);
    if (!exports) {
      exports = new Set();
      this.exportedMacros.set(sourceFile, exports);
    }
    addWithSanitized(exports, macroName);

    this.logger.debug(`Marked macro ${macroName} as exported from ${sourceFile}`);
  }

  /**
   * Mark a macro name as imported (for aliases where we've already verified the original)
   */
  markMacroImported(macroName: string): void {
    addWithSanitized(this.importedMacros, macroName);
    this.logger.debug(`Marked macro ${macroName} as imported (alias)`);
  }

  /**
   * Import a user macro from another file into the current scope
   */
  importUserMacro(macroName: string, sourceFile: string): boolean {
    // Check if the macro exists and is exported from the source file
    let exports = this.exportedMacros.get(sourceFile);

    if (!exports) {
      // Fallback: try to find a matching file path in exportedMacros
      // This handles cases where paths might be resolved differently (e.g. in tests or with symlinks)
      // We check if the requested sourceFile is a suffix of a known exported file or vice versa
      // matching at least the filename and parent directory for safety
      // Cache the filename extraction to avoid redundant .split() calls
      const sourceFileName = sourceFile.split('/').pop();
      for (const [path, exportSet] of this.exportedMacros.entries()) {
        if ((path.endsWith(sourceFile) || sourceFile.endsWith(path)) &&
            path.split('/').pop() === sourceFileName) {
          exports = exportSet;
          break;
        }
      }
    }

    if (!exports?.has(macroName)) {
      // Also check sanitized name
      const sanitizedName = hyphenToUnderscore(macroName);
      if (!exports?.has(sanitizedName)) {
        this.logger.debug(
          `Cannot import macro ${macroName}: not exported from ${sourceFile}`
        );
        return false;
      }
    }

    // Mark as imported in current scope
    addWithSanitized(this.importedMacros, macroName);

    this.logger.debug(`Imported macro ${macroName} from ${sourceFile}`);
    return true;
  }

  /**
   * Get the effective current file path by checking this env and parents
   */
  private getEffectiveCurrentFile(): string | undefined {
    if (this.currentFilePath) {
      return this.currentFilePath;
    }
    let env = this.parent;
    while (env !== null) {
      if (env.currentFilePath) {
        return env.currentFilePath;
      }
      env = env.parent;
    }
    return undefined;
  }

  /**
   * Check if a macro in a specific scope is accessible from this environment
   * Returns true/false if found, undefined if macro not in this scope
   */
  private checkMacroAccessibilityInScope(
    scope: Environment,
    macroName: string,
  ): boolean | undefined {
    if (!scope.macros.has(macroName)) {
      return undefined; // Macro not in this scope
    }

    // Found the macro - check accessibility
    const macroSourceFile = scope.macroSourceFiles.get(macroName);

    // If no source file tracked, it's accessible
    if (!macroSourceFile) {
      return true;
    }

    // Get effective current file
    const effectiveCurrentFile = this.getEffectiveCurrentFile();

    // Macro from current file is always accessible
    if (macroSourceFile === effectiveCurrentFile) {
      return true;
    }

    // Check if macro was explicitly imported
    if (this.importedMacros.has(macroName)) {
      return true;
    }

    // Not accessible - macro is from another file and not imported
    return false;
  }

  /**
   * Check if a macro is accessible in the current scope
   */
  isMacroAccessible(macroName: string): boolean {
    // System macros are always accessible
    if (this.macroRegistry.hasMacro(macroName)) {
      return true;
    }

    // Check this scope first
    const thisResult = this.checkMacroAccessibilityInScope(this, macroName);
    if (thisResult !== undefined) {
      return thisResult;
    }

    // Walk up the parent chain
    let current = this.parent;
    while (current !== null) {
      const result = this.checkMacroAccessibilityInScope(current, macroName);
      if (result !== undefined) {
        return result;
      }
      current = current.parent;
    }

    // Macro not found in any scope
    return false;
  }

  importMacro(
    sourceFile: string,
    macroName: string,
    targetFile: string,
    aliasName?: string,
  ): boolean {
    try {
      const success = this.macroRegistry.importMacro(
        sourceFile,
        macroName,
        targetFile,
        aliasName,
      );
      if (success) {
        const importName = aliasName || macroName;
        // Register in symbol table
        globalSymbolTable.set({
          name: importName,
          kind: "macro",
          scope: "local",
          aliasOf: aliasName ? macroName : undefined,
          sourceModule: sourceFile,
          isImported: true,
          meta: { importedInFile: targetFile },
        });
      }
      return success;
    } catch (error) {
      const msg = getErrorMessage(error);
      throw new MacroError(
        `Failed to import macro ${macroName}: ${msg}`,
        macroName,
        { filePath: sourceFile },
      );
    }
  }

  hasMacro(key: string): boolean {
    return this.isMacroAccessible(key);
  }

  getMacro(key: string): MacroFn | undefined {
    // First check if accessible
    if (!this.isMacroAccessible(key)) {
      return undefined;
    }

    // Check system macros first
    const systemMacro = this.macroRegistry.getMacro(key);
    if (systemMacro) {
      return systemMacro;
    }

    // Check this scope first
    const thisMacro = this.macros.get(key);
    if (thisMacro) {
      return thisMacro;
    }

    // Walk up the parent chain to find the macro
    let current = this.parent;
    while (current !== null) {
      const macro = current.macros.get(key);
      if (macro) {
        return macro;
      }
      current = current.parent;
    }

    return undefined;
  }

  isSystemMacro(symbolName: string): boolean {
    return this.macroRegistry.isSystemMacro(symbolName);
  }

  markFileProcessed(filePath: string): void {
    this.macroRegistry.markFileProcessed(filePath);
    this.processedFiles.add(filePath);
  }

  hasProcessedFile(filePath: string): boolean {
    if (this.macroRegistry.hasProcessedFile(filePath)) {
      return true;
    }
    return this.processedFiles.has(filePath);
  }

  setCurrentFile(filePath: string | null): void {
    try {
      if (filePath) this.logger.debug(`Setting current file to: ${filePath}`);
      else this.logger.debug(`Clearing current file`);
      this.currentFilePath = filePath;
    } catch (error) {
      this.logger.warn(
        `Error setting current file: ${
          getErrorMessage(error)
        }`,
      );
    }
  }

  getCurrentFile(): string {
    return this.currentFilePath ?? "";
  }

  getCurrentMacroContext(): string | null {
    return this.currentMacroContext;
  }

  setCurrentMacroContext(context: string | null): void {
    this.currentMacroContext = context;
  }

  extend(): Environment {
    return new Environment(this, this.logger);
  }

  /**
   * Get the parent environment (for scope chain traversal)
   */
  getParent(): Environment | null {
    return this.parent;
  }

  clearCache(): void {
    this.lookupCache.clear();
    this.logger.debug("Lookup cache cleared");
  }

  /**
   * Get all defined symbols in the environment
   * Builds Set incrementally to avoid multiple intermediate array allocations
   */
  getAllDefinedSymbols(): string[] {
    // Build Set incrementally - single allocation instead of 4
    const symbolsSet = new Set(this.variables.keys());

    // Add symbols from imported modules directly to Set
    for (const exports of this.moduleExports.values()) {
      for (const key of Object.keys(exports)) {
        symbolsSet.add(key);
      }
    }

    return Array.from(symbolsSet);
  }

  /**
   * Get information about all imported modules
   */
  getAllImportedModules(): Map<string, string> {
    const result = new Map<string, string>();

    // Collect module names and their sources
    Array.from(this.moduleExports.entries()).forEach(([path]) => {
      // Extract module name from path
      const moduleName = path.split("/").pop()?.replace(/\.[^/.]+$/, "") ||
        path;
      result.set(moduleName, path);
    });

    return result;
  }

  /**
   * Get all exported symbols from a specific module
   */
  getModuleExports(modulePath: string): string[] {
    const exports = this.moduleExports.get(modulePath);
    return exports ? Object.keys(exports) : [];
  }
}
