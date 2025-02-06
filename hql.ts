#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net
/**
 * ============================================================================
 * HQL Interpreter – Final Version with defsync producing truly synchronous
 * JavaScript functions.
 *
 * This file implements the HQL language (a Lisp dialect) on top of Deno/JavaScript.
 *
 * Key features:
 *  - AST definitions for symbols, lists, numbers, strings, booleans, nil, functions, macros, and opaque values.
 *  - A recursive descent parser that tokenizes input and builds the AST.
 *  - An environment model (with lexical scoping) to manage variable bindings.
 *  - Two evaluation paths:
 *      • evaluateAsync: The default async evaluation path used for most HQL code.
 *      • evaluateSync: A strict synchronous evaluation used for defsync functions;
 *        if any async built-in (e.g. sleep, fetch, await, etc.) is used, an error is thrown.
 *  - Built-in functions (e.g., arithmetic, string-append, list and data structure constructors).
 *  - Export and import support, plus a transpiler to generate JavaScript modules.
 *
 * Usage:
 *   • Run a HQL file (async evaluation):
 *         deno run --allow-read --allow-write --allow-net hql.ts yourfile.hql
 *
 *   • Transpile a HQL file to a JS module:
 *         deno run --allow-read --allow-write --allow-net hql.ts --transpile yourfile.hql
 *
 * The transpiled file (e.g. yourfile.hql.js) exports defsync functions as normal synchronous
 * functions (guaranteed to return a plain value) and def functions as async functions.
 *
 * ============================================================================
 */

//////////////////////////////////////////////////////////////////////////////
// 1. AST DEFINITIONS
//////////////////////////////////////////////////////////////////////////////

export type HQLValue =
  | HQLSymbol
  | HQLList
  | HQLNumber
  | HQLString
  | HQLBoolean
  | HQLNil
  | HQLFn
  | HQLMacro
  | HQLOpaque
  | any;

export interface HQLSymbol  { type: "symbol";  name: string; }
export interface HQLList    { type: "list";    value: HQLValue[]; }
export interface HQLNumber  { type: "number";  value: number; }
export interface HQLString  { type: "string";  value: string; }
export interface HQLBoolean { type: "boolean"; value: boolean; }
export interface HQLNil     { type: "nil"; }
export interface HQLFn {
  type: "function";
  params: string[];
  body: HQLValue[];
  closure: Env;
  isMacro?: false;
  hostFn?: (args: HQLValue[]) => Promise<HQLValue> | HQLValue;
  isSync?: boolean;  // <-- marker for defsync functions
}
export interface HQLMacro {
  type: "function";
  params: string[];
  body: HQLValue[];
  closure: Env;
  isMacro: true;
}
export interface HQLOpaque { type: "opaque"; value: any; }

function makeSymbol(name: string): HQLSymbol {
  return { type: "symbol", name };
}
function makeList(value: HQLValue[]): HQLList {
  return { type: "list", value };
}
function makeNumber(n: number): HQLNumber {
  return { type: "number", value: n };
}
function makeString(s: string): HQLString {
  return { type: "string", value: s };
}
function makeBoolean(b: boolean): HQLBoolean {
  return { type: "boolean", value: b };
}
function makeNil(): HQLNil {
  return { type: "nil" };
}

//////////////////////////////////////////////////////////////////////////////
// 2. ENVIRONMENT
//////////////////////////////////////////////////////////////////////////////

/**
 * The Env class implements a lexical scope.
 * Each Env instance has its own bindings (a Map from names to HQL values)
 * and an optional outer environment (for nested scopes).
 */
export class Env {
  bindings: Map<string, HQLValue>;
  outer: Env | null;
  constructor(bindings: Record<string, HQLValue> = {}, outer: Env | null = null) {
    this.bindings = new Map(Object.entries(bindings));
    this.outer = outer;
  }
  set(name: string, val: HQLValue) {
    this.bindings.set(name, val);
    return val;
  }
  find(name: string): Env | null {
    if (this.bindings.has(name)) return this;
    if (this.outer) return this.outer.find(name);
    return null;
  }
  get(name: string): HQLValue {
    const env = this.find(name);
    if (!env) throw new Error(`Symbol '${name}' not found`);
    return env.bindings.get(name)!;
  }
}

