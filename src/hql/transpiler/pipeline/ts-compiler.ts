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
import { globalLogger as logger } from "../../../logger.ts";

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
  target: ts.ScriptTarget.ES2021,
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
  // In-memory compilation requires noLib: true
  // We provide type declarations in RUNTIME_HELPER_DECLARATIONS
  // Note: TS2318 "Cannot find global type" errors are expected and filtered
  // because TypeScript's intrinsic types can't be fully replicated with interfaces
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
  [Symbol.iterator](): IterableIterator<T>;
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
interface Generator<T = unknown, TReturn = unknown, TNext = unknown> extends Iterator<T> {
  next(...args: [] | [TNext]): IteratorResult<T>;
  return(value: TReturn): IteratorResult<T>;
  throw(e: unknown): IteratorResult<T>;
  [Symbol.iterator](): Generator<T, TReturn, TNext>;
}
interface PromiseLike<T> { then<R>(onfulfilled?: (value: T) => R | PromiseLike<R>): PromiseLike<R>; }
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

// Constructors for built-in types (needed for 'new Error()', 'new Set()', etc.)
interface ErrorConstructor { new(message?: string): Error; (message?: string): Error; prototype: Error; }
interface TypeErrorConstructor { new(message?: string): TypeError; (message?: string): TypeError; prototype: TypeError; }
interface RangeErrorConstructor { new(message?: string): RangeError; (message?: string): RangeError; prototype: RangeError; }
interface SyntaxErrorConstructor { new(message?: string): SyntaxError; (message?: string): SyntaxError; prototype: SyntaxError; }
interface ReferenceErrorConstructor { new(message?: string): ReferenceError; (message?: string): ReferenceError; prototype: ReferenceError; }
interface SetConstructor { new<T>(values?: Iterable<T>): Set<T>; prototype: Set<unknown>; }
interface MapConstructor { new<K, V>(entries?: Iterable<[K, V]>): Map<K, V>; prototype: Map<unknown, unknown>; }
interface DateConstructor { new(): Date; new(value: number | string): Date; now(): number; parse(s: string): number; prototype: Date; }
interface ArrayConstructor { new<T>(...items: T[]): T[]; isArray(arg: unknown): arg is unknown[]; from<T>(iterable: Iterable<T>): T[]; of<T>(...items: T[]): T[]; prototype: unknown[]; }
interface PromiseConstructor { new<T>(executor: (resolve: (value: T) => void, reject: (reason?: unknown) => void) => void): Promise<T>; resolve<T>(value: T): Promise<T>; reject(reason?: unknown): Promise<never>; all<T>(values: Iterable<Promise<T>>): Promise<T[]>; race<T>(values: Iterable<Promise<T>>): Promise<T>; }
interface TypeError extends Error { name: "TypeError"; }
interface RangeError extends Error { name: "RangeError"; }
interface SyntaxError extends Error { name: "SyntaxError"; }
interface ReferenceError extends Error { name: "ReferenceError"; }
declare const Error: ErrorConstructor;
declare const TypeError: TypeErrorConstructor;
declare const RangeError: RangeErrorConstructor;
declare const SyntaxError: SyntaxErrorConstructor;
declare const ReferenceError: ReferenceErrorConstructor;
declare const Set: SetConstructor;
declare const Map: MapConstructor;
declare const Date: DateConstructor;
declare const Array: ArrayConstructor;
declare const Promise: PromiseConstructor;

declare function parseInt(s: string, radix?: number): number;
declare function parseFloat(s: string): number;
declare function isNaN(x: number): boolean;
declare function isFinite(x: number): boolean;
declare function setTimeout(fn: () => void, ms: number): number;
declare function setInterval(fn: () => void, ms: number): number;
declare function clearTimeout(id: number): void;
declare function clearInterval(id: number): void;

