#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net
/**
 * =============================================================================
 * HQL Interpreter – A 100% Pure S-expression Lisp-like Interpreter for Deno
 * =============================================================================
 *
 * Highlights:
 *  - Includes a built-in "keyword" function that produces a symbol named ":a",
 *    thus no "Symbol 'keyword' not found" error.
 *  - We log the builtIns keys to confirm "keyword" is actually there.
 *
 * Usage:
 *  deno run --allow-read --allow-write --allow-net hql.ts hello.hql
 */

//////////////////////////////////////////////////////////////////////////////
// 1. AST Definitions & Factory Helpers
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
  | Promise<HQLValue>
  | any;

export interface HQLSymbol {
  type: "symbol";
  name: string;  // e.g. "x", "->", or ":a"
}

export interface HQLList {
  type: "list";
  value: HQLValue[];
}

export interface HQLNumber {
  type: "number";
  value: number;
}

export interface HQLString {
  type: "string";
  value: string;
}

export interface HQLBoolean {
  type: "boolean";
  value: boolean;
}

export interface HQLNil {
  type: "nil";
}

export interface HQLFn {
  type: "function";
  params: string[];
  body: HQLValue[];
  closure: Env;
  isMacro?: false;
  hostFn?: (args: HQLValue[]) => Promise<HQLValue> | HQLValue;
  retType?: HQLValue; 
}

export interface HQLMacro {
  type: "function";
  params: string[];
  body: HQLValue[];
  closure: Env;
  isMacro: true;
}

export interface HQLOpaque {
  type: "opaque";
  value: any;
}

function makeSymbol(name: string): HQLSymbol {
  return { type: "symbol", name };
}

function makeList(items: HQLValue[]): HQLList {
  return { type: "list", value: items };
}

function makeNumber(num: number): HQLNumber {
  return { type: "number", value: num };
}

function makeString(str: string): HQLString {
  return { type: "string", value: str };
}

function makeBoolean(b: boolean): HQLBoolean {
  return { type: "boolean", value: b };
}

function makeNil(): HQLNil {
  return { type: "nil" };
}

//////////////////////////////////////////////////////////////////////////////
// 2. Tokenizer (Pure S-expression)
//////////////////////////////////////////////////////////////////////////////

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === ";") {
      // Skip comment until newline
      while (i < input.length && input[i] !== "\n") {
        i++;
      }
      continue;
    }
    // '(' '[' => "(" and ')' ']' => ")"
    if (c === "(" || c === "[") {
      tokens.push("(");
      i++;
      continue;
    }
    if (c === ")" || c === "]") {
      tokens.push(")");
      i++;
      continue;
    }
    // String literal
    if (c === '"') {
      i++;
      let str = "";
      while (i < input.length && input[i] !== '"') {
        str += input[i++];
      }
      i++; // skip closing quote
      tokens.push(`"${str}"`);
      continue;
    }
    // Otherwise read a symbol/number until whitespace or delimiter
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

//////////////////////////////////////////////////////////////////////////////
// 3. Parser
//////////////////////////////////////////////////////////////////////////////

function parseAtom(token: string): HQLValue {
  if (/^[+-]?\d+(\.\d+)?$/.test(token)) {
    return makeNumber(parseFloat(token));
  }
  if (token.startsWith('"') && token.endsWith('"')) {
    return makeString(token.slice(1, -1));
  }
  if (token === "true") return makeBoolean(true);
  if (token === "false") return makeBoolean(false);
  if (token === "nil") return makeNil();
  return makeSymbol(token);
}

function readFromTokens(tokens: string[]): HQLValue {
  if (tokens.length === 0) throw new Error("Unexpected EOF");
  const token = tokens.shift()!;
  if (token === "(") {
    const listItems: HQLValue[] = [];
    while (tokens[0] !== ")") {
      if (tokens.length === 0) throw new Error("Missing )");
      listItems.push(readFromTokens(tokens));
    }
    tokens.shift(); // remove ")"
    return makeList(listItems);
  } else if (token === ")") {
    throw new Error("Unexpected )");
  } else {
    return parseAtom(token);
  }
}

