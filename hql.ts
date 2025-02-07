#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env
/**
 * HQL Interpreter (Refactored) – TypeScript-safe with explicit parameter types
 *
 * Usage:
 *  - To run a HQL file:
 *      deno run --allow-read --allow-write --allow-net --allow-env hql.ts yourfile.hql
 *  - To transpile a HQL file to a JS module:
 *      deno run --allow-read --allow-write --allow-net --allow-env hql.ts --transpile yourfile.hql
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
  isSync?: boolean; // If set, trying async yields an error.
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
// Factories
//////////////////////////////////////////////////////////////////////////////

function makeSymbol(name: string): HQLSymbol   { return { type: "symbol",  name }; }
function makeList(value: HQLValue[]): HQLList  { return { type: "list",    value }; }
function makeNumber(n: number): HQLNumber      { return { type: "number",  value: n }; }
function makeString(s: string): HQLString      { return { type: "string",  value: s }; }
function makeBoolean(b: boolean): HQLBoolean   { return { type: "boolean", value: b }; }
function makeNil(): HQLNil                    { return { type: "nil" }; }

//////////////////////////////////////////////////////////////////////////////
// 2. ENVIRONMENT (with Exports Map)
//////////////////////////////////////////////////////////////////////////////

export class Env {
  bindings: Map<string, HQLValue>;
  outer: Env | null;
  exports?: Map<string, HQLValue>;

  constructor(bindings: Record<string, HQLValue> = {}, outer: Env | null = null) {
    this.bindings = new Map(Object.entries(bindings));
    this.outer = outer;
    this.exports = undefined;
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

  // If symbol not found, fall back to globalThis.
  get(name: string): HQLValue {
    const env = this.find(name);
    if (env) return env.bindings.get(name)!;
    if (name in globalThis) return wrapJsValue((globalThis as any)[name]);
    throw new Error(`Symbol '${name}' not found`);
  }
}

//////////////////////////////////////////////////////////////////////////////
// 3. TOKENIZER & PARSER
//////////////////////////////////////////////////////////////////////////////

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === ";") { // comment
      while (i < input.length && input[i] !== "\n") i++;
      continue;
    }
    // Parentheses or brackets
    if (c === "(" || c === "[") { tokens.push("("); i++; continue; }
    if (c === ")" || c === "]") { tokens.push(")"); i++; continue; }
    // String
    if (c === '"') {
      i++;
      let str = "";
      while (i < input.length && input[i] !== '"') str += input[i++];
      i++;
      tokens.push(`"${str}"`);
      continue;
    }
    // Symbol or number
    let sym = "";
    while (
      i < input.length &&
      !/\s/.test(input[i]) &&
      !["(", ")", "[", "]", ";"].includes(input[i])
    ) {
      sym += input[i++];
    }
    tokens.push(sym);
  }
  return tokens;
}

function parseAtom(token: string): HQLValue {
  if (/^[+-]?\d+(\.\d+)?$/.test(token)) return makeNumber(parseFloat(token));
  if (token.startsWith('"') && token.endsWith('"')) return makeString(token.slice(1, -1));
  if (token === "true")  return makeBoolean(true);
  if (token === "false") return makeBoolean(false);
  if (token === "nil")   return makeNil();
  return makeSymbol(token);
}

function readFromTokens(tokens: string[]): HQLValue {
  if (!tokens.length) throw new Error("Unexpected EOF");
  const token = tokens.shift()!;
  if (token === "(") {
    const items: HQLValue[] = [];
    while (tokens[0] !== ")") {
      if (!tokens.length) throw new Error("Missing )");
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

function parseHQL(input: string): HQLValue[] {
  const tokens = tokenize(input);
  const forms: HQLValue[] = [];
  while (tokens.length) {
    forms.push(readFromTokens(tokens));
  }
  return forms;
}

//////////////////////////////////////////////////////////////////////////////
// 4. EXPORTS MANAGEMENT
//////////////////////////////////////////////////////////////////////////////

export function getExport(name: string, targetExports: Map<string, HQLValue>): any {
  if (!targetExports.has(name)) {
    throw new Error(`HQL export '${name}' not found`);
  }
  return hqlToJs(targetExports.get(name)!);
}

//////////////////////////////////////////////////////////////////////////////
// 5. BUILT-IN FUNCTIONS & BASE ENVIRONMENT
//////////////////////////////////////////////////////////////////////////////

export const baseEnv = new Env({}, null);

const asyncBuiltInKeys = new Set<string>([
  "sleep", "fetch", "read-file", "write-file", "await", "import",
]);

function hostFunc(fn: (args: HQLValue[]) => Promise<HQLValue> | HQLValue): HQLFn {
  return { type: "function", params: [], body: [], closure: baseEnv, isMacro: false, hostFn: fn };
}

function truthy(val: HQLValue): boolean {
  if (!val || val.type === "nil") return false;
  return val.type === "boolean" ? val.value : true;
}

function formatValue(val: HQLValue): string {
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

/** Helper to unify numeric built-ins: + - * / */
function numericOp(op: string): (args: HQLValue[]) => HQLValue {
  return (args: HQLValue[]) => {
    if (!args.length) {
      if (op === "-") throw new Error("'-' expects at least one argument");
      if (op === "/") throw new Error("'/' expects at least one argument");
    }
    const nums = args.map(a => {
      if (a.type !== "number") throw new Error(`Expected number in ${op}`);
      return a.value;
    });
    if (op === "+") return makeNumber(nums.reduce((acc, x) => acc + x, 0));
    if (op === "*") return makeNumber(nums.reduce((acc, x) => acc * x, 1));
    if (op === "-") {
      return makeNumber(
        nums.length === 1
          ? -nums[0]
          : nums.slice(1).reduce((acc, x) => acc - x, nums[0])
      );
    }
    if (op === "/") {
      if (nums.length === 1) return makeNumber(1 / nums[0]);
      return makeNumber(nums.slice(1).reduce((acc, x) => acc / x, nums[0]));
    }
    return makeNil(); // fallback, shouldn't happen
  };
}

