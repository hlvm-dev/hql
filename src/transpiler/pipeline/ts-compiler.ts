/**
 * TypeScript Compiler Wrapper - Compiles generated TypeScript to JavaScript
 *
 * This module wraps the TypeScript compiler API to:
 * - Compile TypeScript to JavaScript with type checking
 * - Generate .d.ts declaration files
 * - Generate source maps (TS → JS)
 * - Report type errors with source positions
 */

import ts from "typescript";
import { globalLogger as logger } from "../../logger.ts";

// ============================================================================
// Types
// ============================================================================

export interface TypeDiagnostic {
  message: string;
  severity: "error" | "warning";
  file: string;
  line: number;
  column: number;
  code: number;
}

export interface TSCompileResult {
  /** Generated JavaScript code */
  javascript: string;
  /** Generated .d.ts declarations */
  declarations: string;
  /** TypeScript → JavaScript source map (JSON string) */
  sourceMap: string;
  /** Type errors and warnings */
  diagnostics: TypeDiagnostic[];
  /** Whether compilation succeeded (no errors) */
  success: boolean;
}

export interface TSCompilerOptions {
  /** Source file name for error reporting */
  fileName?: string;
  /** Target ES version (default: ES2020) */
  target?: ts.ScriptTarget;
  /** Module type (default: ESNext) */
  module?: ts.ModuleKind;
  /** Enable strict mode (default: true) */
  strict?: boolean;
  /** Generate source maps (default: true) */
  sourceMap?: boolean;
  /** Generate .d.ts files (default: true) */
  declaration?: boolean;
}

// ============================================================================
// Default Compiler Options
// ============================================================================

const DEFAULT_COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  // Don't use NodeNext for moduleResolution - it requires lib.d.ts
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  // IMPORTANT: Disable noImplicitAny for gradual typing
  // This allows untyped HQL code to work without warnings
  // while still type-checking code that has explicit type annotations
  noImplicitAny: false,
  declaration: true,
  sourceMap: true,
  esModuleInterop: true,
  skipLibCheck: true,
  // Don't emit on errors - we want to catch them
  noEmitOnError: false,
  // Allow JavaScript files (for interop)
  allowJs: true,
  // Preserve JSX for frameworks
  jsx: ts.JsxEmit.Preserve,
  // Skip standard library - we're doing in-memory compilation
  // We provide our own type declarations for runtime helpers
  noLib: true,
};

// ============================================================================
// Runtime Helper Declarations
// ============================================================================

/**
 * Type declarations for HQL runtime helpers and basic types.
 * These are prepended to the TypeScript code so tsc understands them.
 * Since we use noLib: true, we must provide essential type definitions.
 */
