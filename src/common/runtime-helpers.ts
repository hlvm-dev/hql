import { globalLogger as logger } from "../logger.ts";
import { isNullish, getErrorMessage } from "./utils.ts";
import { getPlatform } from "../platform/platform.ts";
import {
  __hql_deepFreeze,
  __hql_for_each,
  __hql_get,
  __hql_hash_map,
  __hql_match_obj,
  __hql_range,
  __hql_throw,
  __hql_toIterable,
  __hql_toSequence,
  __hql_trampoline,
  __hql_trampoline_gen,
  GEN_THUNK_SYMBOL,
} from "./runtime-helper-impl.ts";
import { __hql_get_op, __hql_lazy_seq, __hql_delay } from "../hql/lib/stdlib/js/core.js";
import { STDLIB_PUBLIC_API } from "../hql/lib/stdlib/js/stdlib.js";
import { gensym as gensymImpl } from "../hql/gensym.ts";

type HlvmMeta = {
  filePath?: string;
  line?: number;
  column?: number;
};

type GlobalHlvmHelpers = {
  __hql_get: (target: unknown, property: unknown, meta?: HlvmMeta) => unknown;
  __hql_call: (
    target: unknown,
    property: unknown,
    meta: HlvmMeta | undefined,
    ...args: unknown[]
  ) => unknown;
  __hql_set?: (
    target: unknown,
    property: unknown,
    value: unknown,
    meta?: HlvmMeta,
  ) => unknown;
  __hql_callFn: (
    fn: unknown,
    meta: HlvmMeta | undefined,
    ...args: unknown[]
  ) => unknown;
  __hql_getNumeric?: (
    target: unknown,
    property: unknown,
    meta?: HlvmMeta,
  ) => unknown;
  __hql_range?: typeof __hql_range;
  __hql_toSequence?: typeof __hql_toSequence;
  __hql_toIterable?: typeof __hql_toIterable;
  __hql_for_each?: typeof __hql_for_each;
  __hql_hash_map?: typeof __hql_hash_map;
  __hql_match_obj?: typeof __hql_match_obj;
  __hql_throw?: typeof __hql_throw;
  __hql_deepFreeze?: typeof __hql_deepFreeze;
  __hql_trampoline?: typeof __hql_trampoline;
  __hql_trampoline_gen?: typeof __hql_trampoline_gen;
  __hql_gen_thunk_symbol?: typeof GEN_THUNK_SYMBOL;
  __hql_get_op?: typeof __hql_get_op;
  __hql_lazy_seq?: typeof __hql_lazy_seq;
  __hql_delay?: typeof __hql_delay;
  gensym?: (prefix?: string) => string;
  _?: unknown;
  hlvm?: HlvmHostApi;
} & Omit<typeof globalThis, "__hql_get" | "__hql_call" | "__hql_callFn">;

/**
 * Host API exposed to HQL code as `hlvm` global
 * This allows HQL packages to access platform operations without directly using Deno/Node APIs
 * Naming follows industry standard: Deno, Bun, process (no underscores for public APIs)
 */
export interface HlvmHostApi {
  fs: {
    readTextFile: (path: string) => Promise<string>;
    readFile: (path: string) => Promise<Uint8Array>;
    writeTextFile: (path: string, content: string) => Promise<void>;
    remove: (path: string) => Promise<void>;
    stat: (path: string) => Promise<{ isFile: boolean; isDirectory: boolean; size: number }>;
    statSync: (path: string) => { isFile: boolean; isDirectory: boolean; size: number } | null;
    cwd: () => string;
  };
  env: {
    get: (key: string) => string | undefined;
    set: (key: string, value: string) => void;
  };
  log: {
    debug: (category: string, message: string, data?: unknown) => void;
    writeSync: (path: string, line: string) => void;
  };
}

const HLVM_META_KEY = "__hlvmMeta";

