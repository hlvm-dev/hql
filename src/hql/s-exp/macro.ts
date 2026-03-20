// src/hql/s-exp/macro.ts - Refactored to remove user-level macro support

import {
  createList,
  createListFrom,
  createLiteral,
  createNilLiteral,
  createSymbol,
  getMeta,
  isDefMacro,
  isForm,
  isList,
  isLiteral,
  isSymbol,
  isVector,
  type Pattern,
  type ResolvedBindingMeta,
  type SExp,
  type SExpMeta,
  sexpToString,
  type SList,
  type SLiteral,
  type SSymbol,
} from "./types.ts";
import { couldBePattern, parsePattern } from "./pattern-parser.ts";
import type { Environment } from "../environment.ts";
import type { Logger } from "../../logger.ts";
import type { MacroFn } from "../environment.ts";
import { HQLError, MacroError } from "../../common/error.ts";
import { gensym, isGensymSymbol } from "../gensym.ts";
import { globalLogger as logger } from "../../logger.ts";
import {
  getErrorMessage,
  isNullish,
  isObjectValue,
  mapTail,
} from "../../common/utils.ts";
import {
  createStandardEnv,
  getSpecialForms,
  hqlValueToSExp,
  Interpreter,
  type InterpreterEnv,
} from "../interpreter/index.ts";
import {
  MAX_EXPANSION_ITERATIONS,
  MAX_SEQ_LENGTH,
} from "../../common/limits.ts";
import { globalSymbolTable } from "../transpiler/symbol_table.ts";

// Lazy singleton interpreter for macro-time evaluation
let macroInterpreter: Interpreter | null = null;
// Persistent environment for user-defined functions across macro expansions
let persistentMacroEnv: InterpreterEnv | null = null;

/**
 * Get or create the macro-time interpreter
 */
function getMacroInterpreter(): Interpreter {
  if (!macroInterpreter) {
    macroInterpreter = new Interpreter({
      maxCallDepth: 100,
      maxSeqLength: MAX_SEQ_LENGTH,
    });
  }
  return macroInterpreter;
}

/**
 * Get or create the persistent macro environment
 * This environment survives across macro expansions, allowing user-defined
 * functions to be used in later macros (like Clojure).
 */
function getPersistentMacroEnv(): InterpreterEnv {
  if (!persistentMacroEnv) {
    persistentMacroEnv = createStandardEnv();
  }
  return persistentMacroEnv;
}

/**
 * Reset macro state for hermetic compilation.
 * Call between compilation units to prevent cross-file macro leakage.
 * REPL mode should NOT call this (persistent env is intentional there).
 */
export function resetMacroState(): void {
  macroInterpreter = null;
  persistentMacroEnv = null;
}

/**
 * Convert S-expression value to HQL value for interpreter use
 * This is critical for bridging compiler env (S-expressions) to interpreter env (HQL values)
 *
 * IMPORTANT: We ONLY convert S-expression literals (primitives) to HQL values.
 * S-expression lists and symbols are kept as-is because:
 * - `list?` and `symbol?` introspection functions need S-expression objects
 * - Macro expansion works on S-expression AST nodes, not HQL runtime values
 */
function sexpToHqlValue(
  value: unknown,
): import("../interpreter/types.ts").HQLValue {
  // If it's already a primitive, return as-is (nil-punning: null or undefined → null)
  if (value == null) return null;
  if (
    typeof value === "boolean" || typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }

  // If it's an S-expression literal, extract the primitive value
  // This is the ONLY S-expression type we convert - literals become primitives
  if (isObjectValue(value) && (value as { type?: string }).type === "literal") {
    return (value as unknown as SLiteral).value;
  }

  // S-expression symbols and lists are kept as-is for introspection (list?, symbol?)
  // They will be handled by the interpreter's S-expression aware builtins
  if (
    isObjectValue(value) && (
      (value as { type?: string }).type === "symbol" ||
      (value as { type?: string }).type === "list"
    )
  ) {
    return value as unknown as import("../interpreter/types.ts").HQLValue;
  }

  // If it's already an array, keep it as-is (runtime HQL arrays)
  if (Array.isArray(value)) {
    return value as unknown as import("../interpreter/types.ts").HQLValue;
  }

  // Functions and other values pass through as-is
  return value as unknown as import("../interpreter/types.ts").HQLValue;
}

/**
 * Resolve a value for the interpreter environment.
 * This is the key to making function arguments work in macros.
 *
 * - S-exp symbols are resolved to actual values if defined in interpreter env
 * - S-exp constructor lists like (empty-map) are evaluated to produce real Maps
 * - Everything else passes through sexpToHqlValue
 *
 * This fixes the problem where (m triple) passes an S-exp symbol instead of the function.
 */
function resolveValueForInterpreter(
  value: unknown,
  interpEnv: InterpreterEnv,
): import("../interpreter/types.ts").HQLValue {
  // If S-exp symbol, try to resolve to actual value in interpreter env
  // This is critical for function references passed as macro arguments
  if (isObjectValue(value) && (value as { type?: string }).type === "symbol") {
    const symbolName = (value as unknown as SSymbol).name;
    // Check if symbol refers to something in interpreter env (user fn, stdlib fn, etc.)
    if (interpEnv.isDefined(symbolName)) {
      return interpEnv.lookup(symbolName);
    }
    // Symbol not defined - keep as S-exp for introspection (symbol?, etc.)
  }

  // If S-exp list that looks like a constructor, evaluate it
  // This fixes {} parsing to (empty-map) not being evaluated to a real Map
  if (isObjectValue(value) && (value as { type?: string }).type === "list") {
    const list = value as unknown as SList;
    if (list.elements.length > 0 && isSymbol(list.elements[0])) {
      const op = (list.elements[0] as SSymbol).name;
      // Evaluate constructor calls that produce runtime values
      if (
        op === "empty-map" || op === "hash-map" || op === "hash-set" ||
        op === "vector"
      ) {
        try {
          const interpreter = getMacroInterpreter();
          return interpreter.eval(list, interpEnv);
        } catch {
          // If evaluation fails, fall through to default
        }
      }
    }
  }

  // Default: use existing conversion
  return sexpToHqlValue(value);
}

// Bridge cache: avoids repeated scope-chain walks during macro body evaluation.
// Within a single macro expansion, the same Environment object is typically used
// for all function calls. We cache the bridged result and invalidate when the
// binding count changes (new var/let definitions in macro body).
const _bridgeCache: WeakMap<
  Environment,
  { env: InterpreterEnv; fingerprint: string }
> = new WeakMap();

/**
 * Build a structural fingerprint of the scope chain.
 * Includes both binding count and per-scope mutation version so cache
 * invalidates on both new bindings and redefinitions.
 */
function scopeFingerprint(env: Environment): string {
  const parts: string[] = [];
  let current: Environment | null = env;
  while (current !== null) {
    parts.push(`${current.variables.size}:${current.getVariableVersion()}`);
    current = current.getParent();
  }
  return parts.join(":");
}

/**
 * Bridge compiler Environment to InterpreterEnv
 * Copies ALL bindings from the ENTIRE scope chain (not just immediate scope)
 *
 * This is critical for macro evaluation because:
 * - Macro parameters are bound in a parent scope
 * - Let bindings create child scopes
 * - The interpreter needs access to ALL variables in the chain
 * - User-defined functions from earlier in the file are preserved in persistent env
 *
 * Uses a WeakMap cache keyed on Environment identity + binding count to avoid
 * redundant scope-chain walks during macro body evaluation.
 */