// Web/Deno API declarations
interface Response { ok: boolean; status: number; statusText: string; headers: Headers; body: ReadableStream<Uint8Array> | null; json(): Promise<unknown>; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer>; blob(): Promise<Blob>; }
interface Headers { get(name: string): string | null; has(name: string): boolean; set(name: string, value: string): void; append(name: string, value: string): void; delete(name: string): void; forEach(fn: (value: string, key: string) => void): void; }
interface ReadableStream<T> { cancel(): Promise<void>; getReader(): ReadableStreamDefaultReader<T>; }
interface ReadableStreamDefaultReader<T> { read(): Promise<{ done: boolean; value: T | undefined }>; cancel(): Promise<void>; }
interface ArrayBuffer { byteLength: number; slice(begin: number, end?: number): ArrayBuffer; }
interface Uint8Array { length: number; [n: number]: number; slice(start?: number, end?: number): Uint8Array; }
interface Blob { size: number; type: string; slice(start?: number, end?: number): Blob; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer>; }
interface RequestInit { method?: string; headers?: Record<string, string>; body?: string | Uint8Array; signal?: AbortSignal; }
interface AbortSignal { aborted: boolean; }
declare function fetch(url: string, init?: RequestInit): Promise<Response>;

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
declare function empty_QMARK_(x: unknown): boolean;

// Math operations
declare function inc(x: number): number;
declare function dec(x: number): number;
declare function abs(x: number): number;
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

declare function __hql_toIterable(value: unknown): Iterable<unknown>;

declare function __hql_for_each<T>(bindingName: string, sequence: Iterable<T>, body: (item: T) => void): void;

declare function __hql_throw(value: unknown): never;

declare function __hql_deepFreeze<T>(obj: T): T;

declare function __hql_trampoline<T>(thunk: () => T): T;

declare function __hql_trampoline_gen<T>(createInitial: () => Generator<T, T, unknown>): Generator<T, T, unknown>;

declare const __hql_gen_thunk_symbol: unique symbol;

declare function __hql_match_obj(val: unknown, pattern: unknown[]): boolean;

// ============================================================================
// HQL Standard Library Functions
// ============================================================================
// These are auto-injected at runtime but need declarations for type checking

// Collection functions
declare function first<T>(coll: Iterable<T> | null | undefined): T | undefined;
declare function rest<T>(coll: Iterable<T> | null | undefined): Iterable<T>;
declare function cons<T>(item: T, coll: Iterable<T> | null | undefined): Iterable<T>;
declare function nth<T>(coll: Iterable<T> | null | undefined, index: number, notFound?: T): T | undefined;
declare function count(coll: Iterable<any> | null | undefined): number;
declare function second<T>(coll: Iterable<T> | null | undefined): T | undefined;
declare function last<T>(coll: Iterable<T> | null | undefined): T | undefined;
declare function isEmpty(coll: Iterable<any> | null | undefined): boolean;
declare function some<T>(pred: (item: T) => boolean, coll: Iterable<T> | null | undefined): boolean;
declare function every<T>(pred: (item: T) => boolean, coll: Iterable<T> | null | undefined): boolean;
declare function notAny<T>(pred: (item: T) => boolean, coll: Iterable<T> | null | undefined): boolean;
declare function notEvery<T>(pred: (item: T) => boolean, coll: Iterable<T> | null | undefined): boolean;
declare function take<T>(n: number, coll: Iterable<T> | null | undefined): Iterable<T>;
declare function drop<T>(n: number, coll: Iterable<T> | null | undefined): Iterable<T>;
declare function takeWhile<T>(pred: (item: T) => boolean, coll: Iterable<T> | null | undefined): Iterable<T>;
declare function dropWhile<T>(pred: (item: T) => boolean, coll: Iterable<T> | null | undefined): Iterable<T>;