const RUNTIME_HELPER_DECLARATIONS = `
// Essential TypeScript Types (since noLib: true)
interface Array<T> {
  length: number;
  [n: number]: T;
  push(...items: T[]): number;
  pop(): T | undefined;
  map<U>(fn: (x: T, i: number) => U): U[];
  filter(fn: (x: T) => boolean): T[];
  reduce<U>(fn: (acc: U, x: T) => U, init: U): U;
  forEach(fn: (x: T) => void): void;
  slice(start?: number, end?: number): T[];
  concat(...items: (T | T[])[]): T[];
  indexOf(item: T): number;
  includes(item: T): boolean;
  join(sep?: string): string;
  find(fn: (x: T) => boolean): T | undefined;
  findIndex(fn: (x: T) => boolean): number;
  some(fn: (x: T) => boolean): boolean;
  every(fn: (x: T) => boolean): boolean;
  sort(fn?: (a: T, b: T) => number): T[];
  reverse(): T[];
  flat<D extends number = 1>(depth?: D): T[];
  flatMap<U>(fn: (x: T) => U | U[]): U[];
}
interface Object { }
interface CallableFunction extends Function { }
interface NewableFunction extends Function { }
interface IArguments { length: number; [n: number]: unknown; }
interface Function { apply(thisArg: unknown, args?: unknown[]): unknown; call(thisArg: unknown, ...args: unknown[]): unknown; bind(thisArg: unknown): Function; }
type Partial<T> = { [P in keyof T]?: T[P] };
type Record<K extends string | number | symbol, V> = { [P in K]: V };
type Readonly<T> = { readonly [P in keyof T]: T[P] };
type Pick<T, K extends keyof T> = { [P in K]: T[P] };
type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;
type Exclude<T, U> = T extends U ? never : T;
type Extract<T, U> = T extends U ? T : never;
type NonNullable<T> = T extends null | undefined ? never : T;
type ReturnType<T extends (...args: unknown[]) => unknown> = T extends (...args: unknown[]) => infer R ? R : unknown;
type Parameters<T extends (...args: unknown[]) => unknown> = T extends (...args: infer P) => unknown ? P : never;
interface String { length: number; charAt(i: number): string; charCodeAt(i: number): number; concat(...strings: string[]): string; indexOf(s: string): number; includes(s: string): boolean; slice(start?: number, end?: number): string; split(sep: string | RegExp): string[]; toLowerCase(): string; toUpperCase(): string; trim(): string; replace(search: string | RegExp, replacement: string): string; match(regexp: RegExp): string[] | null; startsWith(s: string): boolean; endsWith(s: string): boolean; repeat(count: number): string; padStart(length: number, s?: string): string; padEnd(length: number, s?: string): string; substring(start: number, end?: number): string; }
interface Number { toFixed(digits?: number): string; toString(radix?: number): string; }
interface Boolean { }
interface RegExp { test(s: string): boolean; exec(s: string): string[] | null; }
interface Symbol { }
declare const Symbol: { readonly iterator: unique symbol; };
interface Iterable<T> { }
interface Iterator<T> { next(): IteratorResult<T>; }
interface IteratorResult<T> { done: boolean; value: T; }
interface IterableIterator<T> extends Iterator<T> { }
interface Promise<T> { then<R>(fn: (x: T) => R | Promise<R>): Promise<R>; catch(fn: (e: unknown) => unknown): Promise<T>; finally(fn: () => void): Promise<T>; }
interface Error { name: string; message: string; stack?: string; }
interface Map<K, V> { get(key: K): V | undefined; set(key: K, value: V): Map<K, V>; has(key: K): boolean; delete(key: K): boolean; clear(): void; size: number; keys(): IterableIterator<K>; values(): IterableIterator<V>; entries(): IterableIterator<[K, V]>; forEach(fn: (value: V, key: K) => void): void; }
interface Set<T> { add(value: T): Set<T>; has(value: T): boolean; delete(value: T): boolean; clear(): void; size: number; keys(): IterableIterator<T>; values(): IterableIterator<T>; entries(): IterableIterator<[T, T]>; forEach(fn: (value: T) => void): void; }
interface JSON { parse(text: string): unknown; stringify(value: unknown): string; }
interface Math { abs(x: number): number; ceil(x: number): number; floor(x: number): number; round(x: number): number; max(...values: number[]): number; min(...values: number[]): number; pow(x: number, y: number): number; sqrt(x: number): number; random(): number; PI: number; E: number; sin(x: number): number; cos(x: number): number; tan(x: number): number; log(x: number): number; exp(x: number): number; }
interface Console { log(...args: unknown[]): void; error(...args: unknown[]): void; warn(...args: unknown[]): void; info(...args: unknown[]): void; debug(...args: unknown[]): void; }
interface Date { getTime(): number; getFullYear(): number; getMonth(): number; getDate(): number; getDay(): number; getHours(): number; getMinutes(): number; getSeconds(): number; getMilliseconds(): number; toISOString(): string; toDateString(): string; toTimeString(): string; toString(): string; }
interface ObjectConstructor { freeze<T>(o: T): Readonly<T>; keys(o: object): string[]; values(o: object): unknown[]; entries(o: object): [string, unknown][]; assign<T, U>(target: T, source: U): T & U; create(o: object | null): object; defineProperty(o: object, p: string, attributes: object): object; }
declare const console: Console;
declare const Math: Math;
declare const JSON: JSON;
declare const Object: ObjectConstructor;
declare function parseInt(s: string, radix?: number): number;
declare function parseFloat(s: string): number;
declare function isNaN(x: number): boolean;
declare function isFinite(x: number): boolean;
declare function setTimeout(fn: () => void, ms: number): number;
declare function setInterval(fn: () => void, ms: number): number;
declare function clearTimeout(id: number): void;
declare function clearInterval(id: number): void;

// HQL Runtime Helper Type Declarations
declare function __hql_get<T>(arr: T[], index: number): T | undefined;
declare function __hql_get<T extends object, K extends keyof T>(obj: T, key: K): T[K];
declare function __hql_get(obj: unknown, key: string | number): unknown;

declare function __hql_call<T, R>(fn: (this: T, ...args: unknown[]) => R, thisArg: T, ...args: unknown[]): R;

declare function __hql_safe_index<T>(arr: T[], index: number): T | undefined;

declare function __hql_create_range(start: number, end: number, step?: number): Iterable<number>;

declare function __hql_lazy_map<T, U>(fn: (x: T) => U, iterable: Iterable<T>): Iterable<U>;
declare function __hql_lazy_filter<T>(fn: (x: T) => boolean, iterable: Iterable<T>): Iterable<T>;
declare function __hql_lazy_take<T>(n: number, iterable: Iterable<T>): Iterable<T>;

declare function __hql_first<T>(arr: T[]): T | undefined;
declare function __hql_rest<T>(arr: T[]): T[];
declare function __hql_nth<T>(arr: T[], index: number): T | undefined;

declare function __hql_assoc<T extends object>(obj: T, key: string, value: unknown): T;
declare function __hql_dissoc<T extends object>(obj: T, key: string): Partial<T>;
declare function __hql_update<T extends object>(obj: T, key: string, fn: (val: unknown) => unknown): T;

declare function __hql_conj<T>(arr: T[], ...items: T[]): T[];
declare function __hql_into<T>(target: T[], source: Iterable<T>): T[];

declare function __hql_str(...args: unknown[]): string;
declare function __hql_print(...args: unknown[]): void;

declare function __hql_equal(a: unknown, b: unknown): boolean;
declare function __hql_not_equal(a: unknown, b: unknown): boolean;

declare function __hql_type(x: unknown): string;
declare function __hql_identity<T>(x: T): T;
declare function __hql_constantly<T>(x: T): () => T;
declare function __hql_complement<T extends unknown[]>(fn: (...args: T) => boolean): (...args: T) => boolean;

// Operator helpers
declare function __hql_get_op(name: string): (...args: unknown[]) => unknown;

// Collection operations
declare function reduce<T, U>(fn: (acc: U, x: T) => U, init: U, coll: T[]): U;
declare function map<T, U>(fn: (x: T) => U, coll: T[]): U[];
declare function filter<T>(fn: (x: T) => boolean, coll: T[]): T[];
declare function take<T>(n: number, coll: T[]): T[];
declare function drop<T>(n: number, coll: T[]): T[];
declare function first<T>(coll: T[]): T | undefined;
declare function rest<T>(coll: T[]): T[];
declare function last<T>(coll: T[]): T | undefined;
declare function concat<T>(...colls: T[][]): T[];
declare function range(start: number, end?: number, step?: number): number[];
declare function reverse<T>(coll: T[]): T[];
declare function sort<T>(coll: T[], compareFn?: (a: T, b: T) => number): T[];
declare function partition<T>(n: number, coll: T[]): T[][];
declare function interleave<T>(...colls: T[][]): T[];
declare function zipmap<K extends string, V>(keys: K[], vals: V[]): Record<K, V>;

// String operations
declare function str(...args: unknown[]): string;
declare function subs(s: string, start: number, end?: number): string;

// Type predicates
declare function nil_QMARK_(x: unknown): x is null | undefined;
declare function number_QMARK_(x: unknown): x is number;
declare function string_QMARK_(x: unknown): x is string;
declare function boolean_QMARK_(x: unknown): x is boolean;
declare function array_QMARK_(x: unknown): x is unknown[];
declare function object_QMARK_(x: unknown): x is object;
declare function fn_QMARK_(x: unknown): x is Function;

// Math operations
declare function inc(x: number): number;
declare function dec(x: number): number;
declare function mod(a: number, b: number): number;
declare function quot(a: number, b: number): number;
declare function rem(a: number, b: number): number;

// Print function (HQL has print, NOT println)
declare function print(...args: unknown[]): void;

declare const __hql_nil: null;

// Additional runtime helpers (for hash maps, ranges, etc.)
declare function __hql_getNumeric<T>(arr: T[], index: number): T | undefined;
declare function __hql_getNumeric<T extends object, K extends keyof T>(obj: T, key: K): T[K];
declare function __hql_getNumeric(obj: unknown, key: string | number): unknown;

declare function __hql_hash_map(...entries: unknown[]): Record<string, unknown>;

declare function __hql_range(...args: number[]): number[];

declare function __hql_toSequence(value: unknown): unknown[];

declare function __hql_for_each<T>(bindingName: string, sequence: Iterable<T>, body: (item: T) => void): void;

declare function __hql_throw(value: unknown): never;

declare function __hql_deepFreeze<T>(obj: T): T;

declare function __hql_match_obj(val: unknown, pattern: unknown[]): boolean;
`;