//////////////////////////////////////////////////////////////////////////////
// 3. TOKENIZER & PARSER
//////////////////////////////////////////////////////////////////////////////

/**
 * tokenize:
 *   - Converts the input string into an array of tokens.
 *   - Skips whitespace and comments.
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === ";") {
      while (i < input.length && input[i] !== "\n") i++;
      continue;
    }
    if (c === "(" || c === "[") { tokens.push("("); i++; continue; }
    if (c === ")" || c === "]") { tokens.push(")"); i++; continue; }
    if (c === '"') {
      i++;
      let str = "";
      while (i < input.length && input[i] !== '"') { str += input[i++]; }
      i++; // skip the closing quote
      tokens.push(`"${str}"`);
      continue;
    }
    let sym = "";
    while (
      i < input.length &&
      !/\s/.test(input[i]) &&
      !["(", ")", "[", "]", ";"].includes(input[i])
    ) { sym += input[i++]; }
    tokens.push(sym);
  }
  return tokens;
}

/**
 * parseAtom:
 *   - Converts a token into an atomic HQL value (number, string, boolean, nil, or symbol).
 */
function parseAtom(token: string): HQLValue {
  if (/^[+-]?\d+(\.\d+)?$/.test(token)) return makeNumber(parseFloat(token));
  if (token.startsWith('"') && token.endsWith('"')) return makeString(token.slice(1, -1));
  if (token === "true")  return makeBoolean(true);
  if (token === "false") return makeBoolean(false);
  if (token === "nil")   return makeNil();
  return makeSymbol(token);
}

/**
 * readFromTokens:
 *   - Recursively parses tokens into an AST.
 */
function readFromTokens(tokens: string[]): HQLValue {
  if (tokens.length === 0) throw new Error("Unexpected EOF");
  const token = tokens.shift()!;
  if (token === "(") {
    const items: HQLValue[] = [];
    while (tokens[0] !== ")") {
      if (tokens.length === 0) throw new Error("Missing )");
      items.push(readFromTokens(tokens));
    }
    tokens.shift(); // remove ")"
    return makeList(items);
  } else if (token === ")") {
    throw new Error("Unexpected )");
  } else {
    return parseAtom(token);
  }
}

/**
 * parseHQL:
 *   - Parses the entire input string into a list of HQL forms (AST nodes).
 */
function parseHQL(input: string): HQLValue[] {
  const tokens = tokenize(input);
  const forms: HQLValue[] = [];
  while (tokens.length > 0) {
    forms.push(readFromTokens(tokens));
  }
  return forms;
}

//////////////////////////////////////////////////////////////////////////////
// 4. EXPORTS MAP
//////////////////////////////////////////////////////////////////////////////

// exportsMap holds exported symbols from HQL files.
const exportsMap = new Map<string, HQLValue>();

export function getExport(name: string): any {
  if (!exportsMap.has(name)) {
    throw new Error(`HQL export '${name}' not found`);
  }
  return hqlToJs(exportsMap.get(name)!);
}

function clearExports() { exportsMap.clear(); }
export function listExports(): string[] { return [...exportsMap.keys()]; }

//////////////////////////////////////////////////////////////////////////////
// 5. BUILT-IN FUNCTIONS & BASE ENVIRONMENT
//////////////////////////////////////////////////////////////////////////////

// baseEnv is the top-level environment.
export const baseEnv = new Env({}, null);

// asyncBuiltInKeys: a set of built-in function names known to be asynchronous.
// In the synchronous evaluation path (defsync), if one of these is used, an error is thrown.
const asyncBuiltInKeys = new Set<string>([
  "sleep", "fetch", "read-file", "write-file", "await", "import",
]);