function bridgeToInterpreterEnv(compilerEnv: Environment): InterpreterEnv {
  const fingerprint = scopeFingerprint(compilerEnv);
  const cached = _bridgeCache.get(compilerEnv);

  if (cached && cached.fingerprint === fingerprint) {
    // Return a child scope of the cached bridge for isolation
    return cached.env.extend();
  }

  // Use persistent env as base to preserve user-defined functions across macro expansions
  const interpEnv = getPersistentMacroEnv().extend();

  // Collect ALL bindings from the entire scope chain
  // Walk up the parent chain and collect all variable bindings
  const allBindings = new Map<string, unknown>();
  let currentEnv: Environment | null = compilerEnv;

  while (currentEnv !== null) {
    // Iterate over variables in this scope
    for (const [name, value] of currentEnv.variables) {
      // Only add if not already defined (inner scope shadows outer)
      if (!allBindings.has(name)) {
        allBindings.set(name, value);
      }
    }
    // Move to parent scope
    currentEnv = currentEnv.getParent();
  }

  // Now copy all collected bindings to interpreter env
  // IMPORTANT: Use resolveValueForInterpreter to properly handle:
  // - S-exp symbols -> actual function values (critical for function args in macros)
  // - S-exp constructors like (empty-map) -> actual Map objects
  for (const [name, value] of allBindings) {
    // Skip if already in standard env (builtins/stdlib)
    if (!interpEnv.isDefined(name)) {
      const hqlValue = resolveValueForInterpreter(value, interpEnv);
      interpEnv.define(name, hqlValue);
    }
  }

  // Cache for reuse within this macro expansion
  _bridgeCache.set(compilerEnv, { env: interpEnv, fingerprint });

  return interpEnv;
}

// Auto-gensym: Map from "foo#" to generated symbol within a quasiquote
type AutoGensymMap = Map<string, SSymbol>;

type TemplateQuoteKind = "quasiquote" | "syntax-quote";

type MacroBindingTarget =
  | { kind: "identifier"; name: string }
  | { kind: "pattern"; pattern: Pattern };

interface MacroParamSpec {
  params: MacroBindingTarget[];
  restParam: MacroBindingTarget | null;
  wantsForm: boolean;
  wantsEnv: boolean;
}

const macroLocalBindings = new WeakMap<Environment, Map<string, ResolvedBindingMeta>>();
let macroLexicalBindingCounter = 0;

function cloneResolvedBindingMeta(
  binding: ResolvedBindingMeta,
): ResolvedBindingMeta {
  return { ...binding };
}

function getOrCreateMacroLocalBindings(
  env: Environment,
): Map<string, ResolvedBindingMeta> {
  const existing = macroLocalBindings.get(env);
  if (existing) {
    return existing;
  }
  const created = new Map<string, ResolvedBindingMeta>();
  macroLocalBindings.set(env, created);
  return created;
}

function inheritMacroLocalBindings(
  env: Environment,
  parent: Environment,
): void {
  const bindings = new Map<string, ResolvedBindingMeta>();
  let current: Environment | null = parent;
  while (current !== null) {
    const currentBindings = macroLocalBindings.get(current);
    if (currentBindings) {
      for (const [name, binding] of currentBindings.entries()) {
        if (!bindings.has(name)) {
          bindings.set(name, cloneResolvedBindingMeta(binding));
        }
      }
    }
    current = current.getParent();
  }
  macroLocalBindings.set(env, bindings);
}

function registerMacroLocalBinding(
  env: Environment,
  name: string,
): ResolvedBindingMeta {
  const bindings = getOrCreateMacroLocalBindings(env);
  const binding: ResolvedBindingMeta = {
    kind: "local",
    exportName: name,
    lexicalId: `macro-local-${++macroLexicalBindingCounter}`,
  };
  bindings.set(name, binding);
  return binding;
}

function lookupMacroLocalBinding(
  env: Environment,
  name: string,
): ResolvedBindingMeta | undefined {
  let current: Environment | null = env;
  while (current !== null) {
    const bindings = macroLocalBindings.get(current);
    const binding = bindings?.get(name);
    if (binding) {
      return binding;
    }
    current = current.getParent();
  }
  return undefined;
}

function describeResolvedBinding(
  binding: ResolvedBindingMeta,
): Record<string, string> {
  if (binding.kind === "local") {
    return {
      kind: binding.kind,
      exportName: binding.exportName,
      lexicalId: binding.lexicalId ?? "",
    };
  }

  return {
    kind: binding.kind,
    exportName: binding.exportName,
    modulePath: binding.modulePath ?? "",
    originalName: binding.originalName ?? "",
    importedFrom: binding.importedFrom ?? "",
  };
}

function buildMacroEnvView(env: Environment): Record<string, unknown> {
  const currentFile = getEffectiveCurrentFile(env);
  const locals = Object.fromEntries(
    [...getOrCreateMacroLocalBindings(env).entries()].map(([name, binding]) => [
      name,
      describeResolvedBinding(binding),
    ]),
  );

  return {
    locals,
    currentFile,
    modulePath: currentFile,
    imports: env.listImportedMacros(),
    visibleMacros: env.listVisibleMacros(),
  };
}

function getEffectiveCurrentFile(env: Environment): string {
  let current: Environment | null = env;
  while (current !== null) {
    const file = current.getCurrentFile();
    if (file) {
      return file;
    }
    current = current.getParent();
  }
  return "";
}

function attachResolvedBinding(
  symbol: SSymbol,
  binding: ResolvedBindingMeta,
): SSymbol {
  const meta = getMeta(symbol);
  return {
    ...symbol,
    _meta: {
      ...(meta ? { ...meta } : {}),
      resolvedBinding: cloneResolvedBindingMeta(binding),
    },
  };
}

function resolveNonLocalBinding(
  symbol: SSymbol,
  env: Environment,
): ResolvedBindingMeta {
  const symbolInfo = globalSymbolTable.get(symbol.name);
  const currentFile = getEffectiveCurrentFile(env);

  if (symbolInfo?.sourceModule) {
    return {
      kind: "module",
      exportName: symbolInfo.aliasOf ?? symbol.name,
      modulePath: symbolInfo.sourceModule,
      originalName: symbol.name,
      importedFrom: symbolInfo.isImported ? symbolInfo.sourceModule : undefined,
    };
  }

  if (getSpecialFormsSet().has(symbol.name)) {
    return {
      kind: "module",
      exportName: symbol.name,
      modulePath: "<special-form>",
    };
  }

  try {
    if (typeof env.lookup(symbol.name) === "function") {
      return {
        kind: "module",
        exportName: symbol.name,
        modulePath: "<builtin>",
      };
    }
  } catch {
    // Leave unresolved names anchored to the current module below.
  }

  return {
    kind: "module",
    exportName: symbol.name,
    modulePath: currentFile || "<unknown-module>",
    originalName: symbol.name,
  };
}

function resolveSyntaxQuotedSymbol(
  symbol: SSymbol,
  env: Environment,
): SSymbol {
  const localBinding = lookupMacroLocalBinding(env, symbol.name);
  if (localBinding) {
    return attachResolvedBinding(symbol, localBinding);
  }

  return attachResolvedBinding(symbol, resolveNonLocalBinding(symbol, env));
}

/**
 * Check if a symbol name is an auto-gensym (ends with #)
 * e.g., "tmp#", "result#", "value#"
 */
function isAutoGensymSymbol(name: string): boolean {
  return name.length > 1 && name.endsWith("#");
}

/**
 * Get or create a gensym for an auto-gensym symbol
 * All occurrences of "foo#" within the same quasiquote map to the same symbol
 * Uses single get() instead of has()+get() to avoid double lookup
 */
function getAutoGensym(name: string, autoGensymMap: AutoGensymMap): SSymbol {
  const existing = autoGensymMap.get(name);
  if (existing !== undefined) {
    return existing;
  }
  // Strip the # suffix and use as prefix for gensym
  const prefix = name.slice(0, -1);
  const generated = gensym(prefix);
  const symbol: SSymbol = { type: "symbol", name: generated.name };
  autoGensymMap.set(name, symbol);
  return symbol;
}
export interface MacroExpanderOptions {
  verbose?: boolean;
  maxExpandDepth?: number;
  currentFile?: string;
  iterationLimit?: number;
  traceCollector?: MacroExpansionTraceStep[];
}