function parseHQL(input: string): HQLValue[] {
  const tokens = tokenize(input);
  const forms: HQLValue[] = [];
  while (tokens.length > 0) {
    forms.push(readFromTokens(tokens));
  }
  return forms;
}

//////////////////////////////////////////////////////////////////////////////
// 4. Environment
//////////////////////////////////////////////////////////////////////////////

export class Env {
  bindings: Map<string, HQLValue>;
  outer: Env | null;

  constructor(bindings: Record<string, HQLValue> = {}, outer: Env | null = null) {
    this.bindings = new Map(Object.entries(bindings));
    this.outer = outer;
  }

  set(name: string, value: HQLValue) {
    this.bindings.set(name, value);
    return value;
  }

  find(name: string): Env | null {
    if (this.bindings.has(name)) {
      return this;
    }
    if (this.outer) {
      return this.outer.find(name);
    }
    return null;
  }

  get(name: string): HQLValue {
    const env = this.find(name);
    if (!env) throw new Error(`Symbol '${name}' not found`);
    return env.bindings.get(name)!;
  }
}

//////////////////////////////////////////////////////////////////////////////
// 5. Evaluation
//////////////////////////////////////////////////////////////////////////////

async function evaluate(ast: HQLValue, env: Env): Promise<HQLValue> {
  if (ast instanceof Promise) return ast;
  if (ast.type === "symbol") {
    if (ast.name.startsWith("js/")) {
      return wrapJsValue(resolveGlobalObject(ast.name.slice(3)));
    }
    return env.get(ast.name);
  }
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
        case "quote": {
          return list[1] ?? makeNil();
        }
        case "if": {
          const condVal = await evaluate(list[1], env);
          if (truthy(condVal)) {
            return list[2] ? await evaluate(list[2], env) : makeNil();
          } else {
            return list[3] ? await evaluate(list[3], env) : makeNil();
          }
        }
        case "def": {
          const sym = list[1];
          if (!sym || sym.type !== "symbol") {
            throw new Error("def expects a symbol as first argument");
          }
          const val = list[2] ? await evaluate(list[2], env) : makeNil();
          return env.set(sym.name, val);
        }
        case "fn": {
          const paramsAst = list[1];
          if (!paramsAst || paramsAst.type !== "list") {
            throw new Error("fn expects (list of params) ...body...");
          }
          // gather param names
          const paramNames = paramsAst.value.map((p) => {
            if (p.type === "list" && p.value.length >= 1) {
              const namePart = p.value[0];
              if (namePart.type !== "symbol") {
                throw new Error("param name must be symbol");
              }
              return namePart.name;
            } else if (p.type === "symbol") {
              return p.name;
            } else {
              throw new Error("invalid param specification");
            }
          });
          let bodyForms = list.slice(2);
          let retType: HQLValue | undefined = undefined;
          // check if first form is (-> Int) or (ret Int)
          if (
            bodyForms.length > 0 &&
            bodyForms[0].type === "list" &&
            bodyForms[0].value.length >= 2 &&
            bodyForms[0].value[0].type === "symbol" &&
            (bodyForms[0].value[0].name === "->" || bodyForms[0].value[0].name === "ret")
          ) {
            retType = bodyForms[0].value[1];
            bodyForms = bodyForms.slice(1);
          }
          const fnVal: HQLFn = {
            type: "function",
            params: paramNames,
            body: bodyForms,
            closure: env,
            isMacro: false,
            retType,
          };
          return fnVal;
        }
        case "defmacro": {
          const sym = list[1];
          if (!sym || sym.type !== "symbol") {
            throw new Error("defmacro expects a symbol name");
          }
          const paramsAst = list[2];
          if (!paramsAst || paramsAst.type !== "list") {
            throw new Error("defmacro expects (list of params) ...body...");
          }
          const paramNames = paramsAst.value.map((p) => {
            if (p.type !== "symbol") {
              throw new Error("Macro params must be symbols");
            }
            return p.name;
          });
          const bodyForms = list.slice(3);
          const macroVal: HQLMacro = {
            type: "function",
            params: paramNames,
            body: bodyForms,
            closure: env,
            isMacro: true,
          };
          env.set(sym.name, macroVal);
          return makeSymbol(sym.name);
        }
        case "await": {
          const exprVal = await evaluate(list[1], env);
          if (exprVal instanceof Promise) return await exprVal;
          return exprVal;
        }
        case "import": {
          const urlVal = await evaluate(list[1], env);
          if (urlVal.type !== "string") {
            throw new Error("import expects a string URL");
          }
          const url = urlVal.value;
          let modUrl: string;
          if (url.startsWith("npm:")) {
            modUrl = url;
          } else {
            modUrl = url.includes("?bundle") ? url : url + "?bundle";
          }
          const modObj = await import(modUrl);
          let modCandidate = modObj.default ?? modObj;
          if (
            typeof modCandidate === "function" &&
            modCandidate.green === undefined &&
            typeof modObj.green !== "undefined"
          ) {
            modCandidate = modObj;
          }
          if (typeof modCandidate === "function" && "level" in modCandidate) {
            modCandidate.level = 1;
          }
          return wrapJsValue(modCandidate);
        }
      }
    }
    // Evaluate function call
    const fnVal = await evaluate(head, env);
    if (fnVal.type === "function") {
      if (fnVal.isMacro) {
        const expanded = await macroExpand(fnVal, list.slice(1), env);
        return await evaluate(expanded, env);
      } else {
        const argsEvaluated: HQLValue[] = [];
        for (const arg of list.slice(1)) {
          argsEvaluated.push(await evaluate(arg, env));
        }
        return await applyFn(fnVal, argsEvaluated);
      }
    } else {
      throw new Error("Attempt to call a non-function");
    }
  }
  throw new Error("Unrecognized AST node in evaluate");
}

