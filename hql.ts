#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env
/**
 * HQL Interpreter (Optimized for Production)
 *
 * Features:
 *  - Plain-object environments for O(1) variable lookup.
 *  - A single–pass parser (minimized allocations and function calls).
 *  - Dual evaluation paths: async and sync.
 *  - Separate function application for sync and async.
 *  - Built-in "->" threading macro.
 *
 * Usage:
 *  - To run a HQL file:
 *       deno run --allow-read --allow-write --allow-net --allow-env hql.ts yourfile.hql
 *  - To transpile a HQL file to a JS module:
 *       deno run --allow-read --allow-write --allow-net --allow-env hql.ts --transpile yourfile.hql
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
  isSync?: boolean; // If true, must be evaluated synchronously.
}

export interface HQLMacro {
  type: "function";
  params: string[];
  body: HQLValue[];
  closure: Env;
  isMacro: true;
}

export interface HQLOpaque { type: "opaque"; value: any; }

//////////////////////////////////////////////////////////////////////////////
// FACTORIES
//////////////////////////////////////////////////////////////////////////////

function makeSymbol(name: string): HQLSymbol   { return { type: "symbol",  name }; }
function makeList(value: HQLValue[]): HQLList  { return { type: "list",    value }; }
function makeNumber(n: number): HQLNumber      { return { type: "number",  value: n }; }
function makeString(s: string): HQLString      { return { type: "string",  value: s }; }
function makeBoolean(b: boolean): HQLBoolean   { return { type: "boolean", value: b }; }
function makeNil(): HQLNil                     { return { type: "nil" }; }

//////////////////////////////////////////////////////////////////////////////
// 2. ENVIRONMENT (Plain Objects for O(1) Lookup)
//////////////////////////////////////////////////////////////////////////////

export class Env {
  bindings: Record<string, HQLValue>;
  outer: Env | null;
  exports?: Record<string, HQLValue>;

  constructor(bindings: Record<string, HQLValue> = {}, outer: Env | null = null) {
    this.bindings = bindings;
    this.outer = outer;
    this.exports = undefined;
  }

  set(name: string, val: HQLValue) {
    this.bindings[name] = val;
    return val;
  }

  get(name: string): HQLValue {
    if (Object.prototype.hasOwnProperty.call(this.bindings, name)) {
      return this.bindings[name];
    }
    if (this.outer) return this.outer.get(name);
    if (name in globalThis) return wrapJsValue((globalThis as any)[name]);
    throw new Error(`Symbol '${name}' not found`);
  }
}

//////////////////////////////////////////////////////////////////////////////
// 3. SINGLE-PASS PARSER (Inlined, Optimized)
//////////////////////////////////////////////////////////////////////////////

export function parseHQL(input: string): HQLValue[] {
  const result: HQLValue[] = [];
  let i = 0, len = input.length;

  function skipWs() {
    while (i < len) {
      const ch = input.charAt(i);
      if (ch === ";") {
        while (i < len && input.charAt(i) !== "\n") i++;
      } else if (/\s/.test(ch)) {
        i++;
      } else {
        break;
      }
    }
  }

  function readString(): HQLString {
    i++; // skip opening quote
    let buf = "";
    while (i < len) {
      const ch = input.charAt(i);
      if (ch === '"') { i++; break; }
      buf += ch;
      i++;
    }
    return makeString(buf);
  }

  function readNumberOrSymbol(): HQLValue {
    const start = i;
    while (
      i < len &&
      !/\s/.test(input.charAt(i)) &&
      !["(", ")", "[", "]", ";"].includes(input.charAt(i))
    ) {
      i++;
    }
    const raw = input.slice(start, i);
    if (/^[+-]?\d+(\.\d+)?$/.test(raw)) return makeNumber(parseFloat(raw));
    if (raw === "true")  return makeBoolean(true);
    if (raw === "false") return makeBoolean(false);
    if (raw === "nil")   return makeNil();
    return makeSymbol(raw);
  }

  function readList(): HQLList {
    i++; // skip opening ( or [
    const items: HQLValue[] = [];
    while (true) {
      skipWs();
      if (i >= len) throw new Error("Missing closing )");
      const ch = input.charAt(i);
      if (ch === ")" || ch === "]") { i++; break; }
      items.push(readForm());
    }
    return makeList(items);
  }

  function readForm(): HQLValue {
    skipWs();
    if (i >= len) throw new Error("Unexpected EOF");
    const ch = input.charAt(i);
    if (ch === "(" || ch === "[") return readList();
    if (ch === '"') return readString();
    if (ch === ")" || ch === "]") throw new Error("Unexpected )");
    return readNumberOrSymbol();
  }

  while (true) {
    skipWs();
    if (i >= len) break;
    result.push(readForm());
  }
  return result;
}

//////////////////////////////////////////////////////////////////////////////
// 4. EXPORTS MANAGEMENT
//////////////////////////////////////////////////////////////////////////////

export function getExport(name: string, targetExports: Record<string, HQLValue>): any {
  if (!Object.prototype.hasOwnProperty.call(targetExports, name)) {
    throw new Error(`HQL export '${name}' not found`);
  }
  return hqlToJs(targetExports[name]);
}

//////////////////////////////////////////////////////////////////////////////
// 5. BUILT-IN FUNCTIONS & BASE ENVIRONMENT
//////////////////////////////////////////////////////////////////////////////

export const baseEnv = new Env({}, null);
baseEnv.exports = {};

// Built-ins that are async
const asyncBuiltInKeys = new Set<string>([
  "sleep", "fetch", "read-file", "write-file", "await", "import"
]);

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

function truthy(val: HQLValue): boolean {
  return !!val && val.type !== "nil" && (val.type !== "boolean" || !!val.value);
}

export function formatValue(val: HQLValue): string {
  if (!val) return "nil";
  switch (val.type) {
    case "number":   return String(val.value);
    case "string":   return JSON.stringify(val.value);
    case "boolean":  return val.value ? "true" : "false";
    case "nil":      return "nil";
    case "symbol":   return val.name;
    case "list":     return "(" + val.value.map(formatValue).join(" ") + ")";
    case "function": return val.isMacro ? "<macro>" : "<fn>";
    default:         return String(val);
  }
}

function numericOp(op: string): (args: HQLValue[]) => HQLValue {
  return (args: HQLValue[]) => {
    if (args.length === 0) {
      if (op === "-" || op === "/")
        throw new Error(`'${op}' expects at least one argument`);
    }
    const nums = args.map(a => {
      if (a.type !== "number") throw new Error(`Expected number in ${op}`);
      return a.value;
    });
    switch (op) {
      case "+": return makeNumber(nums.reduce((acc, x) => acc + x, 0));
      case "*": return makeNumber(nums.reduce((acc, x) => acc * x, 1));
      case "-":
        return makeNumber(
          nums.length === 1 ? -nums[0] : nums.slice(1).reduce((acc, x) => acc - x, nums[0])
        );
      case "/":
        return makeNumber(
          nums.length === 1 ? 1 / nums[0] : nums.slice(1).reduce((acc, x) => acc / x, nums[0])
        );
      default: return makeNil();
    }
  };
}

const builtIns: Record<string, HQLValue> = {
  print: hostFunc((args) => {
    console.log(...args.map(hqlToJs));
    return makeNil();
  }),
  log: hostFunc((args) => {
    console.log(...args.map(hqlToJs));
    return makeNil();
  }),
  keyword: hostFunc(([s]) => {
    if (!s || s.type !== "string") {
      throw new Error("(keyword) expects exactly one string");
    }
    return makeSymbol(":" + s.value);
  }),
  "+": hostFunc(numericOp("+")),
  "-": hostFunc(numericOp("-")),
  "*": hostFunc(numericOp("*")),
  "/": hostFunc(numericOp("/")),
  "string-append": hostFunc((args) => {
    const out = args.map(a => a.type === "string" ? a.value : formatValue(a)).join("");
    return makeString(out);
  }),
  list: hostFunc(args => makeList(args)),
  vector: hostFunc(args => makeList([makeSymbol("vector"), ...args])),
  "hash-map": hostFunc(args => makeList([makeSymbol("hash-map"), ...args])),
  set: hostFunc(args => makeList([makeSymbol("set"), ...args])),
  get: hostFunc(([obj, prop]) => {
    const jsObj = (obj && obj.type === "opaque") ? obj.value : hqlToJs(obj);
    const key = (prop && prop.type === "string") ? prop.value : formatValue(prop);
    const val = jsObj?.[key];
    if (typeof val === "function") {
      return hostFunc(innerArgs => {
        const result = val(...innerArgs.map(hqlToJs));
        return result instanceof Promise ? result.then(jsToHql) : jsToHql(result);
      });
    }
    return jsToHql(val);
  }),
  now: hostFunc(() => wrapJsValue(new Date())),
  "->": hostFunc((args) => {
    if (args.length < 2) return args[0];
    let acc = args[0];
    for (let i = 1; i < args.length; i++) {
      const form = args[i];
      if (form.type !== "list" || form.value.length === 0) {
        throw new Error("-> expects each subsequent argument to be a non-empty list");
      }
      const fn = evaluateSync(form.value[0], baseEnv);
      if (fn.type !== "function") {
        throw new Error("-> expects a function in threaded position");
      }
      const newArgs = [acc, ...form.value.slice(1)];
      acc = applyFnSync(fn, newArgs);
    }
    return acc;
  }),
};

for (const k in builtIns) {
  baseEnv.set(k, builtIns[k]);
}

const builtInNameMap = new Map<HQLValue, string>();
for (const [k, v] of Object.entries(builtIns)) {
  builtInNameMap.set(v, k);
}

//////////////////////////////////////////////////////////////////////////////
// 6. CONVERSION BETWEEN HQL AND JAVASCRIPT
//////////////////////////////////////////////////////////////////////////////

function hqlToJs(val: HQLValue): any {
  if (!val) return null;
  switch (val.type) {
    case "nil":     return null;
    case "boolean": return val.value;
    case "number":  return val.value;
    case "string":  return val.value;
    case "symbol":  return val.name;
    case "list":    return val.value.map(hqlToJs);
    case "function":
      if (val.isSync) {
        return (...args: any[]) => {
          const r = applyFnSync(val, args.map(jsToHql));
          return hqlToJs(r);
        };
      } else {
        return async (...args: any[]) => {
          const r = await applyFnAsync(val, args.map(jsToHql));
          return hqlToJs(r);
        };
      }
    case "opaque":  return val.value;
    default:        return val;
  }
}

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

function getBuiltinNameByValue(fnVal: HQLFn): string | undefined {
  return builtInNameMap.get(fnVal);
}

async function applyFnAsync(fnVal: HQLFn, argVals: HQLValue[]): Promise<HQLValue> {
  if (fnVal.hostFn) {
    const builtinName = getBuiltinNameByValue(fnVal);
    let result = fnVal.hostFn(argVals);
    if (result instanceof Promise) result = await result;
    return result;
  }
  if (argVals.length < fnVal.params.length) {
    throw new Error(`Not enough args: expected ${fnVal.params.length}, got ${argVals.length}`);
  }
  const newEnv = new Env({}, fnVal.closure);
  for (let i = 0; i < fnVal.params.length; i++) {
    newEnv.set(fnVal.params[i], argVals[i]);
  }
  let out: HQLValue = makeNil();
  for (const form of fnVal.body) {
    out = await evaluateAsync(form, newEnv);
  }
  return out;
}

function applyFnSync(fnVal: HQLFn, argVals: HQLValue[]): HQLValue {
  if (fnVal.hostFn) {
    const builtinName = getBuiltinNameByValue(fnVal);
    if (builtinName && asyncBuiltInKeys.has(builtinName)) {
      throw new Error(`Sync function used async built-in '${builtinName}'!`);
    }
    const result = fnVal.hostFn(argVals);
    if (result instanceof Promise) {
      throw new Error("Sync function attempted async operation!");
    }
    return result;
  }
  if (argVals.length < fnVal.params.length) {
    throw new Error(`Not enough args: expected ${fnVal.params.length}, got ${argVals.length}`);
  }
  const newEnv = new Env({}, fnVal.closure);
  for (let i = 0; i < fnVal.params.length; i++) {
    newEnv.set(fnVal.params[i], argVals[i]);
  }
  let out: HQLValue = makeNil();
  for (const form of fnVal.body) {
    out = evaluateSync(form, newEnv);
  }
  return out;
}

//////////////////////////////////////////////////////////////////////////////
// 8. EVALUATION: ASYNC AND SYNC VERSIONS
//////////////////////////////////////////////////////////////////////////////

export async function evaluateAsync(ast: HQLValue, env: Env): Promise<HQLValue> {
  if (ast.type === "list" && ast.value.length > 0) {
    const [head, ...rest] = ast.value;
    if (head.type === "symbol" && head.name === "new") {
      if (rest.length === 0) throw new Error("(new) expects at least one argument");
      const ctorVal = await evaluateAsync(rest[0], env);
      const jsCtor = hqlToJs(ctorVal);
      const args: any[] = [];
      for (let j = 1; j < rest.length; j++) {
        const argVal = await evaluateAsync(rest[j], env);
        args.push(hqlToJs(argVal));
      }
      return wrapJsValue(Reflect.construct(jsCtor, args));
    }
  }
  if (ast.type === "symbol") {
    return env.get(ast.name);
  }
  if (["number", "string", "boolean", "nil"].includes(ast.type)) {
    return ast;
  }
  if (ast.type === "list") {
    if (ast.value.length === 0) return ast;
    const [head, ...rest] = ast.value;
    if (head.type === "symbol") {
      switch (head.name) {
        case "quote":
          return rest[0] ?? makeNil();
        case "if": {
          const cond = await evaluateAsync(rest[0], env);
          if (truthy(cond)) {
            return rest[1] ? await evaluateAsync(rest[1], env) : makeNil();
          } else {
            return rest[2] ? await evaluateAsync(rest[2], env) : makeNil();
          }
        }
        case "def":
        case "defsync":
        case "defmacro":
          return await handleDefinitionForm(
            head.name as "def" | "defsync" | "defmacro",
            rest,
            env,
            evaluateAsync,
            head.name === "defsync"
          );
        case "fn": {
          const paramsAst = rest[0];
          if (!paramsAst || paramsAst.type !== "list") {
            throw new Error("(fn) expects a list of parameters");
          }
          const paramNames = paramsAst.value.map((p: HQLValue) => {
            if (p.type === "symbol") return p.name;
            if (p.type === "list" && p.value[0]?.type === "symbol") return p.value[0].name;
            throw new Error("Invalid parameter spec in (fn)");
          });
          let bodyForms = rest.slice(1);
          if (
            bodyForms[0]?.type === "list" &&
            bodyForms[0].value[0]?.type === "symbol" &&
            bodyForms[0].value[0].name === "return"
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
        case "await":
          throw new Error("Async 'await' is not directly supported in code");
        case "export": {
          if (rest.length < 2) throw new Error("(export) expects (export \"name\" expr)");
          if (rest[0].type !== "string") throw new Error("(export) expects a string name");
          if (!env.exports) throw new Error("No exports map found in environment");
          const ev = await evaluateAsync(rest[1], env);
          env.exports[rest[0].value] = ev;
          return ev;
        }
        case "import": {
          if (rest.length < 1) throw new Error("(import) expects a URL");
          const urlVal = await evaluateAsync(rest[0], env);
          if (urlVal.type !== "string") throw new Error("import expects a string URL");
          const rawUrl = urlVal.value;
          const modUrl = rawUrl.startsWith("npm:")
            ? rawUrl
            : (rawUrl.includes("?bundle") ? rawUrl : rawUrl + "?bundle");
          const modObj = await import(modUrl);
          if (modObj.default?.__hql_module) return modObj.default.__hql_module;
          if (modObj.__hql_module) return modObj.__hql_module;
          return wrapJsValue(modObj.default ?? modObj);
        }
      }
    }
    const fnVal = await evaluateAsync(head, env);
    if (fnVal.type === "function") {
      if (fnVal.isMacro) {
        const expanded = await macroExpand(fnVal as HQLMacro, rest, env);
        return await evaluateAsync(expanded, env);
      }
      const argVals: HQLValue[] = [];
      for (const r of rest) {
        argVals.push(await evaluateAsync(r, env));
      }
      return await applyFnAsync(fnVal, argVals);
    }
    throw new Error(`Attempt to call non-function: ${head.type}`);
  }
  return ast;
}

export function evaluateSync(ast: HQLValue, env: Env): HQLValue {
  if (ast.type === "list" && ast.value.length > 0) {
    const [head, ...rest] = ast.value;
    if (head.type === "symbol" && head.name === "new") {
      if (rest.length === 0) throw new Error("(new) expects at least one argument");
      const ctorVal = evaluateSync(rest[0], env);
      const jsCtor = hqlToJs(ctorVal);
      const args: any[] = [];
      for (let j = 1; j < rest.length; j++) {
        const argVal = evaluateSync(rest[j], env);
        args.push(hqlToJs(argVal));
      }
      return wrapJsValue(Reflect.construct(jsCtor, args));
    }
  }
  if (ast.type === "symbol") {
    return env.get(ast.name);
  }
  if (["number", "string", "boolean", "nil"].includes(ast.type)) {
    return ast;
  }
  if (ast.type === "list") {
    if (ast.value.length === 0) return ast;
    const [head, ...rest] = ast.value;
    if (head.type === "symbol") {
      switch (head.name) {
        case "quote":
          return rest[0] ?? makeNil();
        case "if": {
          const cond = evaluateSync(rest[0], env);
          if (truthy(cond)) {
            return rest[1] ? evaluateSync(rest[1], env) : makeNil();
          } else {
            return rest[2] ? evaluateSync(rest[2], env) : makeNil();
          }
        }
        case "def":
        case "defsync":
          return handleDefinitionForm(
            head.name as "def" | "defsync",
            rest,
            env,
            evaluateSync,
            head.name === "defsync"
          );
        case "defmacro":
          throw new Error("Macros are not supported in sync mode.");
        case "fn": {
          const paramsAst = rest[0];
          if (!paramsAst || paramsAst.type !== "list") {
            throw new Error("(fn) expects a list of parameters");
          }
          const paramNames = paramsAst.value.map((p: HQLValue) => {
            if (p.type === "symbol") return p.name;
            if (p.type === "list" && p.value[0]?.type === "symbol") return p.value[0].name;
            throw new Error("Invalid parameter spec in (fn)");
          });
          let bodyForms = rest.slice(1);
          if (
            bodyForms[0]?.type === "list" &&
            bodyForms[0].value[0]?.type === "symbol" &&
            bodyForms[0].value[0].name === "return"
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
        case "await":
          throw new Error("Sync code cannot use async operation 'await'!");
        case "export": {
          if (rest.length < 2) throw new Error("(export) expects (export \"name\" expr)");
          if (rest[0].type !== "string") throw new Error("(export) expects a string name");
          if (!env.exports) throw new Error("No exports map found in environment");
          const evVal = evaluateSync(rest[1], env);
          env.exports[rest[0].value] = evVal;
          return evVal;
        }
        case "import":
          throw new Error("Sync code cannot use async operation 'import'!");
      }
    }
    const fnVal = evaluateSync(head, env);
    if (fnVal.type === "function") {
      if (fnVal.isMacro) throw new Error("Macros are not supported in sync mode.");
      const argVals: HQLValue[] = [];
      for (const r of rest) {
        argVals.push(evaluateSync(r, env));
      }
      return applyFnSync(fnVal, argVals);
    }
    throw new Error(`Attempt to call non-function: ${head.type}`);
  }
  return ast;
}

function handleDefinitionForm(
  formName: "def" | "defsync" | "defmacro",
  rest: HQLValue[],
  env: Env,
  evalFn: (ast: HQLValue, env: Env) => Promise<HQLValue> | HQLValue,
  markSync: boolean
): Promise<HQLValue> | HQLValue {
  if (!rest[0] || rest[0].type !== "symbol") {
    throw new Error(`(${formName}) expects a symbol`);
  }
  const nameSym = rest[0];
  const valExpr = rest[1] || makeNil();

  if (formName === "defmacro") {
    if (!rest[1] || rest[1].type !== "list") {
      throw new Error("(defmacro) expects a list of parameters");
    }
    const params = rest[1].value.map((p: HQLValue) => {
      if (p.type !== "symbol") throw new Error("Macro parameter must be a symbol");
      return p.name;
    });
    const body = rest.slice(2);
    const macroVal: HQLMacro = {
      type: "function",
      params,
      body,
      closure: env,
      isMacro: true,
    };
    env.set(nameSym.name, macroVal);
    return makeSymbol(nameSym.name);
  }

  const finalizeValue = (value: HQLValue) => {
    if (markSync && value.type === "function") {
      value.isSync = true;
    }
    env.set(nameSym.name, value);
    return value;
  };

  const maybePromise = evalFn(valExpr, env);
  if (maybePromise instanceof Promise) {
    return maybePromise.then(finalizeValue);
  } else {
    return finalizeValue(maybePromise);
  }
}

async function macroExpand(macro: HQLMacro, rawArgs: HQLValue[], env: Env): Promise<HQLValue> {
  if (rawArgs.length < macro.params.length) {
    throw new Error(`Not enough arguments for macro: expected ${macro.params.length}`);
  }
  const macroEnv = new Env({}, macro.closure);
  macro.params.forEach((p, i) => macroEnv.set(p, rawArgs[i]));
  let out: HQLValue = makeNil();
  for (const form of macro.body) {
    out = await evaluateAsync(form, macroEnv);
  }
  return out;
}

//////////////////////////////////////////////////////////////////////////////
// 9. RUN AND TRANSPILER
//////////////////////////////////////////////////////////////////////////////

export async function runHQLFile(
  path: string,
  targetExports?: Record<string, HQLValue>
): Promise<Record<string, HQLValue>> {
  const exportsMap = targetExports || {};
  const source = await Deno.readTextFile(path);
  const forms = parseHQL(source);
  const env = new Env({}, baseEnv);
  env.exports = exportsMap;
  for (const form of forms) {
    await evaluateAsync(form, env);
  }
  return exportsMap;
}

export async function transpileHQLFile(inputPath: string, outputPath?: string): Promise<void> {
  const exportsMap: Record<string, HQLValue> = {};
  const source = await Deno.readTextFile(inputPath);
  const forms = parseHQL(source);
  const env = new Env({}, baseEnv);
  env.exports = exportsMap;
  for (const form of forms) {
    await evaluateAsync(form, env);
  }
  const exportedNames = Object.keys(exportsMap);
  if (!outputPath) {
    outputPath = inputPath.endsWith(".hql") ? inputPath + ".js" : inputPath + ".js";
  }
  let code = `import { runHQLFile, getExport } from "./hql.ts";\n\n`;
  code += `const _exports = await runHQLFile("${inputPath}");\n\n`;
  for (const name of exportedNames) {
    const val = exportsMap[name];
    const isFn = val?.type === "function";
    const isSync = isFn && val.isSync;
    if (isFn) {
      if (isSync) {
        code += `
export function ${name}(...args) {
  const fn = getExport("${name}", _exports);
  return fn(...args);
}
`;
      } else {
        code += `
export async function ${name}(...args) {
  const fn = getExport("${name}", _exports);
  return await fn(...args);
}
`;
      }
    } else {
      code += `
export const ${name} = getExport("${name}", _exports);
`;
    }
  }
  await Deno.writeTextFile(outputPath, code);
  console.log(`Transpiled HQL from ${inputPath} -> ${outputPath}. Exports: ${exportedNames.join(", ")}`);
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
  const n = await Deno.stdin.read(buf);
  if (n === null) return null;
  return new TextDecoder().decode(buf.subarray(0, n)).replace(/\r?\n$/, "");
}

function countParens(input: string): number {
  let count = 0, inString = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charAt(i);
    if (ch === '"' && (i === 0 || input.charAt(i - 1) !== "\\")) {
      inString = !inString;
    }
    if (!inString) {
      if (ch === "(")      count++;
      else if (ch === ")") count--;
    }
  }
  return count;
}

async function readMultiline(): Promise<string | null> {
  let code = "";
  let parenCount = 0;
  while (true) {
    const prompt = parenCount > 0 ? "....> " : "HQL> ";
    await Deno.stdout.write(new TextEncoder().encode(prompt));
    const line = await readLine();
    if (line === null) return code.trim() === "" ? null : code;
    code += line + "\n";
    parenCount = countParens(code);
    if (parenCount <= 0) break;
  }
  return code;
}

async function repl(env: Env) {
  while (true) {
    const code = await readMultiline();
    if (code === null) {
      console.log("\nGoodbye.");
      return;
    }
    if (!code.trim()) continue;
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

function wrapJsValue(obj: any): HQLValue {
  return { type: "opaque", value: obj };
}