// Transformation functions
declare function map<T, R>(fn: (item: T) => R, coll: Iterable<T> | null | undefined): Iterable<R>;
declare function filter<T>(pred: (item: T) => boolean, coll: Iterable<T> | null | undefined): Iterable<T>;
declare function reduce<T, R>(fn: (acc: R, item: T) => R, init: R, coll: Iterable<T> | null | undefined): R;
declare function concat<T>(...colls: (Iterable<T> | null | undefined)[]): Iterable<T>;
declare function flatten<T>(coll: Iterable<any> | null | undefined): Iterable<T>;
declare function distinct<T>(coll: Iterable<T> | null | undefined): Iterable<T>;
declare function mapIndexed<T, R>(fn: (i: number, item: T) => R, coll: Iterable<T> | null | undefined): Iterable<R>;
declare function keep<T, R>(fn: (item: T) => R | null | undefined, coll: Iterable<T> | null | undefined): Iterable<R>;
declare function mapcat<T, R>(fn: (item: T) => Iterable<R>, coll: Iterable<T> | null | undefined): Iterable<R>;
declare function reverse<T>(coll: Iterable<T> | null | undefined): T[];

// Realization functions
declare function vec<T>(coll: Iterable<T> | null | undefined): T[];
declare function realize<T>(coll: Iterable<T> | null | undefined): T[];
declare function doall<T>(coll: Iterable<T> | null | undefined): T[];
declare function toArray<T>(coll: Iterable<T> | null | undefined): T[];
declare function toSet<T>(coll: Iterable<T> | null | undefined): Set<T>;

// Sequence generators
declare function range(end?: number): Iterable<number>;
declare function range(start: number, end: number, step?: number): Iterable<number>;
declare function iterate<T>(fn: (value: T) => T, init: T): Iterable<T>;
declare function repeat<T>(value: T): Iterable<T>;
declare function repeatedly<T>(fn: () => T): Iterable<T>;
declare function cycle<T>(coll: Iterable<T> | null | undefined): Iterable<T>;

// Seq operations
declare function seq<T>(coll: Iterable<T> | null | undefined): Iterable<T> | null;
declare function conj<T>(coll: T[] | null | undefined, ...items: T[]): T[];
declare function into<T>(target: any, from: Iterable<T> | null | undefined): any;
declare function next<T>(coll: Iterable<T> | null | undefined): Iterable<T> | null;
declare function empty(coll: any): any;

// Map operations (using HQL-specific names to avoid conflicts)
// Note: get, keys, vals conflict with common JS idioms - use getIn, assoc, etc.
declare function getIn(obj: any, keys: any[]): any;
declare function assoc(map: any, key: any, value: any): any;
declare function assocIn(map: any, keys: any[], value: any): any;
declare function dissoc(map: any, ...keys: any[]): any;
declare function updateIn(map: any, keys: any[], fn: (v: any) => any): any;
declare function merge(...maps: any[]): any;

// Grouping
declare function groupBy<T, K>(fn: (item: T) => K, coll: Iterable<T> | null | undefined): Map<K, T[]>;
declare function partitionBy<T, K>(fn: (item: T) => K, coll: Iterable<T> | null | undefined): Iterable<T[]>;
declare function partition<T>(n: number, coll: Iterable<T> | null | undefined): Iterable<T[]>;
declare function partitionAll<T>(n: number, coll: Iterable<T> | null | undefined): Iterable<T[]>;
declare function splitAt<T>(n: number, coll: Iterable<T> | null | undefined): [T[], Iterable<T>];
declare function splitWith<T>(pred: (item: T) => boolean, coll: Iterable<T> | null | undefined): [T[], Iterable<T>];

// Higher-order functions (prefixed with __ to avoid conflicts with user code)
declare function comp<T>(...fns: ((arg: any) => any)[]): (arg: T) => any;
declare function partial<T extends (...args: any[]) => any>(fn: T, ...args: any[]): (...rest: any[]) => any;
declare function zip<T>(...arrays: Iterable<T>[]): Iterable<T[]>;
declare function zipWith<T, R>(fn: (...args: T[]) => R, ...arrays: Iterable<T>[]): Iterable<R>;
declare function juxt<T, R>(...fns: ((x: T) => R)[]): (x: T) => R[];
declare function constantly<T>(x: T): (...args: any[]) => T;
declare function complement<T extends (...args: any[]) => boolean>(fn: T): T;
declare function apply<T, R>(fn: (...args: T[]) => R, args: T[]): R;
declare function vals<T>(obj: Record<string, T> | Map<any, T> | null | undefined): T[];
declare function zipmap<K extends string, V>(keys: Iterable<K>, vals: Iterable<V>): Record<K, V>;

