// src/interpreter/builtins.ts - Built-in primitive operations

import { InterpreterEnv } from "./environment.ts";
import type { HQLValue, BuiltinFn } from "./types.ts";
import { isHQLFunction, isSExp } from "./types.ts";
import { ArityError, TypeError, getTypeName } from "./errors.ts";
import { gensym, GensymSymbol } from "../gensym.ts";
import {
  createList,
  createLiteral,
  createNilLiteral,
  isSymbol,
  isList,
  isLiteral,
  type SSymbol,
  type SList,
  type SExp,
} from "../s-exp/types.ts";

/**
 * Load all built-in functions into an environment
 */
export function loadBuiltins(env: InterpreterEnv): void {
  // Arithmetic
  env.define("+", builtinAdd);
  env.define("-", builtinSub);
  env.define("*", builtinMul);
  env.define("/", builtinDiv);
  env.define("%", builtinMod);
  env.define("mod", builtinMod);

  // Comparison
  env.define("=", builtinEq);
  env.define("==", builtinEq);
  env.define("===", builtinStrictEq);
  env.define("!=", builtinNeq);
  env.define("!==", builtinStrictNeq);
  env.define("<", builtinLt);
  env.define(">", builtinGt);
  env.define("<=", builtinLte);
  env.define(">=", builtinGte);

  // Type predicates
  env.define("nil?", builtinIsNil);
  env.define("isNil", builtinIsNil);
  env.define("number?", builtinIsNumber);
  env.define("isNumber", builtinIsNumber);
  env.define("string?", builtinIsString);
  env.define("isString", builtinIsString);
  env.define("boolean?", builtinIsBoolean);
  env.define("isBoolean", builtinIsBoolean);
  env.define("function?", builtinIsFunction);
  env.define("isFunction", builtinIsFunction);
  env.define("list?", builtinIsList);
  env.define("symbol?", builtinIsSymbol);
  env.define("array?", builtinIsArray);
  env.define("isArray", builtinIsArray);

  // NOTE: %first, %rest, %length, %nth, %empty? are COMPILER-ONLY primitives.
  // They are defined in src/environment.ts, NOT here.
  // The bridgeToInterpreterEnv() function filters them out to prevent copying.

  // Meta operations
  env.define("name", builtinName);
  env.define("gensym", builtinGensym);

  // Logic
  env.define("not", builtinNot);

  // Type coercion
  env.define("str", builtinStr);

  // Collection constructors
  env.define("vector", builtinVector);
  env.define("list", builtinList);
  env.define("hash-map", builtinHashMap);
  env.define("hash-set", builtinHashSet);

  // Empty collection constructors (for [] {} #{} syntax)
  env.define("empty-array", builtinEmptyArray);
  env.define("empty-map", builtinEmptyMap);
  env.define("empty-set", builtinEmptySet);
}

// ============================================================================
// Arithmetic
// ============================================================================

const builtinAdd: BuiltinFn = (args) => {
  if (args.length === 0) return 0;
  return args.reduce((acc: number, val) => {
    if (typeof val !== "number") {
      throw new TypeError("number", getTypeName(val), "+");
    }
    return acc + val;
  }, 0);
};

const builtinSub: BuiltinFn = (args) => {
  if (args.length === 0) throw new ArityError("-", "at least 1", 0);
  if (args.length === 1) {
    const val = args[0];
    if (typeof val !== "number") {
      throw new TypeError("number", getTypeName(val), "-");
    }
    return -val;
  }
  return args.reduce((acc: number | null, val, i) => {
    if (typeof val !== "number") {
      throw new TypeError("number", getTypeName(val), "-");
    }
    return acc === null ? val : acc - val;
  }, null) as number;
};

const builtinMul: BuiltinFn = (args) => {
  if (args.length === 0) return 1;
  return args.reduce((acc: number, val) => {
    if (typeof val !== "number") {
      throw new TypeError("number", getTypeName(val), "*");
    }
    return acc * val;
  }, 1);
};