async function macroExpand(macroFn: HQLMacro, rawArgs: HQLValue[], env: Env): Promise<HQLValue> {
  const newEnv = new Env({}, macroFn.closure);
  if (rawArgs.length < macroFn.params.length) {
    throw new Error(`Not enough args to macro. Expected ${macroFn.params.length}`);
  }
  for (let i = 0; i < macroFn.params.length; i++) {
    newEnv.set(macroFn.params[i], rawArgs[i]);
  }
  let result: HQLValue = makeNil();
  for (const form of macroFn.body) {
    result = await evaluate(form, newEnv);
  }
  return result;
}

async function applyFn(fnVal: HQLFn, argVals: HQLValue[]): Promise<HQLValue> {
  const anyFnVal = fnVal as any;
  if (typeof anyFnVal.hostFn === "function") {
    return await anyFnVal.hostFn(argVals);
  }
  const newEnv = new Env({}, fnVal.closure);
  if (argVals.length < fnVal.params.length) {
    throw new Error(`Not enough arguments. Expected ${fnVal.params.length}, got ${argVals.length}`);
  }
  for (let i = 0; i < fnVal.params.length; i++) {
    newEnv.set(fnVal.params[i], argVals[i]);
  }
  let result: HQLValue = makeNil();
  for (const form of fnVal.body) {
    result = await evaluate(form, newEnv);
  }
  return result;
}

function truthy(val: HQLValue): boolean {
  if (val.type === "nil") return false;
  if (val.type === "boolean") return val.value;
  return true;
}

//////////////////////////////////////////////////////////////////////////////
// 6. Standard Library / Built-ins
//////////////////////////////////////////////////////////////////////////////

const baseEnv = new Env({}, null);

function hostFunc(fn: (args: HQLValue[]) => Promise<HQLValue> | HQLValue): HQLFn {
  return {
    type: "function",
    params: [],
    body: [],
    closure: baseEnv,
    isMacro: false,
    hostFn: fn,
  } as HQLFn;
}