/**
 * hostFunc:
 *   - Helper to create built-in functions.
 */
function hostFunc(fn: (args: HQLValue[]) => Promise<HQLValue> | HQLValue): HQLFn {
  return {
    type: "function",
    params: [],
    body: [],
    closure: baseEnv,
    isMacro: false,
    hostFn: fn,
  };
}

/**
 * truthy:
 *   - Determines if an HQL value should be considered “true” in conditionals.
 */
function truthy(val: HQLValue): boolean {
  if (!val) return false;
  if (val.type === "nil") return false;
  if (val.type === "boolean") return val.value;
  return true;
}

/**
 * formatValue:
 *   - Returns a string representation of an HQL value for printing.
 */
function formatValue(val: HQLValue): string {
  if (!val) return "nil";
  switch (val.type) {
    case "number":  return String(val.value);
    case "string":  return JSON.stringify(val.value);
    case "boolean": return val.value ? "true" : "false";
    case "nil":     return "nil";
    case "symbol":  return val.name;
    case "list":    return "(" + val.value.map(formatValue).join(" ") + ")";
    case "function":return val.isMacro ? "<macro>" : "<fn>";
    default:        return String(val);
  }
}

// Define built-in functions and data constructors.
const builtIns: Record<string, HQLValue> = {
  // Console printing:
  println: hostFunc((args: HQLValue[]) => {
    console.log(...args.map(formatValue));
    return makeNil();
  }),
  log: hostFunc((args: HQLValue[]) => {
    console.log(...args.map(hqlToJs));
    return makeNil();
  }),
  // Create keywords (symbols starting with ':')
  keyword: hostFunc((args: HQLValue[]) => {
    if (args.length !== 1 || args[0].type !== "string") {
      throw new Error("(keyword) expects exactly one string argument");
    }
    return makeSymbol(":" + args[0].value);
  }),
  // Arithmetic operations:
  "+": hostFunc((args: HQLValue[]) => {
    let sum = 0;
    for (const a of args) {
      if (a.type !== "number") {
        throw new Error("Expected number in +");
      }
      sum += a.value;
    }
    return makeNumber(sum);
  }),
  "-": hostFunc((args: HQLValue[]) => {
    if (args.length === 0) throw new Error("'-' expects at least one argument");
    for (const a of args) {
      if (a.type !== "number") throw new Error("Expected number in -");
    }
    if (args.length === 1) return makeNumber(-args[0].value);
    let result = args[0].value;
    for (let i = 1; i < args.length; i++) {
      result -= args[i].value;
    }
    return makeNumber(result);
  }),
  "*": hostFunc((args: HQLValue[]) => {
    let product = 1;
    for (const a of args) {
      if (a.type !== "number") throw new Error("Expected number in *");
      product *= a.value;
    }
    return makeNumber(product);
  }),
  "/": hostFunc((args: HQLValue[]) => {
    if (args.length === 0) throw new Error("'/' expects at least one argument");
    for (const a of args) {
      if (a.type !== "number") throw new Error("Expected number in /");
    }
    if (args.length === 1) return makeNumber(1 / args[0].value);
    let result = args[0].value;
    for (let i = 1; i < args.length; i++) {
      result /= args[i].value;
    }
    return makeNumber(result);
  }),
  "string-append": hostFunc((args: HQLValue[]) => {
    const out = args.map(v => v.type === "string" ? v.value : formatValue(v)).join("");
    return makeString(out);
  }),
  // List and data structure constructors:
  list: hostFunc((args: HQLValue[]) => makeList(args)),
  vector: hostFunc((args: HQLValue[]) => makeList([makeSymbol("vector"), ...args])),
  "hash-map": hostFunc((args: HQLValue[]) => makeList([makeSymbol("hash-map"), ...args])),
  set: hostFunc((args: HQLValue[]) => makeList([makeSymbol("set"), ...args])),
};

// Add built-ins to the base environment.
for (const k in builtIns) {
  baseEnv.set(k, builtIns[k]);
}

