// deno-lint-ignore-file no-explicit-any

/**
 * TypeScript type definitions for HQL stdlib
 *
 * This file provides proper type definitions to fix union type property access errors.
 * The JSDoc types in core.js now correctly reflect null-safe behavior (|null|undefined).
 */

// ============================================================================
// COLLECTION FUNCTIONS (Iterable handling)
// ============================================================================

/**
 * Returns the first element of a collection
 */
export function first<T>(coll: Iterable<T> | null | undefined): T | undefined;

/**
 * Returns all elements except the first
 */
export function rest<T>(coll: Iterable<T> | null | undefined): Iterable<T>;

/**
 * Constructs a new collection with item prepended
 */
export function cons<T>(
  item: T,
  coll: Iterable<T> | null | undefined,
): Iterable<T>;

/**
 * Returns the nth element (0-indexed)
 * When notFound is provided, returns it if index is out of bounds
 */
export function nth<T, D = T>(
  coll: Iterable<T> | null | undefined,
  index: number,
  notFound?: D,
): T | D | undefined;

/**
 * Counts elements in a collection
 */
export function count(coll: Iterable<any> | null | undefined): number;

/**
 * Returns the second element
 */
export function second<T>(coll: Iterable<T> | null | undefined): T | undefined;

/**
 * Returns the last element
 */
export function last<T>(coll: Iterable<T> | null | undefined): T | undefined;

/**
 * Checks if collection is empty
 */
export function isEmpty(coll: Iterable<any> | null | undefined): boolean;

/**
 * Tests if any element satisfies predicate
 */
export function some<T>(
  pred: (item: T) => boolean,
  coll: Iterable<T> | null | undefined,
): boolean;

/**
 * Tests if all elements satisfy predicate
 */
export function every<T>(
  pred: (item: T) => boolean,
  coll: Iterable<T> | null | undefined,
): boolean;

/**
 * Tests if no elements satisfy predicate
 */
export function notAny<T>(
  pred: (item: T) => boolean,
  coll: Iterable<T> | null | undefined,
): boolean;

/**
 * Tests if not all elements satisfy predicate
 */
export function notEvery<T>(
  pred: (item: T) => boolean,
  coll: Iterable<T> | null | undefined,
): boolean;

/**
 * Takes first n elements
 */
export function take<T>(
  n: number,
  coll: Iterable<T> | null | undefined,
): Iterable<T>;

/**
 * Drops first n elements
 */
export function drop<T>(
  n: number,
  coll: Iterable<T> | null | undefined,
): Iterable<T>;

/**
 * Maps function over collection
 */
export function map<T, R>(
  fn: (item: T) => R,
  coll: Iterable<T> | null | undefined,
): Iterable<R>;

/**
 * Filters collection by predicate
 */
export function filter<T>(
  pred: (item: T) => boolean,
  coll: Iterable<T> | null | undefined,
): Iterable<T>;

/**
 * Reduces collection to single value
 */
export function reduce<T, R>(
  fn: (acc: R, item: T) => R,
  init: R,
  coll: Iterable<T> | null | undefined,
): R;

/**
 * Concatenates collections
 */
export function concat<T>(
  ...colls: (Iterable<T> | null | undefined)[]
): Iterable<T>;

/**
 * Flattens nested collections
 */
export function flatten<T>(coll: Iterable<any> | null | undefined): Iterable<T>;

/**
 * Returns distinct elements
 */
export function distinct<T>(coll: Iterable<T> | null | undefined): Iterable<T>;

/**
 * Maps function with index (index is first parameter)
 */
export function mapIndexed<T, R>(
  fn: (index: number, item: T) => R,
  coll: Iterable<T> | null | undefined,
): Iterable<R>;

/**
 * Maps and filters non-nil results
 */
export function keep<T, R>(
  fn: (item: T) => R | null | undefined,
  coll: Iterable<T> | null | undefined,
): Iterable<R>;

/**
 * Keeps elements with non-nil indexed results (index is first parameter)
 */
export function keepIndexed<T, R>(
  fn: (index: number, item: T) => R | null | undefined,
  coll: Iterable<T> | null | undefined,
): Iterable<R>;

/**
 * Maps and concatenates results
 */
export function mapcat<T, R>(
  fn: (item: T) => Iterable<R>,
  coll: Iterable<T> | null | undefined,
): Iterable<R>;

/**
 * Creates a range of numbers
 */
export function range(
  start: number,
  end?: number,
  step?: number,
): Iterable<number>;

/**
 * Groups elements by key function
 */
export function groupBy<T, K extends string | number | symbol>(
  keyFn: (item: T) => K,
  coll: Iterable<T> | null | undefined,
): Record<K, T[]>;