// ============================================================================
// Compiler Implementation
// ============================================================================

/**
 * Compile TypeScript code to JavaScript using the TypeScript compiler API.
 *
 * @param tsCode - TypeScript source code to compile
 * @param options - Compiler options
 * @returns Compilation result with JS, declarations, source map, and diagnostics
 */
export function compileTypeScript(
  tsCode: string,
  options: TSCompilerOptions = {},
): TSCompileResult {
  const fileName = options.fileName || "module.ts";
  const declarationFileName = fileName.replace(/\.ts$/, ".d.ts");
  const jsFileName = fileName.replace(/\.ts$/, ".js");
  const mapFileName = jsFileName + ".map";

  // Prepend runtime helper declarations
  const fullCode = RUNTIME_HELPER_DECLARATIONS + "\n" + tsCode;

  // Create compiler options
  const compilerOptions: ts.CompilerOptions = {
    ...DEFAULT_COMPILER_OPTIONS,
    ...(options.target !== undefined && { target: options.target }),
    ...(options.module !== undefined && { module: options.module }),
    ...(options.strict !== undefined && { strict: options.strict }),
    ...(options.sourceMap !== undefined && { sourceMap: options.sourceMap }),
    ...(options.declaration !== undefined && {
      declaration: options.declaration,
    }),
  };

  // Track output files
  const outputs: Map<string, string> = new Map();

  // Create a virtual file system for in-memory compilation
  const host = createCompilerHost(fullCode, fileName, compilerOptions, outputs);

  // Create the program
  const program = ts.createProgram([fileName], compilerOptions, host);

  // Get diagnostics (type errors, etc.)
  const allDiagnostics = ts.getPreEmitDiagnostics(program);

  // Convert TypeScript diagnostics to our format
  const diagnostics = convertDiagnostics(allDiagnostics, fullCode, fileName);

  // Emit the compiled output
  const emitResult = program.emit();

  // Add emit diagnostics
  diagnostics.push(
    ...convertDiagnostics(emitResult.diagnostics, fullCode, fileName),
  );

  // Extract outputs
  const javascript = outputs.get(jsFileName) || "";
  const declarations = outputs.get(declarationFileName) || "";
  const sourceMap = outputs.get(mapFileName) || "";

  // Check for errors (diagnostics with severity "error")
  const hasErrors = diagnostics.some((d) => d.severity === "error");

  logger.debug(
    `[ts-compiler] Compiled ${fileName}: ${diagnostics.length} diagnostics, ${hasErrors ? "with errors" : "success"}`,
  );

  return {
    javascript,
    declarations,
    sourceMap,
    diagnostics,
    success: !hasErrors,
  };
}