//////////////////////////////////////////////////////////////////////////////
// 6. CONVERSION BETWEEN HQL AND JAVASCRIPT
//////////////////////////////////////////////////////////////////////////////

/**
 * hqlToJs:
 *   - Converts an HQL value to a native JavaScript value.
 *   - Functions marked as defsync (isSync=true) are returned as normal functions.
 *     Others are returned as async functions.
 */
function hqlToJs(val: HQLValue): any {
  if (!val) return null;
  if (val.type === "nil")    return null;
  if (val.type === "boolean")return val.value;
  if (val.type === "number") return val.value;
  if (val.type === "string") return val.value;
  if (val.type === "symbol") return val.name;
  if (val.type === "list")   return val.value.map(hqlToJs);
  if (val.type === "function") {
    if (val.isSync) {
      return function (...args: any[]) {
        const result = applyFnSync(val, args.map((jsVal: any) => jsToHql(jsVal)));
        return hqlToJs(result);
      };
    } else {
      return async (...args: any[]) => {
        const result = await applyFnAsync(val, args.map((jsVal: any) => jsToHql(jsVal)));
        return hqlToJs(result);
      };
    }
  }
  return val;
}

/**
 * jsToHql:
 *   - Converts a native JavaScript value to an HQL value.
 */
function jsToHql(obj: any): HQLValue {
  if (obj === null || obj === undefined) return makeNil();
  if (typeof obj === "boolean") return makeBoolean(obj);
  if (typeof obj === "number")  return makeNumber(obj);
  if (typeof obj === "string")  return makeString(obj);
  if (Array.isArray(obj))       return makeList(obj.map(jsToHql));
  return { type: "opaque", value: obj };
}

//////////////////////////////////////////////////////////////////////////////
// 7. FUNCTION APPLICATION: ASYNC AND SYNC VARIANTS
//////////////////////////////////////////////////////////////////////////////

/**
 * applyFnAsync:
 *   - Applies a function (HQLFn) asynchronously.
 *   - For user-defined functions, it creates a new environment, binds parameters,
 *     then evaluates each body form asynchronously.
 */
async function applyFnAsync(fnVal: HQLFn, argVals: HQLValue[]): Promise<HQLValue> {
  if (fnVal.hostFn) {
    return fnVal.hostFn(argVals);
  }
  const newEnv = new Env({}, fnVal.closure);
  if (argVals.length < fnVal.params.length) {
    throw new Error(`Not enough args: expected ${fnVal.params.length}, got ${argVals.length}`);
  }
  for (let i = 0; i < fnVal.params.length; i++) {
    newEnv.set(fnVal.params[i], argVals[i]);
  }
  let result: HQLValue = makeNil();
  for (const form of fnVal.body) {
    result = await evaluateAsync(form, newEnv);
  }
  return result;
}

/**
 * applyFnSync:
 *   - Applies a defsync function synchronously.
 *   - If any async built-in is used (or a Promise is returned), an error is thrown.
 */
function applyFnSync(fnVal: HQLFn, argVals: HQLValue[]): HQLValue {
  if (fnVal.hostFn) {
    const nameOfBuiltin = getBuiltinNameByValue(fnVal);
    if (nameOfBuiltin && asyncBuiltInKeys.has(nameOfBuiltin)) {
      throw new Error(`Sync function used async built-in '${nameOfBuiltin}'!`);
    }
    const result = fnVal.hostFn(argVals);
    if (result instanceof Promise) {
      throw new Error(`Sync function attempted async operation in built-in '${nameOfBuiltin}'!`);
    }
    return result;
  }
  const newEnv = new Env({}, fnVal.closure);
  if (argVals.length < fnVal.params.length) {
    throw new Error(`Not enough args: expected ${fnVal.params.length}, got ${argVals.length}`);
  }
  for (let i = 0; i < fnVal.params.length; i++) {
    newEnv.set(fnVal.params[i], argVals[i]);
  }
  let result: HQLValue = makeNil();
  for (const form of fnVal.body) {
    result = evaluateSync(form, newEnv);
  }
  return result;
}