export interface MacroExpansionTraceStep {
  stage: "iteration" | "macro-call";
  before: string;
  after: string;
  changed: boolean;
  iteration?: number;
  expressionIndex?: number;
  macroName?: string;
  depth?: number;
}

function recordMacroTraceStep(
  options: MacroExpanderOptions,
  step: Omit<MacroExpansionTraceStep, "changed"> & { changed?: boolean },
): void {
  if (!options.traceCollector) {
    return;
  }

  options.traceCollector.push({
    ...step,
    changed: step.changed ?? step.before !== step.after,
  });
}

/**
 * Update _meta for all elements in an S-expression tree.
 * This fixes source location tracking for macro-expanded code.
 *
 * All elements in the expanded expression are updated to use the call site's
 * _meta. This ensures error messages point to where the user wrote the macro
 * call, not where the macro was defined.
 *
 * Note: This means user arguments passed to the macro will also get the call
 * site position. This is intentional - the entire macro call logically exists
 * at the call site, and errors should point there.
 *
 * Uses iterative approach with explicit stack to avoid stack overflow
 * on deeply nested ASTs.
 */
function updateMetaRecursively(expr: SExp, callSiteMeta: SExpMeta): void {
  // Use explicit stack instead of recursion to prevent stack overflow
  const stack: SExp[] = [expr];

  while (stack.length > 0) {
    const current = stack.pop()!;

    // Skip primitive values - they can't have _meta set on them
    if (typeof current !== "object" || current === null) {
      continue;
    }

    const exprMeta = getMeta(current);

    // Update to call site position for macro-expanded code when:
    // 1. No existing metadata
    // 2. Different source file (macro definition in another file)
    // 3. Same file but expression comes from earlier in file (macro definition)
    //
    // This fixes the bug where same-file macros would keep positions
    // from the macro definition instead of the call site.
    const shouldUpdate = !exprMeta ||
      exprMeta.filePath !== callSiteMeta.filePath ||
      (exprMeta.line !== undefined && callSiteMeta.line !== undefined &&
        exprMeta.line < callSiteMeta.line);

    if (shouldUpdate) {
      (current as { _meta?: SExpMeta })._meta = {
        ...(exprMeta ? { ...exprMeta } : {}),
        ...callSiteMeta,
        resolvedBinding: exprMeta?.resolvedBinding,
      };
    }

    // Push children onto stack for processing
    if (isList(current)) {
      // Push in reverse order so we process left-to-right
      const elements = (current as SList).elements;
      for (let i = elements.length - 1; i >= 0; i--) {
        stack.push(elements[i]);
      }
    }
  }
}

/* Helper: Checks truthiness for S-expression values */
function isTruthy(expr: SExp): boolean {
  if (isLiteral(expr)) {
    const value = expr.value;
    return value !== false && value !== null && value !== undefined;
  }
  return true;
}

interface MacroPlaceholderLiteral extends SLiteral {
  __macroPlaceholder?: boolean;
}

function isSExpLike(value: unknown): value is SExp {
  return isObjectValue(value) && "type" in value;
}

interface RestParameterSplice {
  isRestParameter: boolean;
  elements: SExp[];
}

function isRestParameterSplice(value: unknown): value is RestParameterSplice {
  if (typeof value !== "object" || value === null) return false;
  const record = value as { isRestParameter?: unknown; elements?: unknown };
  return record.isRestParameter === true && Array.isArray(record.elements);
}

/* Helper: Convert a JavaScript value to an S-expression */
function convertJsValueToSExp(value: unknown): SExp {
  if (isNullish(value)) return createNilLiteral();

  // CRITICAL: Check for GensymSymbol BEFORE other type checks
  // GensymSymbol must be converted to a symbol, not a string literal
  if (isGensymSymbol(value)) {
    logger.debug(`Converting GensymSymbol "${value.name}" to symbol`);
    return { type: "symbol", name: value.name } as SSymbol;
  }

  if (Array.isArray(value)) {
    return createList(...value.map((item) => convertJsValueToSExp(item)));
  }
  if (isSExpLike(value)) {
    return value;
  }

  const primitive = typeof value;
  if (
    primitive === "string" || primitive === "number" || primitive === "boolean"
  ) {
    return createLiteral(value as string | number | boolean);
  }

  // Functions should not reach here in normal operation.
  // If they do, it means a function was looked up but not called,
  // which is a macro evaluation error.
  if (typeof value === "function") {
    throw new MacroError(
      "Cannot convert function to S-expression. Functions must be called, not referenced as values in macro context.",
      "convertJsValueToSExp",
    );
  }

  return createLiteral(String(value));
}

function isMacroPlaceholder(expr: SExp): boolean {
  return isLiteral(expr) &&
    Boolean((expr as MacroPlaceholderLiteral).__macroPlaceholder);
}

/* Helper: Extract macro definition parts */
function processMacroDefinition(
  macroForm: SList,
): {
  macroName: string;
  paramSpec: MacroParamSpec;
  body: SExp[];
} {
  const loc = getMeta(macroForm) || {};

  if (macroForm.elements.length < 4) {
    throw new MacroError(
      "Macro definition requires a name, parameter list, and body. Syntax: (macro name [params] body)",
      "unknown",
      loc,
    );
  }
  const macroNameExp = macroForm.elements[1];
  if (!isSymbol(macroNameExp)) {
    throw new MacroError(
      "Macro name must be a symbol",
      "unknown",
      getMeta(macroNameExp) || loc,
    );
  }
  const macroName = macroNameExp.name;
  const paramsExp = macroForm.elements[2];
  if (!isList(paramsExp)) {
    throw new MacroError(
      "Macro parameters must be a list",
      macroName,
      getMeta(paramsExp) || loc,
    );
  }
  const paramSpec = processParamList(paramsExp);
  const body = macroForm.elements.slice(3);
  return { macroName, paramSpec, body };
}

/* Helper: Process a parameter list (including rest parameters) */
const isRestMarker = (symbol: SSymbol): boolean => symbol.name === "&";

function parseMacroBindingTarget(param: SExp): MacroBindingTarget {
  if (isSymbol(param)) {
    return { kind: "identifier", name: param.name };
  }

  if (isList(param) && couldBePattern(param)) {
    return { kind: "pattern", pattern: parsePattern(param) };
  }

  throw new MacroError(
    `Macro parameter must be a symbol or destructuring pattern, got: ${sexpToString(param)}`,
    "parameter parsing",
    getMeta(param),
  );
}

function processParamList(
  paramsExp: SList,
): MacroParamSpec {
  const params: MacroBindingTarget[] = [];
  let restParam: MacroBindingTarget | null = null;
  let wantsForm = false;
  let wantsEnv = false;
  let restMode = false;
  let sawOrdinaryParam = false;

  // Handle vector form: [a b c] parses as (vector a b c)
  // We need to skip the 'vector' symbol at the start
  const elements = isVector(paramsExp)
    ? paramsExp.elements.slice(1)
    : paramsExp.elements;

  elements.forEach((param, index) => {
    if (isSymbol(param) && isRestMarker(param)) {
      restMode = true;
      return;
    }

    if (isSymbol(param) && param.name === "&form") {
      if (restMode || wantsForm || wantsEnv || sawOrdinaryParam) {
        throw new MacroError(
          "&form must appear at the front of the macro parameter list",
          "parameter parsing",
          getMeta(param),
        );
      }
      wantsForm = true;
      return;
    }

    if (isSymbol(param) && param.name === "&env") {
      if (restMode || wantsEnv || sawOrdinaryParam || index > (wantsForm ? 1 : 0)) {
        throw new MacroError(
          "&env must appear at the front of the macro parameter list after optional &form",
          "parameter parsing",
          getMeta(param),
        );
      }
      wantsEnv = true;
      return;
    }

    const target = parseMacroBindingTarget(param);
    sawOrdinaryParam = true;

    if (restMode) {
      if (restParam !== null) {
        throw new MacroError(
          "Multiple rest parameters are not allowed",
          "parameter parsing",
          getMeta(param),
        );
      }
      restParam = target;
      return;
    }

    params.push(target);
  });

  if (restMode && restParam === null) {
    throw new MacroError(
      "Rest parameter marker '&' must be followed by a binding target",
      "parameter parsing",
      getMeta(paramsExp),
    );
  }

  return { params, restParam, wantsForm, wantsEnv };
}