const builtinDiv: BuiltinFn = (args) => {
  if (args.length === 0) throw new ArityError("/", "at least 1", 0);
  if (args.length === 1) {
    const val = args[0];
    if (typeof val !== "number") {
      throw new TypeError("number", getTypeName(val), "/");
    }
    return 1 / val;
  }
  return args.reduce((acc: number | null, val, i) => {
    if (typeof val !== "number") {
      throw new TypeError("number", getTypeName(val), "/");
    }
    if (i > 0 && val === 0) {
      throw new TypeError("non-zero number", "0", "/");
    }
    return acc === null ? val : acc / val;
  }, null) as number;
};

const builtinMod: BuiltinFn = (args) => {
  if (args.length !== 2) throw new ArityError("%", 2, args.length);
  const [a, b] = args;
  if (typeof a !== "number" || typeof b !== "number") {
    throw new TypeError("numbers", `${getTypeName(a)}, ${getTypeName(b)}`, "%");
  }
  if (b === 0) {
    throw new TypeError("non-zero divisor", "0", "%");
  }
  return a % b;
};

// ============================================================================
// Comparison
// ============================================================================

const builtinEq: BuiltinFn = (args) => {
  if (args.length < 2) return true;
  const first = args[0];
  return args.slice(1).every((arg) => first == arg);
};

const builtinStrictEq: BuiltinFn = (args) => {
  if (args.length < 2) return true;
  const first = args[0];
  return args.slice(1).every((arg) => first === arg);
};

const builtinNeq: BuiltinFn = (args) => {
  if (args.length !== 2) throw new ArityError("!=", 2, args.length);
  return args[0] != args[1];
};

const builtinStrictNeq: BuiltinFn = (args) => {
  if (args.length !== 2) throw new ArityError("!==", 2, args.length);
  return args[0] !== args[1];
};

/**
 * Helper for numeric comparison builtins (DRY)
 * Validates all args are numbers and applies comparator pairwise
 */
function makeNumericComparison(
  op: string,
  compare: (a: number, b: number) => boolean
): BuiltinFn {
  return (args) => {
    if (args.length < 2) return true;
    for (let i = 0; i < args.length - 1; i++) {
      const a = args[i];
      const b = args[i + 1];
      if (typeof a !== "number" || typeof b !== "number") {
        throw new TypeError("numbers", `${getTypeName(a)}, ${getTypeName(b)}`, op);
      }
      if (!compare(a, b)) return false;
    }
    return true;
  };
}

const builtinLt = makeNumericComparison("<", (a, b) => a < b);
const builtinGt = makeNumericComparison(">", (a, b) => a > b);
const builtinLte = makeNumericComparison("<=", (a, b) => a <= b);
const builtinGte = makeNumericComparison(">=", (a, b) => a >= b);

// ============================================================================
// Type Predicates
// ============================================================================

const builtinIsNil: BuiltinFn = (args) => {
  if (args.length !== 1) throw new ArityError("nil?", 1, args.length);
  return args[0] === null;
};

const builtinIsNumber: BuiltinFn = (args) => {
  if (args.length !== 1) throw new ArityError("number?", 1, args.length);
  return typeof args[0] === "number";
};

const builtinIsString: BuiltinFn = (args) => {
  if (args.length !== 1) throw new ArityError("string?", 1, args.length);
  return typeof args[0] === "string";
};

const builtinIsBoolean: BuiltinFn = (args) => {
  if (args.length !== 1) throw new ArityError("boolean?", 1, args.length);
  return typeof args[0] === "boolean";
};

const builtinIsFunction: BuiltinFn = (args) => {
  if (args.length !== 1) throw new ArityError("function?", 1, args.length);
  return isHQLFunction(args[0]) || typeof args[0] === "function";
};

const builtinIsList: BuiltinFn = (args) => {
  if (args.length !== 1) throw new ArityError("list?", 1, args.length);
  const val = args[0];
  return isSExp(val) && isList(val);
};

const builtinIsSymbol: BuiltinFn = (args) => {
  if (args.length !== 1) throw new ArityError("symbol?", 1, args.length);
  const val = args[0];
  return isSExp(val) && isSymbol(val);
};

const builtinIsArray: BuiltinFn = (args) => {
  if (args.length !== 1) throw new ArityError("array?", 1, args.length);
  return Array.isArray(args[0]);
};