/**
 * getBuiltinNameByValue:
 *   - Returns the name of a built-in function by comparing its value.
 */
function getBuiltinNameByValue(fnVal: HQLFn): string | undefined {
  for (const [k, v] of Object.entries(builtIns)) {
    if (v === fnVal) return k;
  }
  return undefined;
}

//////////////////////////////////////////////////////////////////////////////
// 8. EVALUATION – ASYNC AND SYNC PATHS
//////////////////////////////////////////////////////////////////////////////

// 8A. Asynchronous Evaluation
/**
 * evaluateAsync:
 *   - Recursively evaluates an AST node (HQLValue) in an asynchronous manner.
 *   - Handles special forms such as quote, if, def, defsync, fn, defmacro, await, export, import.
 */
async function evaluateAsync(ast: HQLValue, env: Env): Promise<HQLValue> {
  if (ast.type === "symbol") return env.get(ast.name);
  if (
    ast.type === "number" ||
    ast.type === "string" ||
    ast.type === "boolean" ||
    ast.type === "nil"
  ) {
    return ast;
  }
  if (ast.type === "list") {
    const list = ast.value;
    if (list.length === 0) return ast;
    const head = list[0];
    if (head.type === "symbol") {
      switch (head.name) {
        case "quote":  return list[1] ?? makeNil();
        case "if": {
          const cond = await evaluateAsync(list[1], env);
          if (truthy(cond)) {
            return list[2] ? await evaluateAsync(list[2], env) : makeNil();
          } else {
            return list[3] ? await evaluateAsync(list[3], env) : makeNil();
          }
        }
        case "def": {
          if (!list[1] || list[1].type !== "symbol") {
            throw new Error("(def) expects a symbol");
          }
          const sym = list[1];
          const val = list[2] ? await evaluateAsync(list[2], env) : makeNil();
          env.set(sym.name, val);
          return val;
        }
        case "defsync": {
          if (!list[1] || list[1].type !== "symbol") {
            throw new Error("(defsync) expects a symbol");
          }
          const sym = list[1];
          const val = list[2] ? await evaluateAsync(list[2], env) : makeNil();
          if (val.type === "function") val.isSync = true;
          env.set(sym.name, val);
          return val;
        }
        case "fn": {
          const paramsAst = list[1];
          if (!paramsAst || paramsAst.type !== "list") {
            throw new Error("(fn) expects a list of parameters");
          }
          const paramNames = paramsAst.value.map((p: HQLValue) => {
            if (p.type === "symbol") return p.name;
            if (p.type === "list" && p.value.length >= 1 && p.value[0].type === "symbol") {
              return p.value[0].name;
            }
            throw new Error("Invalid parameter spec in (fn)");
          });
          let bodyForms = list.slice(2);
          if (bodyForms.length > 0 &&
              bodyForms[0].type === "list" &&
              bodyForms[0].value.length >= 2 &&
              bodyForms[0].value[0].type === "symbol" &&
              (bodyForms[0].value[0].name === "->" || bodyForms[0].value[0].name === "ret")
          ) {
            bodyForms = bodyForms.slice(1);
          }
          const fnVal: HQLFn = { type: "function", params: paramNames, body: bodyForms, closure: env };
          return fnVal;
        }
        case "defmacro": {
          if (!list[1] || list[1].type !== "symbol") {
            throw new Error("(defmacro) expects a symbol name as second arg");
          }
          const sym = list[1];
          const paramsAst = list[2];
          if (!paramsAst || paramsAst.type !== "list") {
            throw new Error("(defmacro) expects a list of parameters");
          }
          const paramNames = paramsAst.value.map((p: HQLValue) => {
            if (p.type !== "symbol") throw new Error("Macro parameter must be a symbol");
            return p.name;
          });
          const bodyForms = list.slice(3);
          const macroVal: HQLMacro = { type: "function", params: paramNames, body: bodyForms, closure: env, isMacro: true };
          env.set(sym.name, macroVal);
          return makeSymbol(sym.name);
        }
        case "await": {
          const exprVal = await evaluateAsync(list[1], env);
          if (exprVal instanceof Promise) return await exprVal;
          return exprVal;
        }
        case "export": {
          if (list.length < 3) throw new Error("(export) expects (export \"name\" expr)");
          const nameVal = list[1];
          if (nameVal.type !== "string") throw new Error("(export) expects a string name");
          const ev = await evaluateAsync(list[2], env);
          exportsMap.set(nameVal.value, ev);
          return ev;
        }
        case "import": {
          if (list.length < 2) throw new Error("(import) expects a URL");
          const urlVal = await evaluateAsync(list[1], env);
          if (urlVal.type !== "string") throw new Error("(import) expects a string URL");
          let modUrl = urlVal.value;
          if (!modUrl.startsWith("npm:") && !modUrl.includes("?bundle")) {
            modUrl += "?bundle";
          }
          const modObj = await import(modUrl);
          let modCandidate = modObj.default ?? modObj;
          if (typeof modCandidate === "function" && modCandidate.green === undefined && typeof modObj.green !== "undefined") {
            modCandidate = modObj;
          }
          if (typeof modCandidate === "function" && "level" in modCandidate) {
            modCandidate.level = 1;
          }
          return wrapJsValue(modCandidate);
        }
      }
    }
    // Function call:
    const fnVal = await evaluateAsync(head, env);
    if (fnVal.type === "function") {
      if (fnVal.isMacro) {
        const expanded = await macroExpandAsync(fnVal, list.slice(1), env);
        return evaluateAsync(expanded, env);
      } else {
        const argVals: HQLValue[] = [];
        for (const arg of list.slice(1)) {
          argVals.push(await evaluateAsync(arg, env));
        }
        return applyFnAsync(fnVal, argVals);
      }
    } else {
      throw new Error(`Attempt to call non-function: ${head.type}`);
    }
  }
  return ast;
}