function isHashMapSExp(value: SExp): value is SList {
  return isList(value) &&
    value.elements.length > 0 &&
    isSymbol(value.elements[0]) &&
    (value.elements[0].name === "hash-map" ||
      value.elements[0].name === "__hql_hash_map");
}

function toBindingValue(value: unknown): SExp {
  return isSExpLike(value) ? value : convertJsValueToSExp(value);
}

function getArrayLikeElements(value: SExp): SExp[] {
  if (isList(value)) {
    if (isVector(value)) {
      return value.elements.slice(1);
    }
    return value.elements;
  }
  return [];
}

function getObjectLikeEntries(value: SExp): Map<string, SExp> {
  const entries = new Map<string, SExp>();

  if (!isHashMapSExp(value)) {
    return entries;
  }

  for (let i = 1; i < value.elements.length; i += 2) {
    const keyNode = value.elements[i];
    const valueNode = value.elements[i + 1] ?? createNilLiteral();
    if (isSymbol(keyNode)) {
      entries.set(keyNode.name, valueNode);
      continue;
    }
    if (isLiteral(keyNode) && typeof keyNode.value === "string") {
      entries.set(keyNode.value, valueNode);
    }
  }

  return entries;
}

function createHashMapSExp(entries: Map<string, SExp>): SExp {
  const elements: SExp[] = [createSymbol("hash-map")];
  for (const [key, value] of entries.entries()) {
    elements.push(createSymbol(key), value);
  }
  return createList(...elements);
}

function bindMacroTarget(
  env: Environment,
  target: MacroBindingTarget,
  value: unknown,
  logger: Logger,
): void {
  const boundValue = toBindingValue(value);

  if (target.kind === "identifier") {
    if (target.name === "_") {
      return;
    }
    env.define(target.name, boundValue);
    registerMacroLocalBinding(env, target.name);
    return;
  }

  bindMacroPattern(env, target.pattern, boundValue, logger);
}

function bindMacroPattern(
  env: Environment,
  pattern: Pattern,
  value: SExp,
  logger: Logger,
): void {
  switch (pattern.type) {
    case "IdentifierPattern": {
      if (pattern.name === "_") {
        return;
      }
      const boundValue = value ?? pattern.default ?? createNilLiteral();
      env.define(pattern.name, boundValue);
      registerMacroLocalBinding(env, pattern.name);
      return;
    }
    case "ArrayPattern": {
      const values = getArrayLikeElements(value);
      let position = 0;
      for (const element of pattern.elements) {
        if (!element) {
          position++;
          continue;
        }

        if (element.type === "SkipPattern") {
          position++;
          continue;
        }

        if (element.type === "RestPattern") {
          const restValue = createList(...values.slice(position));
          bindMacroTarget(
            env,
            { kind: "identifier", name: element.argument.name },
            restValue,
            logger,
          );
          continue;
        }

        const nextValue = values[position] ?? element.default ?? createNilLiteral();
        bindMacroPattern(env, element, nextValue, logger);
        position++;
      }
      return;
    }
    case "ObjectPattern": {
      const entries = getObjectLikeEntries(value);
      for (const property of pattern.properties) {
        const propertyValue = entries.has(property.key)
          ? entries.get(property.key)!
          : property.default ?? createNilLiteral();
        entries.delete(property.key);
        bindMacroPattern(env, property.value, propertyValue, logger);
      }

      if (pattern.rest) {
        bindMacroTarget(
          env,
          { kind: "identifier", name: pattern.rest.name },
          createHashMapSExp(entries),
          logger,
        );
      }
      return;
    }
    default:
      logger.debug(`Unsupported macro pattern type: ${(pattern as Pattern).type}`);
  }
}

/* Exported: Register a global macro definition */
function defineMacro(
  macroForm: SList,
  env: Environment,
  logger: Logger,
): void {
  try {
    const { macroName, paramSpec, body } = processMacroDefinition(
      macroForm,
    );
    const macroFn = createMacroFunction(
      macroName,
      paramSpec,
      body,
      logger,
    );

    if (env.hasMacro(macroName)) {
      logger.debug(`Redefined global macro ${macroName}`);
    } else {
      logger.debug(`Registered global macro ${macroName}`);
    }

    env.defineMacro(macroName, macroFn);
  } catch (error) {
    // Preserve HQLError instances (MacroError, ValidationError, etc.)
    if (error instanceof HQLError) {
      throw error;
    }
    const macroName = macroForm.elements[1] && isSymbol(macroForm.elements[1])
      ? (macroForm.elements[1] as SSymbol).name
      : "unknown";
    throw new MacroError(
      `Failed to define macro: ${getErrorMessage(error)}`,
      macroName,
      {
        filePath: env.getCurrentFile() || undefined,
        originalError: error instanceof Error ? error : undefined,
      },
    );
  }
}

/* Expand all macros in a list of S-expressions */
export function expandMacros(
  exprs: SExp[],
  env: Environment,
  options: MacroExpanderOptions = {},
): SExp[] {
  const currentFile = options.currentFile;
  logger.debug(
    `Starting macro expansion on ${exprs.length} expressions${
      currentFile ? ` in ${currentFile}` : ""
    }`,
  );

  if (currentFile) {
    env.setCurrentFile(currentFile);
    logger.debug(`Setting current file to: ${currentFile}`);
  }

  // Process macro definitions (pre-pass)
  for (const expr of exprs) {
    if (isDefMacro(expr) && isList(expr)) {
      defineMacro(expr as SList, env, logger);
    }
  }

  let currentExprs = [...exprs];
  const iterationLimit = options.iterationLimit ?? MAX_EXPANSION_ITERATIONS;
  let iteration = 0;

  while (iteration < iterationLimit) {
    iteration++;
    logger.debug(`Macro expansion iteration ${iteration}`);

    const newExprs = currentExprs.map((expr) =>
      expandMacroExpression(expr, env, options, 0)
    );

    currentExprs.forEach((expr, index) => {
      const expanded = newExprs[index];
      recordMacroTraceStep(options, {
        stage: "iteration",
        iteration,
        expressionIndex: index,
        before: sexpToString(expr),
        after: sexpToString(expanded),
        changed: expr !== expanded,
      });
    });

    // Reference equality check: if no expression changed, fixed point reached
    const changed = currentExprs.some((expr, i) => expr !== newExprs[i]);
    currentExprs = newExprs;

    if (!changed) {
      logger.debug(`No changes in iteration ${iteration}, fixed point reached`);
      break;
    }
  }

  if (iteration >= iterationLimit && options.iterationLimit == null) {
    // Only throw for the default limit — explicit limits (e.g., macroexpand1)
    // intentionally constrain expansion and should not be treated as errors.
    throw new MacroError(
      `Macro expansion reached maximum iterations (${iterationLimit}). This likely indicates infinite macro recursion.`,
      "macro-expansion",
      { line: 0, column: 0 },
    );
  }
  logger.debug(`Completed macro expansion after ${iteration} iterations`);

  currentExprs = filterMacroDefinitions(currentExprs, logger);
  if (currentFile) {
    env.setCurrentFile(null);
    logger.debug(`Clearing current file`);
  }
  return currentExprs;
}