// ============================================================================
// S-Expression Operations (Macro-Time Helpers)
// ============================================================================

/**
 * Check if an S-expression list is a vector form: (vector x y z)
 * Returns the actual elements (without "vector" prefix) or null if not a vector
 */
function getVectorElements(coll: HQLValue): SExp[] | null {
  if (!isSExp(coll) || !isList(coll)) return null;
  const list = coll as SList;
  if (
    list.elements.length > 0 &&
    isSymbol(list.elements[0]) &&
    (list.elements[0] as SSymbol).name === "vector"
  ) {
    return list.elements.slice(1);
  }
  return null;
}

const builtinFirst: BuiltinFn = (args) => {
  if (args.length !== 1) throw new ArityError("%first", 1, args.length);
  const coll = args[0];

  if (coll === null) return null;

  // Check for vector form first
  const vectorElems = getVectorElements(coll);
  if (vectorElems !== null) {
    return vectorElems.length > 0 ? vectorElems[0] : null;
  }

  // Handle S-expression list
  if (isSExp(coll) && isList(coll)) {
    const list = coll as SList;
    return list.elements.length > 0 ? list.elements[0] : null;
  }

  // Handle array
  if (Array.isArray(coll)) {
    return coll.length > 0 ? coll[0] : null;
  }

  return null;
};

const builtinRest: BuiltinFn = (args) => {
  if (args.length !== 1) throw new ArityError("%rest", 1, args.length);
  const coll = args[0];

  if (coll === null) return createList();

  // Check for vector form first
  const vectorElems = getVectorElements(coll);
  if (vectorElems !== null) {
    return vectorElems.length > 1 ? createList(...vectorElems.slice(1)) : createList();
  }

  // Handle S-expression list
  if (isSExp(coll) && isList(coll)) {
    const list = coll as SList;
    return list.elements.length > 0 ? createList(...list.elements.slice(1)) : createList();
  }

  // Handle array
  if (Array.isArray(coll)) {
    return coll.length > 0 ? coll.slice(1) : [];
  }

  return createList();
};

const builtinLength: BuiltinFn = (args) => {
  if (args.length !== 1) throw new ArityError("%length", 1, args.length);
  const coll = args[0];

  if (coll === null) return 0;

  // Check for vector form first
  const vectorElems = getVectorElements(coll);
  if (vectorElems !== null) {
    return vectorElems.length;
  }

  // Handle S-expression list
  if (isSExp(coll) && isList(coll)) {
    return (coll as SList).elements.length;
  }

  // Handle array
  if (Array.isArray(coll)) {
    return coll.length;
  }

  // Handle string
  if (typeof coll === "string") {
    return coll.length;
  }

  return 0;
};

const builtinNth: BuiltinFn = (args) => {
  if (args.length !== 2) throw new ArityError("%nth", 2, args.length);
  const [coll, index] = args;

  if (typeof index !== "number") {
    throw new TypeError("number", getTypeName(index), "%nth index");
  }

  if (coll === null) return null;

  // Check for vector form first
  const vectorElems = getVectorElements(coll);
  if (vectorElems !== null) {
    return index < vectorElems.length ? vectorElems[index] : null;
  }

  // Handle S-expression list
  if (isSExp(coll) && isList(coll)) {
    const elements = (coll as SList).elements;
    return index < elements.length ? elements[index] : null;
  }

  // Handle array
  if (Array.isArray(coll)) {
    return index < coll.length ? coll[index] : null;
  }

  return null;
};

const builtinIsEmpty: BuiltinFn = (args) => {
  if (args.length !== 1) throw new ArityError("%empty?", 1, args.length);
  const coll = args[0];

  if (coll === null) return true;

  // Check for vector form first
  const vectorElems = getVectorElements(coll);
  if (vectorElems !== null) {
    return vectorElems.length === 0;
  }

  // Handle S-expression list
  if (isSExp(coll) && isList(coll)) {
    return (coll as SList).elements.length === 0;
  }

  // Handle array
  if (Array.isArray(coll)) {
    return coll.length === 0;
  }

  // Handle string
  if (typeof coll === "string") {
    return coll.length === 0;
  }

  return true;
};

// ============================================================================
// Meta Operations
// ============================================================================