async function macroExpandAsync(fnVal: HQLMacro, rawArgs: HQLValue[], env: Env): Promise<HQLValue> {
  const newEnv = new Env({}, fnVal.closure);
  if (rawArgs.length < fnVal.params.length) {
    throw new Error(`Not enough arguments for macro: expected ${fnVal.params.length}`);
  }
  for (let i = 0; i < fnVal.params.length; i++) {
    newEnv.set(fnVal.params[i], rawArgs[i]);
  }
  let result: HQLValue = makeNil();
  for (const form of fnVal.body) {
    result = await evaluateAsync(form, newEnv);
  }
  return result;
}

// 8B. Synchronous Evaluation (for defsync)
function evaluateSync(ast: HQLValue, env: Env): HQLValue {
  if (ast.type === "symbol") {
    const val = env.get(ast.name);
    const builtinName = getBuiltinNameByValue(val as HQLFn);
    if (builtinName && asyncBuiltInKeys.has(builtinName)) {
      throw new Error(`Sync code tried to call async built-in '${ast.name}'!`);
    }
    return val;
  }
  if (ast.type === "number" || ast.type === "string" || ast.type === "boolean" || ast.type === "nil") {
    return ast;
  }
  if (ast.type === "list") {
    const list = ast.value;
    if (list.length === 0) return ast;
    const head = list[0];
    if (head.type === "symbol") {
      switch (head.name) {
        case "quote": return list[1] ?? makeNil();
        case "if": {
          const condVal = evaluateSync(list[1], env);
          if (truthy(condVal)) {
            return list[2] ? evaluateSync(list[2], env) : makeNil();
          } else {
            return list[3] ? evaluateSync(list[3], env) : makeNil();
          }
        }
        case "def": {
          if (!list[1] || list[1].type !== "symbol") {
            throw new Error("(def) expects a symbol");
          }
          const sym = list[1];
          const val = list[2] ? evaluateSync(list[2], env) : makeNil();
          env.set(sym.name, val);
          return val;
        }
        case "defsync": {
          if (!list[1] || list[1].type !== "symbol") {
            throw new Error("(defsync) expects a symbol");
          }
          const sym = list[1];
          const val = list[2] ? evaluateSync(list[2], env) : makeNil();
          if (val.type === "function") val.isSync = true;
          env.set(sym.name, val);
          return val;
        }
        case "fn": {
          const paramsAst = list[1];
          if (!paramsAst || paramsAst.type !== "list") {
            throw new Error("(fn) expects a list of parameters");
          }
          const paramNames = paramsAst.value.map((p: HQLValue) => {
            if (p.type === "symbol") return p.name;
            if (p.type === "list" && p.value[0].type === "symbol") return p.value[0].name;
            throw new Error("Invalid parameter in (fn)");
          });
          let bodyForms = list.slice(2);
          if (bodyForms.length > 0 &&
              bodyForms[0].type === "list" &&
              bodyForms[0].value.length >= 2 &&
              bodyForms[0].value[0].type === "symbol" &&
              (bodyForms[0].value[0].name === "->" || bodyForms[0].value[0].name === "ret")
          ) {
            bodyForms = bodyForms.slice(1);
          }
          return {
            type: "function",
            params: paramNames,
            body: bodyForms,
            closure: env,
          } as HQLFn;
        }
        case "defmacro": {
          throw new Error("Macros are not supported in sync mode.");
        }
        case "await":
        case "sleep":
        case "fetch":
        case "import":
          throw new Error(`Sync code tried to call async operation '${head.name}'!`);
        case "export": {
          if (list.length < 3) throw new Error("(export) expects (export \"name\" expr)");
          const nameVal = list[1];
          if (nameVal.type !== "string") throw new Error("(export) expects a string name");
          const ev = evaluateSync(list[2], env);
          exportsMap.set(nameVal.value, ev);
          return ev;
        }
        default: {
          const fnVal = evaluateSync(head, env);
          if (fnVal.type === "function") {
            if (fnVal.isMacro) {
              throw new Error("Macros not supported in sync mode.");
            } else {
              const argVals = list.slice(1).map((a: HQLValue) => evaluateSync(a, env));
              return applyFnSync(fnVal, argVals);
            }
          }
          throw new Error(`Attempt to call non-function in sync mode: ${head.name}`);
        }
      }
    } else {
      const fnVal = evaluateSync(head, env);
      if (fnVal.type === "function") {
        if (fnVal.isMacro) {
          throw new Error("Macros not supported in sync mode.");
        } else {
          const argVals = list.slice(1).map((a: HQLValue) => evaluateSync(a, env));
          return applyFnSync(fnVal, argVals);
        }
      }
      throw new Error("Attempt to call non-function in sync mode");
    }
  }
  return ast;
}