function formatValue(val: HQLValue): string {
  if (!val) return "nil?";
  if (val instanceof Promise) return "<promise>";
  switch (val.type) {
    case "number": return String(val.value);
    case "string": return JSON.stringify(val.value);
    case "boolean": return val.value ? "true" : "false";
    case "nil": return "nil";
    case "symbol": return val.name;
    case "list": return "(" + val.value.map(formatValue).join(" ") + ")";
    case "function": return val.isMacro ? "<macro>" : "<fn>";
    default: return String(val);
  }
}

function hqlToJs(val: HQLValue): any {
  if (val.type === "nil") return null;
  if (val.type === "boolean") return val.value;
  if (val.type === "number") return val.value;
  if (val.type === "string") return val.value;
  if (val.type === "list") return val.value.map(hqlToJs);
  if (val.type === "function") {
    if ((val as any).__isWrapped) return val;
    return async (...args: any[]) => {
      const wrapped = args.map(jsToHql);
      return hqlToJs(await applyFn(val, wrapped));
    };
  }
  if (val.type === "opaque") return val.value;
  return val;
}

function jsToHql(obj: any): HQLValue {
  if (obj === null || obj === undefined) return makeNil();
  if (typeof obj === "boolean") return makeBoolean(obj);
  if (typeof obj === "number") return makeNumber(obj);
  if (typeof obj === "string") return makeString(obj);
  if (Array.isArray(obj)) return makeList(obj.map(jsToHql));
  return { type: "opaque", value: obj };
}

function wrapJsFunction(fn: Function): HQLValue {
  const f = async (...args: any[]) => fn(...args);
  Object.defineProperties(f, Object.getOwnPropertyDescriptors(fn));
  Object.setPrototypeOf(f, fn);
  (f as any).type = "function";
  (f as any).isMacro = false;
  (f as any).__isWrapped = true;
  (f as any).hostFn = async (args: HQLValue[]) => {
    const jsArgs = args.map(hqlToJs);
    const result = await fn(...jsArgs);
    return jsToHql(result);
  };
  return f as any;
}

function wrapJsValue(obj: any): HQLValue {
  if (typeof obj === "function") return wrapJsFunction(obj);
  return jsToHql(obj);
}

function resolveGlobalObject(path: string): any {
  let obj: any = globalThis;
  const parts = path.split(".");
  for (const part of parts) {
    if (part in obj) obj = obj[part];
    else throw new Error(`Global object not found: ${path}`);
  }
  return obj;
}