const builtIns: Record<string, HQLValue> = {
  print: hostFunc((args: HQLValue[]) => { console.log(...args.map(hqlToJs)); return makeNil(); }),
  log:   hostFunc((args: HQLValue[]) => { console.log(...args.map(hqlToJs)); return makeNil(); }),

  keyword: hostFunc(([s]) => {
    if (!s || s.type !== "string") throw new Error("(keyword) expects exactly one string");
    return makeSymbol(":" + s.value);
  }),

  "+": hostFunc(numericOp("+")),
  "-": hostFunc(numericOp("-")),
  "*": hostFunc(numericOp("*")),
  "/": hostFunc(numericOp("/")),

  "string-append": hostFunc((args: HQLValue[]) => {
    const out = args.map(a => a.type === "string" ? a.value : formatValue(a)).join("");
    return makeString(out);
  }),

  list: hostFunc((args: HQLValue[]) => makeList(args)),
  vector: hostFunc((args: HQLValue[]) => makeList([makeSymbol("vector"), ...args])),
  "hash-map": hostFunc((args: HQLValue[]) => makeList([makeSymbol("hash-map"), ...args])),
  set: hostFunc((args: HQLValue[]) => makeList([makeSymbol("set"), ...args])),

  get: hostFunc(([obj, prop]) => {
    const jsObj  = obj?.type === "opaque" ? obj.value : hqlToJs(obj);
    const key    = prop?.type === "string" ? prop.value : formatValue(prop);
    const val    = jsObj?.[key];
    if (typeof val === "function") {
      return hostFunc((innerArgs: HQLValue[]) => {
        const result = val(...innerArgs.map(hqlToJs));
        return result instanceof Promise ? result.then(jsToHql) : jsToHql(result);
      });
    }
    return jsToHql(val);
  }),

  now: hostFunc(() => wrapJsValue(new Date())),
};