//////////////////////////////////////////////////////////////////////////////
// 9. RUN AND TRANSPILER
//////////////////////////////////////////////////////////////////////////////

/**
 * runHQLFile:
 *   - Reads a HQL file from disk, parses it, and evaluates each form in the async path.
 */
export async function runHQLFile(path: string) {
  clearExports();
  const source = await Deno.readTextFile(path);
  const forms = parseHQL(source);
  const env = new Env({}, baseEnv);
  for (const form of forms) {
    await evaluateAsync(form, env);
  }
}

/**
 * transpileHQLFile:
 *   - Transpiles a HQL file into a JavaScript module.
 *   - Functions defined via defsync are exported as normal functions,
 *     while def functions are exported as async functions.
 */
export async function transpileHQLFile(inputPath: string, outputPath?: string) {
  clearExports();
  const source = await Deno.readTextFile(inputPath);
  const forms = parseHQL(source);
  const env = new Env({}, baseEnv);
  for (const form of forms) {
    await evaluateAsync(form, env);
  }
  const exportedNames = [...exportsMap.keys()];
  if (!outputPath) {
    outputPath = inputPath.endsWith(".hql") ? inputPath + ".js" : inputPath + ".js";
  }
  let code = `import { runHQLFile, getExport } from "./hql.ts";\n\n`;
  code += `await runHQLFile("${inputPath}");\n\n`;
  for (const name of exportedNames) {
    const val = exportsMap.get(name);
    const isFn = val && val.type === "function";
    const isSync = isFn && val.isSync;
    if (isFn) {
      if (isSync) {
        code += `
export function ${name}(...args) {
  const fn = getExport("${name}");
  return fn(...args);
}
`;
      } else {
        code += `
export async function ${name}(...args) {
  const fn = getExport("${name}");
  return await fn(...args);
}
`;
      }
    } else {
      code += `
export const ${name} = getExport("${name}");
`;
    }
  }
  await Deno.writeTextFile(outputPath, code);
  console.log(
    `Transpiled HQL from ${inputPath} -> ${outputPath}. Exports: ${exportedNames.join(", ")}`
  );
}