/**
 * Forces realization of lazy sequence
 */
export function realize<T>(coll: Iterable<T> | null | undefined): T[];

/**
 * Forces realization of lazy sequence (alias for realize)
 */
export function doall<T>(coll: Iterable<T> | null | undefined): T[];

/**
 * Converts to array
 */
export function toArray<T>(coll: Iterable<T> | null | undefined): T[];

/**
 * Converts to set
 */
export function toSet<T>(coll: Iterable<T> | null | undefined): Set<T>;

/**
 * Creates lazy sequence
 */
export function seq<T>(
  coll: Iterable<T> | Record<string, any> | null | undefined,
): Iterable<T> | null;

/**
 * Conjoins value into collection
 * Arrays: appends items, Objects: merges [key, value] pairs,
 * Sets: adds items, Maps: adds [key, value] pairs, Strings: concatenates
 */
export function conj<T>(coll: T[], ...items: T[]): T[];
export function conj(coll: string, ...items: string[]): string;
export function conj<U>(coll: Set<U>, ...items: U[]): Set<U>;
export function conj<K, V>(coll: Map<K, V>, ...items: [K, V][]): Map<K, V>;
export function conj(coll: null | undefined, ...items: unknown[]): unknown[];
export function conj<T extends Record<string, unknown>>(coll: T, ...items: [string, unknown][]): Record<string, unknown>;
export function conj(coll: unknown, ...items: unknown[]): unknown;

/**
 * Transforms collection into target
 */
export function into<T>(target: any, from: Iterable<T> | null | undefined): any;

/**
 * Pours collection into target collection type
 */
export function pour<T>(
  targetType: any,
  coll: Iterable<T> | null | undefined,
): any;

/**
 * Cycles through collection infinitely
 */
export function cycle<T>(coll: Iterable<T> | null | undefined): Iterable<T>;

// ============================================================================
// MAP/OBJECT FUNCTIONS (with overloads for proper type inference)
// ============================================================================

/**
 * Gets value from map/object by key
 */
export function get<V>(
  map: Record<string, V> | null | undefined,
  key: string,
  notFound?: V,
): V | undefined;
export function get<K, V>(
  map: Map<K, V> | null | undefined,
  key: K,
  notFound?: V,
): V | undefined;

/**
 * Gets nested value from map/object by path
 */
export function getIn<T = any>(
  map: any | null | undefined,
  path: Iterable<any>,
  notFound?: T,
): T | undefined;

/**
 * Associates key with value in map/object
 * Returns same type as input
 */
export function assoc(map: any | null | undefined, key: any, value: any): any;

/**
 * Associates nested key with value
 */
export function assocIn(
  map: any | null | undefined,
  path: Iterable<any>,
  value: any,
): any;

/**
 * Dissociates keys from map/object
 */
export function dissoc(map: any | null | undefined, ...keys: any[]): any;

/**
 * Updates value at key with function
 */
export function update(
  map: any | null | undefined,
  key: any,
  fn: (value: any) => any,
): any;

/**
 * Updates nested value with function
 */
export function updateIn(
  map: any | null | undefined,
  path: Iterable<any>,
  fn: (value: any) => any,
): any;

/**
 * Merges multiple maps/objects
 */
export function merge(...maps: (any | null | undefined)[]): any;

/**
 * Returns keys of map/object
 */
export function keys<K extends string>(
  map: Record<K, any> | null | undefined,
): K[];
export function keys<K>(map: Map<K, any> | null | undefined): K[];

/**
 * Returns values of map/object
 */
export function vals<V>(
  map: Record<any, V> | Map<any, V> | null | undefined,
): V[];

/**
 * Zips arrays into tuples
 */
export function zip<T>(...arrays: Iterable<T>[]): Iterable<T[]>;

/**
 * Zips with custom function
 */
export function zipWith<T, R>(
  fn: (...items: T[]) => R,
  ...arrays: Iterable<T>[]
): Iterable<R>;

// ============================================================================
// FUNCTION UTILITIES
// ============================================================================

/**
 * Composes functions right to left
 */
export function comp<T>(...fns: Array<(arg: any) => any>): (arg: T) => any;

/**
 * Partially applies function
 */
export function partial<T extends (...args: any[]) => any>(
  fn: T,
  ...partialArgs: any[]
): (...remainingArgs: any[]) => ReturnType<T>;

/**
 * Applies function to argument list
 */
export function apply<T>(
  fn: (...args: any[]) => T,
  args: Iterable<any> | null | undefined,
): T;

/**
 * Creates infinite sequence by repeatedly applying function
 */