/**
 * Create a custom compiler host for in-memory compilation.
 */
function createCompilerHost(
  sourceCode: string,
  fileName: string,
  options: ts.CompilerOptions,
  outputs: Map<string, string>,
): ts.CompilerHost {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceCode,
    options.target || ts.ScriptTarget.ES2020,
    true,
  );

  return {
    getSourceFile: (name: string) => {
      if (name === fileName) return sourceFile;
      // Return empty source for lib files (they're built into TypeScript)
      return undefined;
    },
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: (name: string, text: string) => {
      outputs.set(name, text);
    },
    getCurrentDirectory: () => "/",
    getCanonicalFileName: (name: string) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (name: string) => name === fileName,
    readFile: (name: string) => (name === fileName ? sourceCode : undefined),
    directoryExists: () => true,
    getDirectories: () => [],
  };
}

/**
 * Convert TypeScript diagnostics to our diagnostic format.
 */
function convertDiagnostics(
  diagnostics: readonly ts.Diagnostic[],
  sourceCode: string,
  fileName: string,
): TypeDiagnostic[] {
  const result: TypeDiagnostic[] = [];

  // Count lines in the runtime helper declarations to offset line numbers
  const helperLineCount = RUNTIME_HELPER_DECLARATIONS.split("\n").length;

  for (const diag of diagnostics) {
    // Skip diagnostics from lib files
    if (diag.file && diag.file.fileName !== fileName) continue;

    let line = 1;
    let column = 0;

    if (diag.file && diag.start !== undefined) {
      const pos = diag.file.getLineAndCharacterOfPosition(diag.start);
      // Adjust line number to account for prepended helper declarations
      line = Math.max(1, pos.line + 1 - helperLineCount);
      column = pos.character;
    }

    const message = ts.flattenDiagnosticMessageText(diag.messageText, "\n");

    result.push({
      message,
      severity:
        diag.category === ts.DiagnosticCategory.Error ? "error" : "warning",
      file: fileName,
      line,
      column,
      code: diag.code,
    });
  }

  return result;
}

/**
 * Format diagnostics for display.
 */
export function formatDiagnostics(diagnostics: TypeDiagnostic[]): string {
  return diagnostics
    .map((d) => {
      const severity = d.severity === "error" ? "error" : "warning";
      return `${d.file}:${d.line}:${d.column} - ${severity} TS${d.code}: ${d.message}`;
    })
    .join("\n");
}