/* Evaluate an S-expression for macro expansion */
export function evaluateForMacro(
  expr: SExp,
  env: Environment,
  logger: Logger,
): SExp {
  logger.debug(`Evaluating for macro: ${sexpToString(expr)}`);
  if (isLiteral(expr)) return expr;
  if (isSymbol(expr)) return evaluateSymbol(expr as SSymbol, env, logger);
  if (isList(expr)) return evaluateList(expr as SList, env, logger);
  return expr;
}

/* Evaluate a symbol for macro expansion, including module property access */
function evaluateSymbol(expr: SSymbol, env: Environment, logger: Logger): SExp {
  if (expr.name.includes(".") && !expr.name.startsWith(".")) {
    const parts = expr.name.split(".");
    const moduleName = parts[0];
    const propertyPath = parts.slice(1).join(".");
    try {
      const moduleValue = env.lookup(moduleName);
      let result: unknown = moduleValue;
      if (isObjectValue(result) && propertyPath in result) {
        const record = result as Record<string, unknown>;
        result = record[propertyPath];
      } else {
        logger.debug(
          `Property '${propertyPath}' not found in module '${moduleName}'`,
        );
        return expr;
      }
      return convertJsValueToSExp(result);
    } catch {
      logger.debug(
        `Module property access failed: ${expr.name} during macro evaluation`,
      );
      return expr;
    }
  }
  try {
    const value = env.lookup(expr.name);
    return convertJsValueToSExp(value);
  } catch (e) {
    logger.debug(
      `Symbol lookup failed for '${expr.name}' during macro evaluation: ${
        getErrorMessage(e)
      }`,
    );
    return expr;
  }
}

/* Evaluate a list expression during macro expansion */
function evaluateList(expr: SList, env: Environment, logger: Logger): SExp {
  if (expr.elements.length === 0) return expr;
  const first = expr.elements[0];
  if (isSymbol(first)) {
    const op = (first as SSymbol).name;
    switch (op) {
      case "quote":
        return evaluateQuote(expr);
      case "syntax-quote":
        return evaluateSyntaxQuote(expr, env, logger);
      case "quasiquote":
        return evaluateQuasiquote(expr, env, logger);
      case "unquote":
      case "unquote-splicing":
        throw new MacroError(`${op} not in quasiquote context`, op);
      case "if":
        return evaluateIf(expr, env, logger);
      case "cond":
        return evaluateCond(expr, env, logger);
      case "let":
        return evaluateLet(expr, env, logger);
      case "var":
        return evaluateVar(expr, env, logger);
    }
    if (env.hasMacro(op)) return evaluateMacroCall(expr, env, logger);
    try {
      return evaluateFunctionCall(expr, env, logger);
    } catch (error) {
      throw new MacroError(
        `Error evaluating function call '${op}': ${getErrorMessage(error)}`,
        op,
      );
    }
  }
  return createListFrom(
    expr,
    expr.elements.map((elem) => evaluateForMacro(elem, env, logger)),
  );
}

/* Evaluate a quoted expression */
function evaluateQuote(list: SList): SExp {
  if (list.elements.length !== 2) {
    throw new MacroError("quote requires exactly one argument", "quote");
  }
  return list.elements[1];
}

/* Evaluate an "if" expression */
function evaluateIf(list: SList, env: Environment, logger: Logger): SExp {
  if (list.elements.length < 3 || list.elements.length > 4) {
    throw new MacroError(
      `'if' requires 2 or 3 arguments, got ${list.elements.length - 1}`,
      "if",
    );
  }
  const test = evaluateForMacro(list.elements[1], env, logger);
  if (isTruthy(test)) {
    return evaluateForMacro(list.elements[2], env, logger);
  }
  return list.elements.length > 3
    ? evaluateForMacro(list.elements[3], env, logger)
    : createNilLiteral();
}

/* Evaluate a "cond" expression */
function evaluateCond(list: SList, env: Environment, logger: Logger): SExp {
  for (let i = 1; i < list.elements.length; i++) {
    const clause = list.elements[i];
    if (!isList(clause)) {
      throw new MacroError("cond clauses must be lists", "cond");
    }
    const clauseList = clause as SList;
    if (clauseList.elements.length < 2) {
      throw new MacroError(
        "cond clauses must have a test and a result",
        "cond",
      );
    }
    const test = evaluateForMacro(clauseList.elements[0], env, logger);

    if (isTruthy(test)) {
      return evaluateForMacro(clauseList.elements[1], env, logger);
    }
  }
  return createNilLiteral();
}

/* Evaluate a "let" expression */
function evaluateLet(list: SList, env: Environment, logger: Logger): SExp {
  if (list.elements.length < 2) {
    throw new MacroError(
      "let requires bindings and at least one body form",
      "let",
    );
  }

  const second = list.elements[1];

  // Handle simple form: (let name value)
  // This is the expression-everywhere form where let returns the assigned value
  if (isSymbol(second)) {
    if (list.elements.length !== 3) {
      throw new MacroError(
        "simple let form requires exactly a name and value: (let name value)",
        "let",
      );
    }
    const name = (second as SSymbol).name;
    const value = evaluateForMacro(list.elements[2], env, logger);
    // Bind in current environment (like var) so the value is accessible
    env.define(name, value);
    registerMacroLocalBinding(env, name);
    // Return the value (expression-everywhere semantics)
    return value;
  }

  // Handle bindings form: (let [bindings...] body...)
  const bindings = second;
  if (!isList(bindings)) {
    throw new MacroError("let bindings must be a list or symbol", "let");
  }
  const bindingsList = bindings as SList;

  // Handle vector form [a b] -> (vector a b)
  // This is needed when macro args are passed to let bindings
  const elements = isVector(bindingsList)
    ? bindingsList.elements.slice(1)
    : bindingsList.elements;

  if (elements.length % 2 !== 0) {
    throw new MacroError(
      "let bindings must have an even number of forms",
      "let",
    );
  }
  const letEnv = env.extend();
  inheritMacroLocalBindings(letEnv, env);
  for (let i = 0; i < elements.length; i += 2) {
    const name = elements[i];
    const value = elements[i + 1];
    if (!isSymbol(name) && !(isList(name) && couldBePattern(name))) {
      throw new MacroError("let binding names must be symbols", "let");
    }
    const evaluatedValue = evaluateForMacro(value, letEnv, logger);
    const bindingTarget = isSymbol(name)
      ? { kind: "identifier" as const, name: name.name }
      : { kind: "pattern" as const, pattern: parsePattern(name) };
    bindMacroTarget(letEnv, bindingTarget, evaluatedValue, logger);
  }
  let result: SExp = createNilLiteral();
  for (let i = 2; i < list.elements.length; i++) {
    result = evaluateForMacro(list.elements[i], letEnv, logger);
  }
  return result;
}

/**
 * Evaluate a var expression during macro expansion
 *
 * (var name value) creates a binding in the CURRENT environment (not a new scope like let)
 * This is CRITICAL for gensym to work in macros:
 *   (macro with-temp [value & body]
 *     (var tmp (gensym "temp"))    // ← Creates binding in macro's environment
 *     `(let (~tmp ~value) ~@body)) // ← Uses the bound value
 *
 * Returns the evaluated value
 */
function evaluateVar(list: SList, env: Environment, logger: Logger): SExp {
  if (list.elements.length !== 3) {
    throw new MacroError(
      "var requires exactly a name and a value: (var name value)",
      "var",
    );
  }

  const name = list.elements[1];
  if (!isSymbol(name)) {
    throw new MacroError("var binding name must be a symbol", "var");
  }

  const value = list.elements[2];
  const evaluatedValue = evaluateForMacro(value, env, logger);

  // Define in CURRENT environment (not a new scope)
  env.define((name as SSymbol).name, evaluatedValue);
  registerMacroLocalBinding(env, (name as SSymbol).name);

  logger.debug(`Defined var '${(name as SSymbol).name}' in macro environment`);

  // Return the evaluated value
  return evaluatedValue;
}