export function iterate<T>(fn: (value: T) => T, init: T): Iterable<T>;

/**
 * Checks if value implements SEQ protocol
 */
export function isSeq(value: any): boolean;

// ============================================================================
// LAZY SEQUENCE CLASSES
// ============================================================================

/**
 * LazySeq class for lazy sequence operations
 */
export class LazySeq<T> implements Iterable<T> {
  constructor(thunk: () => Iterable<T> | null);
  [Symbol.iterator](): Iterator<T>;
}

/**
 * NumericRange class for numeric ranges
 */
export class NumericRange implements Iterable<number> {
  constructor(start: number, end: number, step?: number);
  [Symbol.iterator](): Iterator<number>;
}

/**
 * Delay class for delayed evaluation
 */
export class Delay<T> {
  constructor(thunk: () => T);
  deref(): T;
  isRealized(): boolean;
}

// ============================================================================
// ADDITIONAL LAZY CONSTRUCTORS
// ============================================================================

/**
 * Creates an infinite sequence of the same value
 */
export function repeat<T>(value: T): Iterable<T>;

/**
 * Creates an infinite sequence by repeatedly calling function
 */
export function repeatedly<T>(fn: () => T): Iterable<T>;

// ============================================================================
// ADDITIONAL PREDICATES
// ============================================================================

/**
 * Returns true if value is not nil (not null and not undefined)
 */
export function isSome(value: any): boolean;

/**
 * Checks if value is nil (null or undefined)
 */
export function isNil(value: any): boolean;

/**
 * Checks if number is even
 */
export function isEven(n: number): boolean;

/**
 * Checks if number is odd
 */
export function isOdd(n: number): boolean;

/**
 * Checks if number is zero
 */
export function isZero(n: number): boolean;

/**
 * Checks if number is positive
 */
export function isPositive(n: number): boolean;

/**
 * Checks if number is negative
 */
export function isNegative(n: number): boolean;

/**
 * Checks if value is a number
 */
export function isNumber(value: any): value is number;

/**
 * Checks if value is a string
 */
export function isString(value: any): value is string;

/**
 * Checks if value is a boolean
 */
export function isBoolean(value: any): value is boolean;

/**
 * Checks if value is a function
 */
export function isFunction(value: any): value is Function;

/**
 * Checks if value is an array
 */
export function isArray(value: any): value is any[];

// ============================================================================
// ARITHMETIC
// ============================================================================

/**
 * Increment by 1
 */
export function inc(n: number): number;

/**
 * Decrement by 1
 */
export function dec(n: number): number;

/**
 * Add numbers
 */
export function add(...nums: number[]): number;

/**
 * Subtract numbers
 */
export function sub(...nums: number[]): number;

/**
 * Multiply numbers
 */
export function mul(...nums: number[]): number;

/**
 * Divide numbers
 */
export function div(...nums: number[]): number;

/**
 * Modulo operation
 */
export function mod(a: number, b: number): number;

// ============================================================================
// COMPARISON
// ============================================================================

/**
 * Equality check
 */
export function eq<T>(a: T, b: T): boolean;

/**
 * Not-equal check
 */
export function neq<T>(a: T, b: T): boolean;

/**
 * Less than
 */
export function lt(...nums: number[]): boolean;

/**
 * Greater than
 */
export function gt(...nums: number[]): boolean;

/**
 * Less than or equal
 */
export function lte(...nums: number[]): boolean;

/**
 * Greater than or equal
 */
export function gte(...nums: number[]): boolean;

// ============================================================================
// ADDITIONAL SEQUENCE OPERATIONS
// ============================================================================

/**
 * Returns the next element after first (rest but returns null for empty)
 */
export function next<T>(coll: Iterable<T> | null | undefined): Iterable<T> | null;

/**
 * Returns an empty collection of the same type
 * For arrays returns [], for Sets returns new Set(), for Maps returns new Map(),
 * for strings returns "", for objects returns {}, for null/undefined returns null
 */
export function empty<T extends any[]>(coll: T): T;
export function empty(coll: string): string;
export function empty<U>(coll: Set<U>): Set<U>;
export function empty<K, V>(coll: Map<K, V>): Map<K, V>;
export function empty(coll: null | undefined): null;
export function empty<T extends Record<string, unknown>>(coll: T): Partial<T>;
export function empty(coll: unknown): unknown;

/**
 * Reverses a collection
 */
export function reverse<T>(coll: Iterable<T> | null | undefined): T[];

/**
 * Takes elements while predicate is true
 */
export function takeWhile<T>(
  pred: (item: T) => boolean,
  coll: Iterable<T> | null | undefined,
): Iterable<T>;