for (const k in builtIns) {
  baseEnv.set(k, builtIns[k]);
}

//////////////////////////////////////////////////////////////////////////////
// 6. CONVERSION BETWEEN HQL AND JAVASCRIPT
//////////////////////////////////////////////////////////////////////////////

function hqlToJs(val: HQLValue): any {
  if (!val) return null;
  switch (val.type) {
    case "nil":      return null;
    case "boolean":  return val.value;
    case "number":   return val.value;
    case "string":   return val.value;
    case "symbol":   return val.name;
    case "list":     return val.value.map(hqlToJs);
    case "function": {
      if (val.isSync) {
        // Sync function
        return (...args: any[]) => {
          const r = applyFn(val, args.map(jsToHql), true);
          if (r instanceof Promise) throw new Error("Sync function encountered async path!");
          return hqlToJs(r);
        };
      } else {
        // Async function
        return async (...args: any[]) => {
          const r = await applyFn(val, args.map(jsToHql), false);
          return hqlToJs(r);
        };
      }
    }
    case "opaque":   return val.value;
    default:         return val;
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
// 7. FUNCTION APPLICATION: Unified for Sync/Async
//////////////////////////////////////////////////////////////////////////////

function getBuiltinNameByValue(fnVal: HQLFn): string | undefined {
  for (const [k, v] of Object.entries(builtIns)) {
    if (v === fnVal) return k;
  }
  return undefined;
}

async function _applyFn(fnVal: HQLFn, argVals: HQLValue[], isSync: boolean): Promise<HQLValue> {
  // If it's a built-in host function:
  if (fnVal.hostFn) {
    const builtinName = getBuiltinNameByValue(fnVal);
    if (isSync && builtinName && asyncBuiltInKeys.has(builtinName)) {
      throw new Error(`Sync function used async built-in '${builtinName}'!`);
    }
    let result = fnVal.hostFn(argVals);
    if (result instanceof Promise) {
      if (isSync) throw new Error("Sync function attempted async operation!");
      result = await result;
    }
    return result;
  }
  // Else user-defined function
  if (argVals.length < fnVal.params.length) {
    throw new Error(`Not enough args: expected ${fnVal.params.length}, got ${argVals.length}`);
  }
  const newEnv = new Env({}, fnVal.closure);
  fnVal.params.forEach((p, i) => newEnv.set(p, argVals[i]));
  let out: HQLValue = makeNil();
  for (const form of fnVal.body) {
    out = await evaluate(form, newEnv, isSync);
  }
  return out;
}

function unwrapPromiseForSync<T>(p: Promise<T>): T {
  // We do not truly block in Deno. We simply throw an error to forbid async in sync code:
  throw new Error("Detected promise in sync context!");
}

/** applyFn unifies calling built-ins or user-defined functions in sync/async mode. */
function applyFn(fnVal: HQLFn, argVals: HQLValue[], isSync: boolean): Promise<HQLValue> | HQLValue {
  const promise = _applyFn(fnVal, argVals, isSync);
  return isSync ? unwrapPromiseForSync(promise) : promise;
}

//////////////////////////////////////////////////////////////////////////////
// 8. EVALUATION – Single Function with isSync Toggle
//////////////////////////////////////////////////////////////////////////////

/**
 * Evaluate HQL AST in either sync or async mode, depending on isSync.
 * If isSync = true, any async path (like macros, `await`, or `import`) is disallowed.
 */
export async function evaluate(ast: HQLValue, env: Env, isSync: boolean): Promise<HQLValue> {
  // Special check for (new ...)
  if (ast.type === "list" && ast.value.length > 0) {
    const [head, ...rest] = ast.value;
    if (head.type === "symbol" && head.name === "new") {
      if (!rest.length) throw new Error("(new) expects at least one argument (the constructor)");
      const ctorVal = await evaluate(rest[0], env, isSync);
      const jsCtor  = hqlToJs(ctorVal);
      const args    = [];
      for (const r of rest.slice(1)) {
        const rv = await evaluate(r, env, isSync);
        args.push(hqlToJs(rv));
      }
      return wrapJsValue(Reflect.construct(jsCtor, args));
    }
  }

  // Base cases
  if (ast.type === "symbol")  return env.get(ast.name);
  if (
    ast.type === "number" ||
    ast.type === "string" ||
    ast.type === "boolean" ||
    ast.type === "nil"
  ) {
    return ast;
  }

  // If it's a list, handle special forms or function calls
  if (ast.type === "list") {
    if (!ast.value.length) return ast;
    const [head, ...rest] = ast.value;
    if (head.type === "symbol") {
      switch (head.name) {
        case "quote": return rest[0] ?? makeNil();

        case "if": {
          const cond = await evaluate(rest[0], env, isSync);
          return truthy(cond)
            ? (rest[1] ? await evaluate(rest[1], env, isSync) : makeNil())
            : (rest[2] ? await evaluate(rest[2], env, isSync) : makeNil());
        }

        // Unified definitions: def, defsync, defmacro
        case "def":
        case "defsync":
        case "defmacro":
          return handleDefinitionForm(head.name, rest, env, isSync);

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
          // Optional skip of leading (return ...) annotation
          let bodyForms = rest.slice(1);
          if (
            bodyForms[0]?.type === "list" &&
            bodyForms[0].value[0]?.type === "symbol" &&
            bodyForms[0].value[0].name === "return"
          ) {
            bodyForms = bodyForms.slice(1);
          }
          return { type: "function", params: paramNames, body: bodyForms, closure: env } as HQLFn;
        }

        case "await":
          if (isSync) throw new Error("Sync code tried to call async operation 'await'!");
          const val = await evaluate(rest[0], env, isSync);
          return (val instanceof Promise) ? await val : val;

        case "export": {
          if (rest.length < 2) throw new Error("(export) expects (export \"name\" expr)");
          const [nameVal, exprVal] = rest;
          if (nameVal.type !== "string") throw new Error("(export) expects a string name");
          if (!env.exports) throw new Error("No exports map found in environment");
          const ev = await evaluate(exprVal, env, isSync);
          env.exports.set(nameVal.value, ev);
          return ev;
        }

        case "import":
          if (isSync) throw new Error("Sync code tried to call async operation 'import'!");
          if (!rest.length) throw new Error("(import) expects a URL");
          const urlVal = await evaluate(rest[0], env, isSync);
          if (urlVal.type !== "string") throw new Error("import expects a string URL");
          const rawUrl = urlVal.value;
          const modUrl = rawUrl.startsWith("npm:")
            ? rawUrl
            : (rawUrl.includes("?bundle") ? rawUrl : rawUrl + "?bundle");
          const modObj = await import(modUrl);
          const modCandidate = modObj.default ?? modObj;
          if (modCandidate?.__hql_module) return modCandidate.__hql_module;
          return wrapJsValue(modCandidate);
      }
    }
    // Function call
    const fnVal = await evaluate(head, env, isSync);
    if (fnVal.type === "function") {
      if (fnVal.isMacro) {
        // Expand macro (not allowed in sync => already handled in defmacro)
        const expanded = await macroExpand(fnVal, rest, env, isSync);
        return evaluate(expanded, env, isSync);
      }
      const argVals: HQLValue[] = [];
      for (const r of rest) {
        argVals.push(await evaluate(r, env, isSync));
      }
      return applyFn(fnVal, argVals, isSync);
    }
    throw new Error(`Attempt to call non-function: ${head.type}`);
  }
  return ast;
}

/** Handle (def var val), (defsync var val), (defmacro var [params] ...). */
async function handleDefinitionForm(
  formName: "def" | "defsync" | "defmacro",
  rest: HQLValue[],
  env: Env,
  isSync: boolean
): Promise<HQLValue> {
  // "def", "defsync", "defmacro" all expect at least a symbol
  if (!rest[0] || rest[0].type !== "symbol") {
    throw new Error(`(${formName}) expects a symbol`);
  }
  const nameSym = rest[0];
  // If there's a second expression, evaluate it, else nil
  const valExpr = rest[1] || makeNil();

  // defmacro in sync mode => error
  if (formName === "defmacro" && isSync) {
    throw new Error("Macros are not supported in sync mode.");
  }

  // defmacro => define macro
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

  // def or defsync => normal evaluation
  const value = await evaluate(valExpr, env, isSync);
  if (formName === "defsync" && value.type === "function") {
    value.isSync = true;
  }
  env.set(nameSym.name, value);
  return value;
}

/** Expand macro: bind raw forms to the macro's parameters, then evaluate. */
async function macroExpand(
  macro: HQLMacro,
  rawArgs: HQLValue[],
  env: Env,
  isSync: boolean
): Promise<HQLValue> {
  if (rawArgs.length < macro.params.length) {
    throw new Error(`Not enough arguments for macro: expected ${macro.params.length}`);
  }
  const macroEnv = new Env({}, macro.closure);
  macro.params.forEach((p, i) => macroEnv.set(p, rawArgs[i]));
  let out: HQLValue = makeNil();
  for (const form of macro.body) {
    out = await evaluate(form, macroEnv, isSync);
  }
  return out;
}

//////////////////////////////////////////////////////////////////////////////
// 9. RUN AND TRANSPILER
//////////////////////////////////////////////////////////////////////////////

export async function runHQLFile(
  path: string,
  targetExports?: Map<string, HQLValue>
): Promise<Map<string, HQLValue>> {
  const exportsMap = targetExports || new Map<string, HQLValue>();
  const source = await Deno.readTextFile(path);
  const forms = parseHQL(source);
  const env = new Env({}, baseEnv);
  env.exports = exportsMap;
  for (const form of forms) {
    await evaluate(form, env, false); // default to async mode
  }
  return exportsMap;
}

export async function transpileHQLFile(inputPath: string, outputPath?: string): Promise<void> {
  const exportsMap = new Map<string, HQLValue>();
  const source = await Deno.readTextFile(inputPath);
  const forms = parseHQL(source);
  const env = new Env({}, baseEnv);
  env.exports = exportsMap;

  for (const form of forms) {
    await evaluate(form, env, false);
  }
  const exportedNames = [...exportsMap.keys()];
  if (!outputPath) {
    outputPath = inputPath.endsWith(".hql") ? inputPath + ".js" : inputPath + ".js";
  }

  let code = `import { runHQLFile, getExport } from "./hql.ts";\n\n`;
  code += `const _exports = await runHQLFile("${inputPath}");\n\n`;
  for (const name of exportedNames) {
    const val = exportsMap.get(name);
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
  if (!Deno.args.length) {
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
    const ch = input[i];
    if (ch === '"' && (i === 0 || input[i - 1] !== "\\")) inString = !inString;
    if (!inString) {
      if (ch === "(") count++;
      else if (ch === ")") count--;
    }
  }
  return count;
}

async function readMultiline(): Promise<string | null> {
  let code = "", parenCount = 0;
  while (true) {
    const prompt = parenCount > 0 ? "....> " : "HQL> ";
    await Deno.stdout.write(new TextEncoder().encode(prompt));
    const line = await readLine();
    if (line === null) {
      return code.trim() === "" ? null : code;
    }
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
        result = await evaluate(form, env, false);
      }
      console.log(formatValue(result));
    } catch (e: any) {
      console.error("Error:", e.message);
    }
  }
}

/** Wraps a native JS value as an opaque HQL value. */
function wrapJsValue(obj: any): HQLValue {
  return { type: "opaque", value: obj };
}