//////////////////////////////////////////////////////////////////////////////
// 10. CLI AND REPL
//////////////////////////////////////////////////////////////////////////////

if (import.meta.main) {
  if (Deno.args.length === 0) {
    console.log("Welcome to HQL. Type (exit) or Ctrl+C to quit.");
    await repl(new Env({}, baseEnv));
    Deno.exit(0);
  }
  if (Deno.args[0] === "--transpile") {
    if (Deno.args.length < 2) {
      console.error("Missing input file for transpile mode.");
      Deno.exit(1);
    }
    const inputFile = Deno.args[1];
    const outputFile = Deno.args[2] || undefined;
    await transpileHQLFile(inputFile, outputFile);
  } else {
    const inputFile = Deno.args[0];
    await runHQLFile(inputFile);
  }
}

async function readLine(): Promise<string | null> {
  const buf = new Uint8Array(1024);
  const n = <number>await Deno.stdin.read(buf);
  if (n === null) return null;
  return new TextDecoder().decode(buf.subarray(0, n)).replace(/\r?\n$/, "");
}

/**
 * countParens:
 *   - Counts parentheses in a string to support multi-line input.
 */
function countParens(input: string): number {
  let count = 0;
  let inString = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"' && (i === 0 || input[i - 1] !== "\\")) {
      inString = !inString;
    }
    if (!inString) {
      if (ch === "(") count++;
      else if (ch === ")") count--;
    }
  }
  return count;
}

/**
 * readMultiline:
 *   - Reads multiple lines from standard input until the parentheses are balanced.
 */
async function readMultiline(): Promise<string | null> {
  let code = "";
  let parenCount = 0;
  while (true) {
    const prompt = parenCount > 0 ? "....> " : "HQL> ";
    await Deno.stdout.write(new TextEncoder().encode(prompt));
    const line = await readLine();
    if (line === null) {
      if (code.trim() === "") return null;
      else break;
    }
    code += line + "\n";
    parenCount = countParens(code);
    if (parenCount <= 0) break;
  }
  return code;
}

/**
 * repl:
 *   - Provides an interactive Read-Eval-Print Loop (REPL) for HQL.
 */
async function repl(env: Env) {
  while (true) {
    const code = await readMultiline();
    if (code === null) {
      console.log("\nGoodbye.");
      return;
    }
    if (code.trim() === "") continue;
    if (code.trim() === "(exit)") {
      console.log("Goodbye.");
      return;
    }
    try {
      const forms = parseHQL(code);
      let result: HQLValue = makeNil();
      for (const form of forms) {
        result = await evaluateAsync(form, env);
      }
      console.log(formatValue(result));
    } catch (e: any) {
      console.error("Error:", e.message);
    }
  }
}

/** wrapJsValue:
 *   - Wraps a native JS value as an opaque HQL value.
 */
function wrapJsValue(obj: any): HQLValue {
  return { type: "opaque", value: obj };
}