/**
 * Check if an expression is a named function definition: (fn name [params] body...)
 */
function isNamedFnDefinition(list: SList): boolean {
  if (list.elements.length < 3) return false;
  const first = list.elements[0];
  if (!isSymbol(first)) return false;
  const headName = (first as SSymbol).name;
  if (headName !== "fn" && headName !== "fx") return false;
  const second = list.elements[1];
  return isSymbol(second);
}

/**
 * Register a named function definition in the persistent macro environment
 *
 * (fn name [params] body...) - named function
 *
 * When a named function is encountered during macro expansion, we:
 * 1. Evaluate it using the interpreter
 * 2. Store the resulting HQL function in the persistent macro environment
 *
 * This enables user-defined functions to be used in later macros, like Clojure.
 */
function registerNamedFnInMacroEnv(
  expr: SList,
  logger: Logger,
): void {
  const fnName = (expr.elements[1] as SSymbol).name;

  // Evaluate the fn form using the interpreter to create an HQL function
  try {
    const interpreter = getMacroInterpreter();
    const interpEnv = getPersistentMacroEnv();
    interpreter.eval(expr, interpEnv);

    // The interpreter's handleFn already defines the function in its env
    logger.debug(`Registered user function '${fnName}' in macro environment`);
  } catch (error) {
    // If evaluation fails, silently continue - function will still be transpiled
    logger.debug(
      `Could not evaluate fn '${fnName}' at macro-time: ${
        getErrorMessage(error)
      }`,
    );
  }
}

/**
 * Pre-expand macro calls in a list of arguments.
 * This is used by both evaluateFunctionCall and expandMacroExpression
 * to ensure nested macro calls are expanded before passing to outer operations.
 *
 * DRY: This helper consolidates the pre-expansion pattern used in multiple places.
 *
 * @param args - The arguments to process
 * @param env - The environment for macro lookup
 * @param expandFn - The function to use for expanding macro calls
 * @returns Arguments with nested macro calls expanded
 */
function preExpandMacroArgs<T>(
  args: SExp[],
  env: Environment,
  expandFn: (arg: SExp) => T,
): (SExp | T)[] {
  return args.map((arg) => {
    if (isList(arg)) {
      const argList = arg as SList;
      if (argList.elements.length > 0 && isSymbol(argList.elements[0])) {
        const argOp = (argList.elements[0] as SSymbol).name;
        if (env.hasMacro(argOp)) {
          return expandFn(arg);
        }
      }
    }
    return arg;
  });
}

// Cache special forms from interpreter (canonical source of truth)
let _specialFormsCache: Set<string> | null = null;
function getSpecialFormsSet(): Set<string> {
  if (!_specialFormsCache) {
    _specialFormsCache = new Set(getSpecialForms().keys());
  }
  return _specialFormsCache;
}

function macroexpandSingleExpr(
  expr: SExp,
  env: Environment,
  options: MacroExpanderOptions = {},
): SExp {
  let current = expr;
  const maxIterations = options.iterationLimit ?? MAX_EXPANSION_ITERATIONS;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const expanded = expandMacroExpression(
      current,
      env,
      {
        ...options,
        currentFile: options.currentFile ?? (env.getCurrentFile() || undefined),
      },
      0,
    );

    if (expanded === current) {
      return current;
    }

    current = expanded;
  }

  throw new MacroError(
    `Macro expansion reached maximum iterations (${maxIterations}). This likely indicates infinite macro recursion.`,
    "macro-expansion",
    { line: 0, column: 0 },
  );
}

function expandNestedMacroArgument(
  arg: SExp,
  env: Environment,
): SExp {
  if (
    isList(arg) &&
    arg.elements.length > 0 &&
    isSymbol(arg.elements[0]) &&
    env.hasMacro(arg.elements[0].name)
  ) {
    return macroexpandSingleExpr(arg, env, {
      iterationLimit: 1,
      maxExpandDepth: 0,
      currentFile: env.getCurrentFile() || undefined,
    });
  }

  return arg;
}

function evaluateMacroPrimitiveCall(
  list: SList,
  env: Environment,
  logger: Logger,
): SExp | undefined {
  const op = (list.elements[0] as SSymbol).name;

  switch (op) {
    case "%eval": {
      if (list.elements.length !== 2) {
        throw new MacroError("%eval requires exactly one argument", "%eval");
      }
      const rawValue = evaluateForMacro(list.elements[1], env, logger);
      return evaluateForMacro(rawValue, env, logger);
    }
    case "%macroexpand-1": {
      if (list.elements.length !== 2) {
        throw new MacroError(
          "%macroexpand-1 requires exactly one argument",
          "%macroexpand-1",
        );
      }
      return macroexpandSingleExpr(list.elements[1], env, {
        iterationLimit: 1,
        maxExpandDepth: 0,
        currentFile: env.getCurrentFile() || undefined,
      });
    }
    case "%macroexpand-all": {
      if (list.elements.length !== 2) {
        throw new MacroError(
          "%macroexpand-all requires exactly one argument",
          "%macroexpand-all",
        );
      }
      return macroexpandSingleExpr(list.elements[1], env, {
        currentFile: env.getCurrentFile() || undefined,
      });
    }
    default:
      return undefined;
  }
}

/* Evaluate a macro call with raw-form semantics. */
function evaluateMacroCall(
  list: SList,
  env: Environment,
  logger: Logger,
): SExp {
  const op = (list.elements[0] as SSymbol).name;
  const macroFn = env.getMacro(op);
  if (!macroFn) {
    throw new MacroError(`Macro not found: ${op}`, op);
  }

  const args = mapTail(list.elements, (arg) => expandNestedMacroArgument(arg, env));
  return macroFn(args, env, list);
}

/* Helper: Evaluate arguments for function calls
 *
 * This function evaluates macro-time arguments and extracts values appropriately:
 * - Literals: extract the primitive value (number, string, boolean)
 * - Symbols: return as-is (S-expression symbol)
 * - Lists: return as-is (S-expression list) - NOT converted to JS arrays
 *
 * This preserves S-expression type information for introspection functions
 * like `list?` and `symbol?` while still extracting primitive values for
 * arithmetic and comparison operations.
 */
function evaluateArguments(
  args: SExp[],
  env: Environment,
  logger: Logger,
): unknown[] {
  return args.map((arg) => {
    const evalArg = evaluateForMacro(arg, env, logger);
    // Extract primitive values from literals
    if (isLiteral(evalArg)) return evalArg.value;
    // Return S-expressions (lists, symbols) as-is to preserve type information
    return evalArg;
  });
}

/* Evaluate a function call - ALL HQL functions work in macros automatically
 *
 * Strategy: Try interpreter first, fall back to compiler env.
 *
 * The interpreter has stdlib loaded, so all HQL functions work automatically.
 * Compiler primitives (%first, %rest, etc.) are:
 *   - NOT defined in interpreter builtins
 *   - NOT copied during bridgeToInterpreterEnv (filtered out)
 * So they naturally fall through to compiler env lookup.
 *
 * ZERO special cases. ZERO hardcoded lists. Clean architectural separation.
 */