// Predicates
declare function isSeq(value: any): boolean;
declare function isSome(value: any): boolean;
declare function isNil(value: any): boolean;
declare function isEven(n: number): boolean;
declare function isOdd(n: number): boolean;
declare function isZero(n: number): boolean;
declare function isPositive(n: number): boolean;
declare function isNegative(n: number): boolean;
declare function isNumber(value: any): value is number;
declare function isString(value: any): value is string;
declare function isBoolean(value: any): value is boolean;
declare function isFunction(value: any): value is Function;
declare function isArray(value: any): value is any[];
declare function isMap(value: any): boolean;
declare function isSet(value: any): boolean;
declare function isVector(value: any): boolean;
declare function isList(value: any): boolean;
declare function isColl(value: any): boolean;
declare function isAssociative(value: any): boolean;
declare function isSequential(value: any): boolean;
declare function isReduced(value: any): boolean;

// Arithmetic helpers (HQL-specific, avoiding common user names)
// Note: add, sub, mul, div are common user function names - not declared
declare function inc(n: number): number;
declare function dec(n: number): number;
declare function mod(a: number, b: number): number;

// Comparison (HQL-specific, min/max already in Math interface)
declare function eq<T>(a: T, b: T): boolean;
declare function neq<T>(a: T, b: T): boolean;
declare function lt(...nums: number[]): boolean;
declare function gt(...nums: number[]): boolean;
declare function lte(...nums: number[]): boolean;
declare function gte(...nums: number[]): boolean;
declare function compare(a: any, b: any): number;

// Transducers
declare function transduce<T, R, A>(xform: any, rf: (acc: A, item: R) => A, init: A, coll: Iterable<T>): A;
declare function eduction<T, R>(xform: any, coll: Iterable<T>): Iterable<R>;
declare function completing<A, R>(rf: (acc: A, item: any) => A, cf?: (acc: A) => R): any;
declare function reduced<T>(value: T): any;
declare function unreduced<T>(value: any): T;

// String functions (HQL-specific, avoiding conflicts with common names)
// Note: split, join, replace, includes conflict with JS builtins - not declared
declare function str(...args: any[]): string;
declare function subs(s: string, start: number, end?: number): string;
declare function upperCase(s: string): string;
declare function lowerCase(s: string): string;
declare function blankQ(s: string | null | undefined): boolean;

// REPL functions (available in REPL context)
declare function memory(): Promise<{count: number, names: string[], path: string}>;
declare function forget(name: string): Promise<boolean>;
declare function describe(name: string): {name: string, type: string, value: unknown} | null;
declare function help(): null;
declare function exit(): never;
declare function clear(): null;
`;

/**
 * Number of lines in the runtime helper declarations prelude.
 * This is used to offset source map positions when chaining HQL→TS→JS maps.
 */
export const PRELUDE_LINE_COUNT = RUNTIME_HELPER_DECLARATIONS.split('\n').length;

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
  _sourceCode: string,
  fileName: string,
  options: ts.CompilerOptions,
  outputs: Map<string, string>,
): ts.CompilerHost {
  const sourceFile = ts.createSourceFile(
    fileName,
    _sourceCode,
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
    readFile: (name: string) => (name === fileName ? _sourceCode : undefined),
    directoryExists: () => true,
    getDirectories: () => [],
  };
}

/**
 * Convert TypeScript diagnostics to our diagnostic format.
 */
function convertDiagnostics(
  diagnostics: readonly ts.Diagnostic[],
  _sourceCode: string,
  fileName: string,
): TypeDiagnostic[] {
  const result: TypeDiagnostic[] = [];

  // Use pre-computed line count for runtime helper declarations
  const helperLineCount = PRELUDE_LINE_COUNT;

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