function attachMeta(error: Error, meta?: HlvmMeta): Error {
  const existing = (error as unknown as Record<string, unknown>)[HLVM_META_KEY];
  if (existing && typeof existing === "object") {
    return error;
  }

  if (!meta || typeof meta !== "object") {
    return error;
  }

  try {
    Object.defineProperty(error, HLVM_META_KEY, {
      value: meta,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  } catch (_) {
    try {
      (error as unknown as Record<string, unknown>)[HLVM_META_KEY] = meta;
    } catch (inner) {
      logger.debug(
        `Failed to attach meta to error: ${getErrorMessage(inner)}`,
      );
    }
  }

  return error;
}

function propertyName(property: unknown): string {
  if (typeof property === "symbol") {
    return property.description ?? property.toString();
  }
  return String(property);
}

function valueDescription(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "object") {
    const ctor = (value as { constructor?: { name?: string } })?.constructor
      ?.name;
    return `[object ${ctor ?? "Object"}]`;
  }
  return String(value);
}

function ensureHelpers(): void {
  // Cast to our strict interface - we will ensure these exist
  const globalAny = globalThis as unknown as GlobalHlvmHelpers;
  if (typeof globalAny.__hql_get === "function") {
    return;
  }

  const placeholderStore: { value: unknown } = { value: undefined };
  const placeholderProxy = new Proxy(function placeholder() {}, {
    get(_target, property: PropertyKey) {
      const current = placeholderStore.value;
      if (isNullish(current)) {
        if (property === Symbol.toPrimitive) {
          return () => undefined;
        }
        if (property === "valueOf") {
          return () => undefined;
        }
        if (property === "toString") {
          return () => "";
        }
        return typeof property === "string" ? property : undefined;
      }
      return (current as Record<PropertyKey, unknown>)[property];
    },
    apply(_target, thisArg, argArray) {
      const current = placeholderStore.value;
      if (typeof current === "function") {
        return current.apply(thisArg, argArray as []);
      }
      throw new TypeError("Placeholder value is not callable");
    },
  });

  if (!Object.getOwnPropertyDescriptor(globalAny, "_")) {
    Object.defineProperty(globalAny, "_", {
      configurable: true,
      get() {
        const current = placeholderStore.value;
        return current === undefined ? placeholderProxy : current;
      },
      set(value) {
        placeholderStore.value = value;
        return true;
      },
    });
  } else {
    const original = Object.getOwnPropertyDescriptor(globalAny, "_");
    if (original?.set) {
      const prevSetter = original.set;
      Object.defineProperty(globalAny, "_", {
        configurable: true,
        get() {
          const current = placeholderStore.value;
          return current === undefined ? placeholderProxy : current;
        },
        set(value) {
          placeholderStore.value = value;
          prevSetter.call(globalAny, value);
          return true;
        },
      });
    } else {
      Object.defineProperty(globalAny, "_", {
        configurable: true,
        get() {
          const current = placeholderStore.value;
          return current === undefined ? placeholderProxy : current;
        },
        set(value) {
          placeholderStore.value = value;
          return true;
        },
      });
    }
  }

  // Use the shared __hql_get implementation from runtime-helper-impl.ts
  // This ensures REPL and transpiled code have identical behavior (including function calling)
  if (typeof globalAny.__hql_get !== "function") {
    globalAny.__hql_get = __hql_get;
  }

  if (typeof globalAny.__hql_getNumeric !== "function") {
    globalAny.__hql_getNumeric = globalAny.__hql_get;
  }

  globalAny.__hql_call = function __hql_call(
    target: unknown,
    property: unknown,
    meta: HlvmMeta | undefined,
    ...args: unknown[]
  ) {
    const fn = globalAny.__hql_get(
      target,
      property,
      meta,
    );

    if (property === "get" && typeof fn !== "function") {
      if (args.length === 0) {
        throw attachMeta(
          new TypeError("get expects at least one argument"),
          meta,
        );
      }

      const [key, defaultValue] = args;
      const value = globalAny.__hql_get(
        target,
        key,
        meta,
      );

      const resolved = value === undefined ? defaultValue : value;
      globalAny._ = resolved;
      return resolved;
    }

    if (typeof fn !== "function") {
      if (args.length === 0) {
        globalAny._ = fn;
        return fn;
      }

      throw attachMeta(
        new TypeError(
          `'${propertyName(property)}' is not a function`,
        ),
        meta,
      );
    }

    try {
      const result = fn.apply(target, args);
      globalAny._ = result;
      return result;
    } catch (error) {
      const err = error instanceof Error
        ? error
        : new Error(String(error ?? "unknown"));
      throw attachMeta(err, meta);
    }
  };

  globalAny.__hql_callFn = function __hql_callFn(
    fn: unknown,
    meta: HlvmMeta | undefined,
    ...args: unknown[]
  ) {
    if (typeof fn !== "function") {
      throw attachMeta(
        new TypeError(`${valueDescription(fn)} is not a function`),
        meta,
      );
    }

    try {
      const result = (fn as (...innerArgs: unknown[]) => unknown).apply(
        this,
        args,
      );
      globalAny._ = result;
      return result;
    } catch (error) {
      if (error instanceof Error) {
        throw attachMeta(error, meta);
      }
      throw error;
    }
  };

  if (typeof globalAny.__hql_range !== "function") {
    globalAny.__hql_range = __hql_range;
  }

  if (typeof globalAny.__hql_toSequence !== "function") {
    globalAny.__hql_toSequence = __hql_toSequence;
  }

  if (typeof globalAny.__hql_toIterable !== "function") {
    globalAny.__hql_toIterable = __hql_toIterable;
  }

  if (typeof globalAny.__hql_for_each !== "function") {
    globalAny.__hql_for_each = __hql_for_each;
  }

  if (typeof globalAny.__hql_hash_map !== "function") {
    globalAny.__hql_hash_map = __hql_hash_map;
  }

  if (typeof globalAny.__hql_match_obj !== "function") {
    globalAny.__hql_match_obj = __hql_match_obj;
  }

  if (typeof globalAny.__hql_throw !== "function") {
    globalAny.__hql_throw = __hql_throw;
  }

  // Use the shared __hql_deepFreeze implementation from runtime-helper-impl.ts
  // This ensures REPL and transpiled code have identical behavior
  if (typeof globalAny.__hql_deepFreeze !== "function") {
    globalAny.__hql_deepFreeze = __hql_deepFreeze;
  }

  // Trampoline for mutual recursion TCO
  if (typeof globalAny.__hql_trampoline !== "function") {
    globalAny.__hql_trampoline = __hql_trampoline;
  }

  // Generator trampoline for mutual recursion TCO
  if (typeof globalAny.__hql_trampoline_gen !== "function") {
    globalAny.__hql_trampoline_gen = __hql_trampoline_gen;
  }

  // Generator thunk symbol for tagged thunks
  if (!globalAny.__hql_gen_thunk_symbol) {
    globalAny.__hql_gen_thunk_symbol = GEN_THUNK_SYMBOL;
  }

  // First-class operators: allows (reduce + 0 nums) by converting operator symbols to functions
  if (typeof globalAny.__hql_get_op !== "function") {
    globalAny.__hql_get_op = __hql_get_op;
  }

  // Self-hosted stdlib foundation: lazy-seq bridge function
  if (typeof globalAny.__hql_lazy_seq !== "function") {
    globalAny.__hql_lazy_seq = __hql_lazy_seq;
  }

  // Self-hosted stdlib foundation: delay bridge function (explicit laziness)
  if (typeof globalAny.__hql_delay !== "function") {
    globalAny.__hql_delay = __hql_delay;
  }

  // Add gensym for hygienic macros
  // Runtime gensym returns string (the generated symbol name)
  // Macro-time gensym (in environment.ts) returns GensymSymbol for proper unquoting
  if (typeof globalAny.gensym !== "function") {
    globalAny.gensym = function gensym(prefix?: string): string {
      return gensymImpl(prefix).name; // Extract .name from GensymSymbol
    };
  }

  // Auto-load stdlib functions - inject into global runtime
  // This loop automatically injects all functions from STDLIB_PUBLIC_API
  for (const [name, func] of Object.entries(STDLIB_PUBLIC_API)) {
    // We need a safe way to check/set properties on globalAny without index signature
    if (typeof (globalAny as unknown as Record<string, unknown>)[name] !== "function") {
      (globalAny as unknown as Record<string, unknown>)[name] = func;
    }
  }

  // Expose platform host API to HQL code as `hlvm` global
  // This allows HQL packages to use platform-agnostic operations
  if (!globalAny.hlvm) {
    const platform = getPlatform();
    globalAny.hlvm = {
      fs: {
        readTextFile: (path: string) => platform.fs.readTextFile(path),
        readFile: (path: string) => platform.fs.readFile(path),
        writeTextFile: (path: string, content: string) => platform.fs.writeTextFile(path, content),
        remove: (path: string) => platform.fs.remove(path),
        stat: async (path: string) => {
          const info = await platform.fs.stat(path);
          return { isFile: info.isFile, isDirectory: info.isDirectory, size: info.size };
        },
        statSync: (path: string) => {
          try {
            const info = platform.fs.statSync(path);
            return { isFile: info.isFile, isDirectory: info.isDirectory, size: info.size };
          } catch {
            return null;
          }
        },
        cwd: () => platform.process.cwd(),
      },
      env: {
        get: (key: string) => platform.env.get(key),
        set: (key: string, value: string) => platform.env.set(key, value),
      },
      log: {
        debug: (category: string, message: string, data?: unknown) => {
          // Debug logging - writes to ~/.hlvm/debug.log
          try {
            const home = platform.env.get("HOME") || "~";
            const logFile = `${home}/.hlvm/debug.log`;
            const timestamp = new Date().toISOString();
            const dataStr = data !== undefined ? ` | ${JSON.stringify(data)}` : "";
            const line = `[${timestamp}] [${category}] ${message}${dataStr}\n`;
            platform.fs.writeTextFileSync(logFile, line, { append: true });
          } catch {
            // Ignore logging errors
          }
        },
        writeSync: (path: string, line: string) => {
          try {
            platform.fs.writeTextFileSync(path, line, { append: true });
          } catch {
            // Ignore errors
          }
        },
      },
    };
  }
}

let helpersInitialized = false;

export function initializeRuntimeHelpers(): void {
  if (helpersInitialized) return;
  ensureHelpers();
  helpersInitialized = true;
}