function evaluateFunctionCall(
  list: SList,
  env: Environment,
  logger: Logger,
): SExp {
  const first = list.elements[0];
  if (isSymbol(first)) {
    const op = (first as SSymbol).name;

    // Macro primitives (% prefix) go directly to compiler env - they're designed for S-exps
    if (op.startsWith("%")) {
      const primitiveResult = evaluateMacroPrimitiveCall(list, env, logger);
      if (primitiveResult !== undefined) {
        return primitiveResult;
      }

      try {
        const fn = env.lookup(op);
        if (typeof fn === "function") {
          const evalArgs = evaluateArguments(
            list.elements.slice(1),
            env,
            logger,
          );
          const callable = fn as (...args: unknown[]) => unknown;
          return convertJsValueToSExp(callable(...evalArgs));
        }
      } catch {
        logger.debug(`Macro primitive '${op}' not found in compiler env`);
      }
    }

    // For everything else: try interpreter first (handles S-exp conversion for stdlib)
    try {
      const interpreter = getMacroInterpreter();
      const interpEnv = bridgeToInterpreterEnv(env);

      if (interpEnv.isDefined(op)) {
        logger.debug(`Using interpreter for '${op}'`);

        // Pre-expand macro calls in arguments before passing to interpreter.
        // The interpreter doesn't know about HQL macros, so we expand them first.
        // Example: (+ (double x) 5) where 'double' is a macro -> (+ 10 5)
        const expandedArgs = preExpandMacroArgs(
          list.elements.slice(1),
          env,
          (arg) => evaluateForMacro(arg, env, logger),
        );
        const expandedList = createListFrom(list, [first, ...expandedArgs]);

        const result = interpreter.eval(expandedList, interpEnv);
        return hqlValueToSExp(result);
      }
    } catch (interpError) {
      logger.debug(
        `Interpreter evaluation failed for '${op}': ${
          getErrorMessage(interpError)
        }`,
      );
      // Fall through to compiler env
    }

    // Fall back to compiler env
    try {
      const fn = env.lookup(op);
      if (typeof fn === "function") {
        const evalArgs = evaluateArguments(list.elements.slice(1), env, logger);
        const callable = fn as (...args: unknown[]) => unknown;
        return convertJsValueToSExp(callable(...evalArgs));
      }
    } catch {
      logger.debug(`Function '${op}' not found in compiler env`);
    }
  }

  // Fallback: return the list with evaluated elements
  return createListFrom(
    list,
    list.elements.map((elem) => evaluateForMacro(elem, env, logger)),
  );
}

function evaluateSyntaxQuote(
  expr: SList,
  env: Environment,
  logger: Logger,
): SExp {
  return evaluateTemplateQuote(expr, env, logger, "syntax-quote");
}

function evaluateQuasiquote(
  expr: SList,
  env: Environment,
  logger: Logger,
): SExp {
  return evaluateTemplateQuote(expr, env, logger, "quasiquote");
}

function evaluateTemplateQuote(
  expr: SList,
  env: Environment,
  logger: Logger,
  quoteKind: TemplateQuoteKind,
): SExp {
  if (expr.elements.length !== 2) {
    throw new MacroError(
      `${quoteKind} requires exactly one argument`,
      quoteKind,
    );
  }

  logger.debug(`Evaluating ${quoteKind}: ${sexpToString(expr.elements[1])}`);
  return processTemplateExpr(
    expr.elements[1],
    0,
    env,
    logger,
    quoteKind,
    new Map(),
  );
}

function processTemplateExpr(
  expr: SExp,
  depth: number,
  env: Environment,
  logger: Logger,
  quoteKind: TemplateQuoteKind,
  autoGensymMap: AutoGensymMap,
): SExp {
  if (isSymbol(expr)) {
    if (depth === 0 && isAutoGensymSymbol(expr.name)) {
      const generated = getAutoGensym(expr.name, autoGensymMap);
      logger.debug(`Auto-gensym: ${expr.name} -> ${generated.name}`);
      return generated;
    }

    if (quoteKind === "syntax-quote" && depth === 0) {
      return resolveSyntaxQuotedSymbol(expr, env);
    }

    return expr;
  }

  if (!isList(expr)) {
    return expr;
  }

  const list = expr as SList;
  if (list.elements.length === 0) {
    return expr;
  }

  const first = list.elements[0];

  if (
    isSymbol(first) &&
    (first.name === "quasiquote" || first.name === "syntax-quote")
  ) {
    if (list.elements.length !== 2) {
      throw new MacroError(
        `${first.name} requires exactly one argument`,
        first.name,
      );
    }

    const innerProcessed = processTemplateExpr(
      list.elements[1],
      depth + 1,
      env,
      logger,
      first.name,
      new Map(),
    );

    return createListFrom(list, [createSymbol(first.name), innerProcessed]);
  }

  if (isSymbol(first) && first.name === "unquote") {
    if (list.elements.length !== 2) {
      throw new MacroError("unquote requires exactly one argument", "unquote");
    }

    if (depth === 0) {
      return evaluateForMacro(list.elements[1], env, logger);
    }

    const innerProcessed = processTemplateExpr(
      list.elements[1],
      depth - 1,
      env,
      logger,
      quoteKind,
      autoGensymMap,
    );
    return createListFrom(list, [createSymbol("unquote"), innerProcessed]);
  }

  if (isSymbol(first) && first.name === "unquote-splicing") {
    if (list.elements.length !== 2) {
      throw new MacroError(
        "unquote-splicing requires exactly one argument",
        "unquote-splicing",
      );
    }

    if (depth > 0) {
      const innerProcessed = processTemplateExpr(
        list.elements[1],
        depth - 1,
        env,
        logger,
        quoteKind,
        autoGensymMap,
      );
      return createListFrom(list, [
        createSymbol("unquote-splicing"),
        innerProcessed,
      ]);
    }

    throw new MacroError(
      "unquote-splicing not in list context",
      "unquote-splicing",
    );
  }

  const processedElements: SExp[] = [];
  for (const element of list.elements) {
    if (depth === 0 && isForm(element, "unquote-splicing")) {
      const spliceList = element as SList;
      if (spliceList.elements.length !== 2) {
        throw new MacroError(
          "unquote-splicing requires exactly one argument",
          "unquote-splicing",
        );
      }

      const spliced = evaluateForMacro(spliceList.elements[1], env, logger);
      if (isList(spliced)) {
        processedElements.push(
          ...(isVector(spliced) ? spliced.elements.slice(1) : spliced.elements),
        );
      } else if (isRestParameterSplice(spliced)) {
        processedElements.push(...spliced.elements);
      } else {
        logger.warn(
          `unquote-splicing received a non-list value: ${
            sexpToString(spliced)
          }`,
        );
        processedElements.push(spliced);
      }
      continue;
    }

    processedElements.push(
      processTemplateExpr(
        element,
        depth,
        env,
        logger,
        quoteKind,
        autoGensymMap,
      ),
    );
  }

  return createListFrom(list, processedElements);
}