/**
 * Drops elements while predicate is true
 */
export function dropWhile<T>(
  pred: (item: T) => boolean,
  coll: Iterable<T> | null | undefined,
): Iterable<T>;

/**
 * Splits collection by predicate
 */
export function splitWith<T>(
  pred: (item: T) => boolean,
  coll: Iterable<T> | null | undefined,
): [T[], T[]];

/**
 * Splits collection at index
 */
export function splitAt<T>(
  n: number,
  coll: Iterable<T> | null | undefined,
): [T[], T[]];

/**
 * Interleaves elements from collections
 */
export function interleave<T>(...colls: Iterable<T>[]): Iterable<T>;

/**
 * Interposes separator between elements
 */
export function interpose<T>(sep: T, coll: Iterable<T> | null | undefined): Iterable<T>;

/**
 * Partitions collection into chunks
 */
export function partition<T>(
  n: number,
  coll: Iterable<T> | null | undefined,
): Iterable<T[]>;

/**
 * Partitions collection into chunks (includes partial final chunk)
 */
export function partitionAll<T>(
  n: number,
  coll: Iterable<T> | null | undefined,
): Iterable<T[]>;

/**
 * Partitions by grouping consecutive elements with same key
 */
export function partitionBy<T, K>(
  fn: (item: T) => K,
  coll: Iterable<T> | null | undefined,
): Iterable<T[]>;

/**
 * Returns intermediate reduction values
 */
export function reductions<T, R>(
  fn: (acc: R, item: T) => R,
  init: R,
  coll: Iterable<T> | null | undefined,
): Iterable<R>;

// ============================================================================
// SYMBOL/KEYWORD
// ============================================================================

/**
 * Creates a symbol
 */
export function symbol(name: string): symbol;

/**
 * Creates a keyword (string prefixed with :)
 */
export function keyword(name: string): string;

/**
 * Returns the name of a symbol or keyword
 */
export function name(sym: symbol | string): string;

// ============================================================================
// TYPE CONVERSIONS
// ============================================================================

/**
 * Converts to vector (array)
 */
export function vec<T>(coll: Iterable<T> | null | undefined): T[];

/**
 * Converts to set
 */
export function set<T>(coll: Iterable<T> | null | undefined): Set<T>;

// ============================================================================
// TRANSDUCERS
// ============================================================================

export type Transducer<T, R> = (
  reducer: (acc: any, item: R) => any
) => (acc: any, item: T) => any;

/**
 * Map transducer
 */
export function mapT<T, R>(fn: (item: T) => R): Transducer<T, R>;

/**
 * Filter transducer
 */
export function filterT<T>(pred: (item: T) => boolean): Transducer<T, T>;

/**
 * Take transducer
 */
export function takeT<T>(n: number): Transducer<T, T>;

/**
 * Drop transducer
 */
export function dropT<T>(n: number): Transducer<T, T>;

/**
 * Take-while transducer
 */
export function takeWhileT<T>(pred: (item: T) => boolean): Transducer<T, T>;

/**
 * Drop-while transducer
 */
export function dropWhileT<T>(pred: (item: T) => boolean): Transducer<T, T>;

/**
 * Distinct transducer
 */
export function distinctT<T>(): Transducer<T, T>;

/**
 * Partition-all transducer
 */
export function partitionAllT<T>(n: number): Transducer<T, T[]>;

/**
 * Composes transducers
 */
export function composeTransducers<T, R>(
  ...xforms: Transducer<any, any>[]
): Transducer<T, R>;

// ============================================================================
// CHUNKING INFRASTRUCTURE
// ============================================================================

/**
 * Chunk size constant (32 elements)
 */
export const CHUNK_SIZE: number;

/**
 * ArrayChunk class for chunked sequences
 */
export class ArrayChunk<T> {
  constructor(arr: T[], offset?: number, length?: number);
  count(): number;
  nth(i: number): T;
  reduce<R>(fn: (acc: R, item: T) => R, init: R): R;
}

/**
 * ChunkBuffer class for building chunks
 */
export class ChunkBuffer<T> {
  constructor();
  add(item: T): void;
  chunk(): ArrayChunk<T>;
  count(): number;
}

/**
 * ChunkedCons class for chunked lazy sequences
 */
export class ChunkedCons<T> implements Iterable<T> {
  constructor(chunk: ArrayChunk<T>, rest: Iterable<T> | null);
  [Symbol.iterator](): Iterator<T>;
}

// ============================================================================
// PUBLIC API OBJECT
// ============================================================================

/**
 * Object containing all public stdlib functions
 */
export const STDLIB_PUBLIC_API: Record<string, (...args: any[]) => any>;