const builtIns: Record<string, HQLValue> = {
  println: hostFunc((args) => {
    console.log(...args.map(formatValue));
    return makeNil();
  }),
  log: hostFunc((args) => {
    console.log(...args.map(a => hqlToJs(a)));
    return makeNil();
  }),

  // KEY FIX: The "keyword" built-in 
  keyword: hostFunc((args) => {
    // e.g. (keyword "a") => symbol named ":a"
    if (args.length !== 1 || args[0].type !== "string") {
      throw new Error("(keyword) expects exactly one string");
    }
    const s = args[0].value;
    return makeSymbol(":" + s);  // => :a
  }),

  "+": hostFunc((args) => {
    let sum = 0;
    for (const a of args) {
      if (a.type !== "number") throw new Error("Expected number in +");
      sum += a.value;
    }
    return makeNumber(sum);
  }),
  "*": hostFunc((args) => {
    let product = 1;
    for (const a of args) {
      if (a.type !== "number") throw new Error("Expected number in *");
      product *= a.value;
    }
    return makeNumber(product);
  }),
  "string-append": hostFunc((args) => {
    const out = args.map((v) => v.type === "string" ? v.value : formatValue(v)).join("");
    return makeString(out);
  }),
  list: hostFunc((args) => makeList(args)),

  // Data structures
  vector: hostFunc((args) => {
    return makeList([makeSymbol("vector"), ...args]);
  }),
  "hash-map": hostFunc((args) => {
    return makeList([makeSymbol("hash-map"), ...args]);
  }),
  set: hostFunc((args) => {
    return makeList([makeSymbol("set"), ...args]);
  }),

  "read-file": hostFunc(async (args) => {
    if (args.length < 1 || args[0].type !== "string") {
      throw new Error("read-file expects a string path");
    }
    const content = await Deno.readTextFile(args[0].value);
    return makeString(content);
  }),
  "write-file": hostFunc(async (args) => {
    if (args.length < 2 || args[0].type !== "string" || args[1].type !== "string") {
      throw new Error("write-file expects (string path, string content)");
    }
    await Deno.writeTextFile(args[0].value, args[1].value);
    return makeNil();
  }),
  fetch: hostFunc(async (args) => {
    if (args.length < 1 || args[0].type !== "string") {
      throw new Error("fetch expects a string URL");
    }
    const resp = await fetch(args[0].value);
    const respObj = {
      status: resp.status,
      text: async () => jsToHql(await resp.text()),
      json: async () => jsToHql(await resp.json()),
    };
    return wrapJsValue(respObj);
  }),
  sleep: hostFunc(async (args) => {
    if (args.length < 1 || args[0].type !== "number") {
      throw new Error("sleep expects a number");
    }
    await new Promise((r) => setTimeout(r, args[0].value));
    return makeNil();
  }),
  get: hostFunc((args) => {
    if (args.length < 2 || args[1].type !== "string") {
      throw new Error("(get obj key) expects second arg as string");
    }
    const obj = hqlToJs(args[0]);
    const key = args[1].value;
    return wrapJsValue(obj[key]);
  }),
};

// Debug: show that we have "keyword" in the builtIns
// console.log("DEBUG: builtIns keys =", Object.keys(builtIns));

// Load built-ins into baseEnv
for (const key in builtIns) {
  baseEnv.set(key, builtIns[key]);
}

//////////////////////////////////////////////////////////////////////////////
// 7. REPL + File Execution
//////////////////////////////////////////////////////////////////////////////

async function readLine(): Promise<string | null> {
  const buf = new Uint8Array(1024);
  const n = <number>await Deno.stdin.read(buf);
  if (n === null) return null;
  return new TextDecoder().decode(buf.subarray(0, n)).replace(/\r?\n$/, "");
}

function countParens(input: string): number {
  let count = 0;
  let inString = false;
  for (let i = 0; i < input.length; i++) {
    if (input[i] === '"' && (i === 0 || input[i - 1] !== "\\")) {
      inString = !inString;
    }
    if (!inString) {
      if (input[i] === "(") count++;
      else if (input[i] === ")") count--;
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

async function evaluateMacroSafe(ast: HQLValue, env: Env): Promise<HQLValue> {
  if (ast.type === "list" && ast.value.length > 0) {
    const head = ast.value[0];
    if (head.type === "symbol") {
      const found = env.find(head.name);
      if (found) {
        const val = found.get(head.name);
        if (val && val.type === "function" && val.isMacro) {
          const expanded = await macroExpand(val, ast.value.slice(1), env);
          return evaluate(expanded, env);
        }
      }
    }
  }
  return evaluate(ast, env);
}

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
        result = await evaluateMacroSafe(form, env);
      }
      if (result instanceof Promise) result = await result;
      console.log(formatValue(result));
    } catch (e) {
      console.error("Error:", e.message);
    }
  }
}

if (import.meta.main) {
  if (Deno.args.length > 0) {
    const filename = Deno.args[0];
    const source = await Deno.readTextFile(filename);
    const forms = parseHQL(source);
    const env = new Env({}, baseEnv);
    for (const form of forms) {
      await evaluateMacroSafe(form, env);
    }
  } else {
    console.log("Welcome to HQL. Type (exit) or Ctrl+C to quit.");
    await repl(new Env({}, baseEnv));
  }
}