/* Modified expandMacroExpression with visualization support */
function expandMacroExpression(
  expr: SExp,
  env: Environment,
  options: MacroExpanderOptions,
  depth: number,
): SExp {
  const maxDepth = options.maxExpandDepth || 100;

  if (depth > maxDepth) {
    if (options.maxExpandDepth === undefined) {
      logger.warn(
        `Reached maximum expansion depth (${maxDepth}). Possible recursive macro?`,
        "macro",
      );
    }
    return expr;
  }

  if (isList(expr) && isDefMacro(expr)) {
    // Skip re-registration if already defined in the pre-pass
    const macroList = expr as SList;
    const macroNameNode = macroList.elements.length >= 2 ? macroList.elements[1] : null;
    if (!macroNameNode || macroNameNode.type !== "symbol" || !env.hasMacro((macroNameNode as SSymbol).name)) {
      defineMacro(macroList, env, logger);
    }
    const placeholder = createNilLiteral();
    Object.defineProperty(placeholder, "__macroPlaceholder", {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    return placeholder;
  }

  // Register named fn definitions in persistent macro env for use in macros
  // This is similar to Clojure's incremental evaluation model
  if (isList(expr) && isNamedFnDefinition(expr as SList)) {
    registerNamedFnInMacroEnv(expr as SList, logger);
    // Continue with normal expansion (don't return early)
  }

  if (!isList(expr)) return expr;

  const list = expr as SList;
  if (list.elements.length === 0) return list;

  const first = list.elements[0];
  if (isSymbol(first)) {
    const op = (first as SSymbol).name;
    if (op === "macro") return expr;

    if (env.hasMacro(op)) {
      const macroFn = env.getMacro(op);
      if (!macroFn) return expr;

      // Arguments to compile-time macros need careful handling.
      // For code-generating macros (using quasiquote), args should be passed as code.
      // But for compile-time evaluation macros, args need to be evaluated first.
      //
      // We only pre-expand MACRO calls in arguments, keeping other expressions as code.
      // This preserves macro semantics (receiving code as data) while enabling
      // patterns like (dec1 (dec1 5)) where nested macros need expansion.
      // DRY: Uses preExpandMacroArgs helper for consistent pre-expansion logic.
      const args = preExpandMacroArgs(
        list.elements.slice(1),
        env,
        (arg) => expandMacroExpression(arg, env, options, depth + 1),
      );
      const originalExpr = list;

      logger.debug(`Expanding macro ${op} at depth ${depth}`, "macro");

      const expanded = macroFn(args as SExp[], env, originalExpr);

      // CRITICAL: Copy _meta from original call site to expanded expression
      // This ensures error messages point to the original source location,
      // not the macro definition file. Without this, errors would show
      // line numbers from the macro definition (e.g., core.hql:185)
      // instead of the actual call site (e.g., user.hql:2).
      const callSiteMeta = getMeta(originalExpr);
      if (callSiteMeta) {
        // Recursively update _meta for all elements in the expanded expression
        // that have a different filePath (i.e., from the macro definition file)
        updateMetaRecursively(expanded, callSiteMeta);
      }

      recordMacroTraceStep(options, {
        stage: "macro-call",
        macroName: op,
        depth,
        before: sexpToString(originalExpr),
        after: sexpToString(expanded),
      });
      visualizeMacroExpansion(originalExpr, expanded, op, logger);
      return expandMacroExpression(expanded, env, options, depth + 1);
    }
  }

  let hasChanged = false;
  const expandedElements = list.elements.map((elem) => {
    const expanded = expandMacroExpression(elem, env, options, depth + 1);
    if (expanded !== elem) {
      hasChanged = true;
    }
    return expanded;
  });

  const cleanedElements = expandedElements.filter((elem) =>
    !isMacroPlaceholder(elem)
  );

  if (cleanedElements.length !== expandedElements.length) {
    hasChanged = true;
  }

  // Optimization: If nothing changed, return the original object
  // This allows reference equality checks in the main loop
  if (!hasChanged) {
    return list;
  }

  // Use createListFrom to preserve source location through transformation
  return createListFrom(list, cleanedElements);
}

/* Filter out macro definitions from the final S-expression list */
function filterMacroDefinitions(exprs: SExp[], logger: Logger): SExp[] {
  return exprs.filter((expr) => {
    if (isDefMacro(expr)) {
      logger.debug(`Filtering out macro definition: ${sexpToString(expr)}`);
      return false;
    }
    return !isMacroPlaceholder(expr);
  });
}

/* Visualize the macro expansion process with ASCII graphics */
function visualizeMacroExpansion(
  original: SExp,
  expanded: SExp,
  macroName: string,
  logger: Logger,
): void {
  if (!logger.isNamespaceEnabled("macro")) return;

  const originalStr = sexpToString(original);
  const expandedStr = sexpToString(expanded);
  const separator = "=".repeat(80);
  const header = `MACRO EXPANSION: ${macroName}`;
  const headerLine = `== ${header} ${
    "=".repeat(Math.max(0, separator.length - header.length - 4))
  }`;

  logger.log({
    text: `\n${separator}\n${headerLine}\n${separator}\n`,
    namespace: "macro",
  });
  logger.log({
    text: `ORIGINAL:\n${formatExpression(originalStr)}`,
    namespace: "macro",
  });
  logger.log({
    text: `\n   |\n   V\n`,
    namespace: "macro",
  });
  logger.log({
    text: `EXPANDED:\n${formatExpression(expandedStr)}\n`,
    namespace: "macro",
  });
  logger.log({ text: separator, namespace: "macro" });
}

/* Format an S-expression string for readability */
function formatExpression(expr: string): string {
  let indentLevel = 0;
  const chunks: string[] = [];
  let inString = false;

  for (let i = 0; i < expr.length; i++) {
    const char = expr[i];
    if (char === '"' && (i === 0 || expr[i - 1] !== "\\")) {
      inString = !inString;
      chunks.push(char);
      continue;
    }
    if (inString) {
      chunks.push(char);
      continue;
    }
    switch (char) {
      case "(":
        chunks.push(char);
        indentLevel++;
        if (i + 1 < expr.length && expr[i + 1] !== ")") {
          chunks.push("\n" + " ".repeat(indentLevel * 2));
        }
        break;
      case ")":
        indentLevel--;
        // Trim trailing spaces from last chunk
        if (chunks.length > 0 && chunks[chunks.length - 1].endsWith(" ")) {
          chunks[chunks.length - 1] = chunks[chunks.length - 1].trimEnd();
        }
        chunks.push(char);
        break;
      case " ":
        if (i > 0 && expr[i - 1] !== "(" && expr[i - 1] !== " ") {
          chunks.push("\n" + " ".repeat(indentLevel * 2));
        }
        break;
      default:
        chunks.push(char);
    }
  }
  return chunks.join("");
}
/* Create a macro function */
function createMacroFunction(
  macroName: string,
  paramSpec: MacroParamSpec,
  body: SExp[],
  logger: Logger,
): MacroFn {
  const macroFn = (
    args: SExp[],
    callEnv: Environment,
    originalForm?: SList,
  ): SExp => {
    logger.debug(`Expanding macro ${macroName} with ${args.length} args`);
    const macroEnv = createMacroEnv(
      callEnv,
      paramSpec,
      args,
      logger,
      originalForm,
    );
    let result: SExp = createNilLiteral();
    for (const expr of body) {
      result = evaluateForMacro(expr, macroEnv, logger);
    }
    logger.debug(`Macro ${macroName} expanded to: ${sexpToString(result)}`);
    return result;
  };

  Object.defineProperty(macroFn, "isMacro", { value: true });
  Object.defineProperty(macroFn, "macroName", { value: macroName });

  return macroFn;
}

/* Create a new environment for macro expansion with parameter bindings */
function createMacroEnv(
  parent: Environment,
  paramSpec: MacroParamSpec,
  args: SExp[],
  logger: Logger,
  originalForm?: SList,
): Environment {
  const env = parent.extend();
  inheritMacroLocalBindings(env, parent);

  if (paramSpec.wantsForm) {
    bindMacroTarget(
      env,
      { kind: "identifier", name: "&form" },
      originalForm ?? createList(),
      logger,
    );
  }

  for (let i = 0; i < paramSpec.params.length; i++) {
    const paramValue = i < args.length ? args[i] : createNilLiteral();
    bindMacroTarget(env, paramSpec.params[i], paramValue, logger);
  }

  if (paramSpec.restParam !== null) {
    const restArgs = args.slice(paramSpec.params.length);
    logger.debug(
      `Creating rest parameter with ${restArgs.length} elements`,
    );
    const restList = createList(...restArgs);
    Object.defineProperty(restList, "isRestParameter", { value: true });
    bindMacroTarget(env, paramSpec.restParam, restList, logger);
  }

  if (paramSpec.wantsEnv) {
    env.define("&env", buildMacroEnvView(env));
    registerMacroLocalBinding(env, "&env");
  }

  return env;
}