const builtinName: BuiltinFn = (args) => {
  if (args.length !== 1) throw new ArityError("name", 1, args.length);
  const val = args[0];

  // Handle S-expression symbol
  if (isSExp(val) && isSymbol(val)) {
    return (val as SSymbol).name;
  }

  // Handle GensymSymbol
  if (val instanceof GensymSymbol) {
    return val.name;
  }

  // Handle string (return as-is)
  if (typeof val === "string") {
    return val;
  }

  return null;
};

const builtinGensym: BuiltinFn = (args) => {
  const prefix = args.length > 0 && typeof args[0] === "string" ? args[0] : "g";
  const sym = gensym(prefix);
  // Return as S-expression symbol for macro use
  return { type: "symbol", name: sym.name } as SSymbol;
};

// ============================================================================
// Logic
// ============================================================================

const builtinNot: BuiltinFn = (args) => {
  if (args.length !== 1) throw new ArityError("not", 1, args.length);
  const val = args[0];
  // Only false and nil are falsy
  return val === false || val === null;
};

// ============================================================================
// Type Coercion
// ============================================================================

const builtinStr: BuiltinFn = (args) => {
  if (args.length === 0) return "";
  return args.map((arg) => {
    if (arg === null) return "";
    if (typeof arg === "string") return arg;
    if (typeof arg === "number" || typeof arg === "boolean") return String(arg);
    if (Array.isArray(arg)) return `[${arg.map(String).join(", ")}]`;
    if (isSExp(arg)) {
      if (isSymbol(arg)) return (arg as SSymbol).name;
      if (isLiteral(arg)) return String((arg as { value: unknown }).value);
    }
    return String(arg);
  }).join("");
};

// ============================================================================
// Collection Constructors
// ============================================================================

/**
 * (vector 1 2 3) => [1, 2, 3]
 * Handles [1 2 3] syntax which parses to (vector 1 2 3)
 */
const builtinVector: BuiltinFn = (args) => {
  return args as HQLValue[];
};

/**
 * (list 1 2 3) => (1 2 3) as S-expression list
 */
const builtinList: BuiltinFn = (args) => {
  // Return as an S-expression list for macro use
  const elements: SExp[] = args.map((arg) => {
    if (isSExp(arg)) return arg as SExp;
    if (arg === null) return createNilLiteral();
    if (typeof arg === "number" || typeof arg === "string" || typeof arg === "boolean") {
      return createLiteral(arg);
    }
    // For arrays, recursively convert
    if (Array.isArray(arg)) {
      // Represent as nested list
      return createList(...arg.map((item) => {
        if (typeof item === "number" || typeof item === "string" || typeof item === "boolean") {
          return createLiteral(item);
        }
        if (item === null) return createNilLiteral();
        return createLiteral(String(item));
      }));
    }
    // For other complex values, convert to string literal
    return createLiteral(String(arg));
  });
  return createList(...elements);
};

/**
 * (hash-map k1 v1 k2 v2 ...) => Map { k1 => v1, k2 => v2, ... }
 */
const builtinHashMap: BuiltinFn = (args) => {
  if (args.length % 2 !== 0) {
    throw new ArityError("hash-map", "even number", args.length);
  }
  const map = new Map<string, HQLValue>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    // Convert key to string
    const keyStr = typeof key === "string" ? key : String(key);
    map.set(keyStr, value);
  }
  return map;
};

/**
 * (hash-set v1 v2 ...) => Set { v1, v2, ... }
 */
const builtinHashSet: BuiltinFn = (args) => {
  return new Set(args) as Set<HQLValue>;
};

/**
 * (empty-array) => []
 * Handles [] syntax which parses to (empty-array)
 */
const builtinEmptyArray: BuiltinFn = () => {
  return [] as HQLValue[];
};

/**
 * (empty-map) => {}
 * Handles {} syntax which parses to (empty-map)
 */
const builtinEmptyMap: BuiltinFn = () => {
  return new Map<string, HQLValue>();
};

/**
 * (empty-set) => #{}
 * Handles #{} syntax which parses to (empty-set)
 */
const builtinEmptySet: BuiltinFn = () => {
  return new Set<HQLValue>();
};
