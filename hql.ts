#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net
/**
 * =============================================================================
 * HQL Interpreter – A Lisp-like Interpreter for Deno
 * =============================================================================
 *
 * Overview:
 * ---------
 * This is a full-featured HQL interpreter implemented in TypeScript that runs on Deno.
 * It supports:
 *   - Parsing Lisp syntax (with support for comments using ";")
 *   - Asynchronous evaluation (supporting the special form (await ...))
 *   - Integration with JavaScript/Deno APIs (via built-ins like println, read-file,
 *     fetch, etc.)
 *   - Importing external modules with (import "url")
 *   - Opaque wrapping of non-primitive JS objects to preserve their behavior
 *   - Property access using (get object "propertyName")
 *   - Macros via defmacro for code transformation
 *   - A Read–Eval–Print Loop (REPL) when no script file is provided.
 *
 * =============================================================================
 * Code Structure:
 * =============================================================================
 *
 * 1. AST Definitions & Factory Helpers:
 *    - Defines the various node types (symbols, lists, numbers, strings, booleans,
 *      nil, functions, macros, and opaque values) that form the abstract syntax tree.
 *
 * 2. Tokenizer:
 *    - Splits an input string into tokens, ignoring whitespace and comments (anything
 *      from ";" to the end of the line).
 *
 * 3. Parser:
 *    - Converts the token stream into an AST by recognizing lists, atoms, and literals.
 *
 * 4. Environment:
 *    - Implements lexical scoping using nested environments. An Env maps symbol names
 *      to HQL values.
 *
 * 5. Evaluation:
 *    - Evaluates AST nodes in a given environment.
 *    - Handles special forms including:
 *         • (quote ...)
 *         • (if condition then-form else-form)
 *         • (def symbol value)
 *         • (fn (params) ...body...)
 *         • (defmacro name (params) ...body...)
 *         • (await expr)
 *         • (import "url") – automatically appends "?bundle" when needed.
 *    - Function calls, macro expansion, and asynchronous evaluation are managed here.
 *
 * 6. Standard Library / Built-ins:
 *    - Provides a set of built-in functions that wrap common operations (arithmetic,
 *      file I/O, HTTP fetching, property access, etc.).
 *    - These functions are stored in the base environment.
 *
 * 7. JavaScript Integration:
 *    - Uses conversion functions (hqlToJs and jsToHql) to translate between HQL
 *      values and native JavaScript values.
 *    - Supports direct access to global JS objects via the "js/" prefix.
 *
 * 8. REPL and File Execution:
 *    - If a filename is provided as a command-line argument, the interpreter will read
 *      and execute that file.
 *    - Otherwise, it starts an interactive REPL.
 *
 * =============================================================================
 * Example HQL Code (Usage Examples):
 * =============================================================================
 *
 * --- Simple Expressions ---
 * ; Print a greeting
 * (println "Hello, HQL!")
 *
 * ; Arithmetic operations
 * (println (+ 2 3))           ; prints 5
 * (println (* 4 5))           ; prints 20
 *
 * --- Variables and Functions ---
 * (def x 10)
 * (def add (fn (a b)
 *     (+ a b)))
 * (println (add x 15))        ; prints 25
 *
 * --- Conditionals ---
 * (if true
 *     (println "It is true")
 *     (println "It is false"))
 *
 * --- Asynchronous Operations ---
 * (await (sleep 1000))
 * (println "Slept for 1 second")
 *
 * --- File I/O ---
 * (write-file "test.txt" "HQL file I/O works!")
 * (println (read-file "test.txt"))
 *
 * --- Importing External Modules ---
 * (def chalk (import "https://deno.land/x/chalk_deno@v4.1.1-deno/source/index.js"))
 * (log ((get chalk "blue") "This text is blue"))
 *
 * --- Macros ---
 * (defmacro unless (condition body)
 *     (list 'if (list 'not condition) body))
 * (unless false (println "Printed because condition is false"))
 *
 * --- Higher-Order Functions ---
 * (def apply-twice (fn (f x)
 *     (f (f x))))
 * (def increment (fn (n)
 *     (+ n 1)))
 * (println (apply-twice increment 5))  ; prints 7
 *
 * --- Async Function Example ---
 * (def async-add (fn (a b)
 *     (await (sleep 500))
 *     (+ a b)))
 * (println (async-add 10 15))  ; prints 25 after a delay
 *
 * =============================================================================
 * Running the Interpreter:
 * =============================================================================
 *
 * To run the interpreter with a file:
 *
 *     deno run --allow-read --allow-write --allow-net hql.ts your_script.hql
 *
 * To start the interactive REPL:
 *
 *     deno run --allow-read --allow-write --allow-net hql.ts
 *
 * =============================================================================
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
  name: string;
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
}

export interface HQLMacro {
  type: "function";
  params: string[];
  body: HQLValue[];
  closure: Env;
  isMacro: true;
}

/** Opaque values wrap arbitrary JS objects so that their properties (like toString)
 *  are not accidentally modified by HQL formatting.
 */
export interface HQLOpaque {
  type: "opaque";
  value: any;
}

function makeOpaque(obj: any): HQLOpaque {
  return { type: "opaque", value: obj };
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
// 2. Tokenizer (handles comments starting with ';')
//////////////////////////////////////////////////////////////////////////////

/**
 * Tokenizes the input string into a list of tokens.
 * It skips whitespace, handles parentheses, string literals, and ignores comments.
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];

    // Skip whitespace
    if (/\s/.test(c)) {
      i++;
      continue;
    }

    // Skip comments (from ";" until newline)
    if (c === ";") {
      while (i < input.length && input[i] !== "\n") {
        i++;
      }
      continue;
    }

    // Handle parentheses and square brackets:
    // Treat '(' and '[' as an opening parenthesis.
    // Treat ')' and ']' as a closing parenthesis.
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

    // Handle string literals (enclosed in double quotes)
    if (c === '"') {
      let str = "";
      i++; // Skip the opening quote
      while (i < input.length && input[i] !== '"') {
        str += input[i++];
      }
      i++; // Skip the closing quote
      tokens.push(`"${str}"`);
      continue;
    }

    // Otherwise, read a symbol/number until a delimiter is reached
    let sym = "";
    while (
      i < input.length &&
      !/\s/.test(input[i]) &&
      input[i] !== "(" &&
      input[i] !== ")" &&
      input[i] !== "[" &&
      input[i] !== "]" &&
      input[i] !== ";"
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

/**
 * Recursively converts a token list into an AST (Abstract Syntax Tree).
 */
function readFromTokens(tokens: string[]): HQLValue {
  if (tokens.length === 0) throw new Error("Unexpected EOF");
  const token = tokens.shift()!;
  if (token === "(") {
    const listItems: HQLValue[] = [];
    while (tokens[0] !== ")") {
      if (tokens.length === 0) throw new Error("Missing )");
      listItems.push(readFromTokens(tokens));
    }
    tokens.shift(); // Remove the closing ')'
    return makeList(listItems);
  } else if (token === ")") {
    throw new Error("Unexpected )");
  } else {
    return parseAtom(token);
  }
}

/**
 * Converts an individual token to an HQL atom (number, string, boolean, nil, or symbol).
 */
function parseAtom(token: string): HQLValue {
  // Check if token is a number
  if (/^[+-]?\d+(\.\d+)?$/.test(token)) {
    return makeNumber(parseFloat(token));
  }
  // Check if token is a string literal (enclosed in quotes)
  if (token.startsWith('"') && token.endsWith('"')) {
    return makeString(token.slice(1, -1));
  }
  // Check for booleans or nil
  if (token === "true") return makeBoolean(true);
  if (token === "false") return makeBoolean(false);
  if (token === "nil") return makeNil();
  // Otherwise, treat it as a symbol
  return makeSymbol(token);
}

/**
 * Parses a complete HQL program into a list of AST forms.
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
// 4. Environment
//////////////////////////////////////////////////////////////////////////////

/**
 * Env implements an environment mapping symbols to HQL values.
 * It supports lexical scoping via the "outer" reference.
 */
export class Env {
  bindings: Map<string, HQLValue>;
  outer: Env | null;

  constructor(bindings: Record<string, HQLValue> = {}, outer: Env | null = null) {
    this.bindings = new Map(Object.entries(bindings));
    this.outer = outer;
  }

  // Bind a new symbol to a value in the current environment.
  set(name: string, value: HQLValue) {
    this.bindings.set(name, value);
    return value;
  }

  // Recursively searches for the environment containing a symbol.
  find(name: string): Env | null {
    if (this.bindings.has(name)) {
      return this;
    }
    if (this.outer) {
      return this.outer.find(name);
    }
    return null;
  }

  // Retrieve the value bound to a symbol.
  get(name: string): HQLValue {
    const env = this.find(name);
    if (!env) throw new Error(`Symbol '${name}' not found`);
    return env.bindings.get(name)!;
  }
}

//////////////////////////////////////////////////////////////////////////////
// 5. Evaluation
//////////////////////////////////////////////////////////////////////////////

/**
 * Asynchronously evaluates an AST node within the given environment.
 * Supports special forms like quote, if, def, fn, defmacro, await, and import.
 */
async function evaluate(ast: HQLValue, env: Env): Promise<HQLValue> {
  // If the AST is a Promise, await its resolution.
  if (ast instanceof Promise) {
    return ast;
  }

  // If the AST is a symbol, look it up in the environment.
  if (ast.type === "symbol") {
    // Support access to global JS objects via "js/" prefix.
    if (ast.name.startsWith("js/")) {
      return wrapJsValue(resolveGlobalObject(ast.name.slice(3)));
    }
    return env.get(ast.name);
  }

  // Literals (number, string, boolean, nil) evaluate to themselves.
  if (
    ast.type === "number" ||
    ast.type === "string" ||
    ast.type === "boolean" ||
    ast.type === "nil"
  ) {
    return ast;
  }

  // If the AST is a list, treat it as a function call or special form.
  if (ast.type === "list") {
    const list = ast.value;
    if (list.length === 0) return ast; // Empty list returns itself.
    const head = list[0];

    // Special forms are identified by the head symbol.
    if (head.type === "symbol") {
      switch (head.name) {
        // (quote expr) returns expr without evaluating it.
        case "quote": {
          return list[1] ?? makeNil();
        }
        // (if condition then-form else-form) evaluates condition and selects a branch.
        case "if": {
          const condVal = await evaluate(list[1], env);
          if (truthy(condVal)) {
            return list[2] ? await evaluate(list[2], env) : makeNil();
          } else {
            return list[3] ? await evaluate(list[3], env) : makeNil();
          }
        }
        // (def symbol value) binds a symbol to a value in the current environment.
        case "def": {
          const sym = list[1];
          if (!sym || sym.type !== "symbol") {
            throw new Error("def expects a symbol as first argument");
          }
          const val = list[2] ? await evaluate(list[2], env) : makeNil();
          return env.set(sym.name, val);
        }
        // (fn (params) ...body...) defines an anonymous function (closure).
        case "fn": {
          const paramsAst = list[1];
          if (!paramsAst || paramsAst.type !== "list") {
            throw new Error("fn expects (list of params) ...body...");
          }
          const paramNames = paramsAst.value.map((p) => {
            if (p.type !== "symbol") {
              throw new Error("Function parameters must be symbols");
            }
            return p.name;
          });
          const bodyForms = list.slice(2);
          const fnVal: HQLFn = {
            type: "function",
            params: paramNames,
            body: bodyForms,
            closure: env,
            isMacro: false,
          };
          return fnVal;
        }
        // (defmacro name (params) ...body...) defines a macro.
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
              throw new Error("Macro parameters must be symbols");
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
        // (await expr) awaits an asynchronous expression.
        case "await": {
          const exprVal = await evaluate(list[1], env);
          if (exprVal instanceof Promise) {
            return await exprVal;
          }
          return exprVal;
        }
        // (import "url") imports an external JavaScript module.
        case "import": {
          const urlVal = await evaluate(list[1], env);
          if (urlVal.type !== "string") {
            throw new Error("import expects a string URL");
          }
          const url = urlVal.value;
          let modUrl: string;
          // If the URL starts with "npm:", do not append ?bundle.
          if (url.startsWith("npm:")) {
            modUrl = url;
          } else {
            modUrl = url.includes("?bundle") ? url : url + "?bundle";
          }
          const modObj = await import(modUrl);
          // Some bundled modules (like chalk) may have a default export that lacks the attached properties.
          let modCandidate = modObj.default ?? modObj;
          if (
            typeof modCandidate === "function" &&
            modCandidate.green === undefined &&
            typeof modObj.green !== "undefined"
          ) {
            modCandidate = modObj;
          }
          // Force color if the module supports it.
          if (typeof modCandidate === "function" && "level" in modCandidate) {
            modCandidate.level = 1;
          }
          return wrapJsValue(modCandidate);
        }
        
      }
    }

    // If not a special form, then treat as a function or macro call.
    const fnVal = await evaluate(head, env);
    if (fnVal.type === "function") {
      // Handle macro calls (arguments are passed without evaluation).
      if (fnVal.isMacro) {
        const expanded = await macroExpand(fnVal, list.slice(1), env);
        return await evaluate(expanded, env);
      } else {
        // Evaluate all arguments before calling the function.
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

/**
 * Expands a macro by binding its raw (unevaluated) arguments and evaluating its body.
 */
async function macroExpand(
  macroFn: HQLMacro,
  rawArgs: HQLValue[],
  env: Env,
): Promise<HQLValue> {
  const newEnv = new Env({}, macroFn.closure);
  if (rawArgs.length < macroFn.params.length) {
    throw new Error(`Not enough arguments for macro. Expected ${macroFn.params.length}`);
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

/**
 * Applies a function to evaluated argument values.
 * Supports both host (native JS) functions and user-defined functions.
 */
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

/**
 * Determines the "truthiness" of a value.
 * In HQL, nil and false are false; everything else is true.
 */
function truthy(val: HQLValue): boolean {
  if (val.type === "nil") return false;
  if (val.type === "boolean") return val.value;
  return true;
}

//////////////////////////////////////////////////////////////////////////////
// 6. Standard Library / Built-ins
//////////////////////////////////////////////////////////////////////////////

// Create the base environment in which built-in functions are defined.
const baseEnv = new Env({}, null);

/**
 * hostFunc creates an HQL function that wraps a native JavaScript function.
 * The native function can be asynchronous.
 */
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

/**
 * Utility functions to convert HQL values to native types.
 */
function toNumber(val: HQLValue): number {
  if (val.type === "number") return val.value;
  throw new Error(`Expected number, got: ${formatValue(val)}`);
}

function toString(val: HQLValue): string {
  if (val.type === "string") return val.value;
  return formatValue(val);
}

/**
 * Formats an HQL value as a string for display.
 */
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
    case "opaque": return "<opaque>";
    default: return String(val);
  }
}

/**
 * Converts an HQL value to its corresponding native JavaScript value.
 */
function hqlToJs(val: HQLValue): any {
  if (val.type === "nil") return null;
  if (val.type === "boolean") return val.value;
  if (val.type === "number") return val.value;
  if (val.type === "string") return val.value;
  if (val.type === "list") return val.value.map(hqlToJs);
  if (val.type === "function") {
    if ((val as any).__isWrapped) {
      return val;
    }
    return async (...args: any[]) => {
      const wrapped = args.map(jsToHql);
      return hqlToJs(await applyFn(val, wrapped));
    };
  }
  if (val.type === "opaque") return val.value;
  return val;
}

/**
 * Converts a native JavaScript value to an HQL value.
 */
function jsToHql(obj: any): HQLValue {
  if (obj === null || obj === undefined) return makeNil();
  if (typeof obj === "boolean") return makeBoolean(obj);
  if (typeof obj === "number") return makeNumber(obj);
  if (typeof obj === "string") return makeString(obj);
  if (Array.isArray(obj)) return makeList(obj.map(jsToHql));
  return makeOpaque(obj);
}

/**
 * Wraps a JavaScript function to preserve its properties and make it callable from HQL.
 */
function wrapJsFunction(fn: Function): HQLValue {
  const f = async (...args: any[]): Promise<any> => {
    return await fn(...args);
  };
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

/**
 * Wraps a JavaScript value as an HQL value.
 * Functions are wrapped specially to preserve their behavior.
 */
function wrapJsValue(obj: any): HQLValue {
  if (typeof obj === "function") {
    return wrapJsFunction(obj);
  } else {
    return jsToHql(obj);
  }
}

/**
 * Resolves a global JavaScript object from a dot-separated path (e.g., "Math.max").
 */
function resolveGlobalObject(path: string): any {
  let obj: any = globalThis;
  const parts = path.split(".");
  for (const part of parts) {
    if (part in obj) {
      obj = obj[part];
    } else {
      throw new Error(`Global object not found: ${path}`);
    }
  }
  return obj;
}

/**
 * Define the built-in functions available in HQL.
 */
const builtIns: Record<string, HQLValue> = {
  // (println ...args) pretty-prints values.
  println: hostFunc((args) => {
    console.log(...args.map(formatValue));
    return makeNil();
  }),

  // (log ...args) logs raw JavaScript values.
  log: hostFunc((args) => {
    console.log(...args.map(a => hqlToJs(a)));
    return makeNil();
  }),

  // (+ ...nums) returns the sum of the numbers.
  "+": hostFunc((args) => {
    let sum = 0;
    for (const a of args) {
      sum += toNumber(a);
    }
    return makeNumber(sum);
  }),

  // (* ...nums) returns the product of the numbers.
  "*": hostFunc((args) => {
    let product = 1;
    for (const a of args) {
      product *= toNumber(a);
    }
    return makeNumber(product);
  }),

  // (string-append ...strings) concatenates strings.
  "string-append": hostFunc((args) => {
    const out = args.map(toString).join("");
    return makeString(out);
  }),

  // (list ...args) constructs a list of its arguments.
  "list": hostFunc((args) => {
    return makeList(args);
  }),

  // (read-file "path") reads file content.
  "read-file": hostFunc(async (args) => {
    const pathStr = toString(args[0]);
    const content = await Deno.readTextFile(pathStr);
    return makeString(content);
  }),

  // (write-file "path" "data") writes data to a file.
  "write-file": hostFunc(async (args) => {
    const pathStr = toString(args[0]);
    const dataStr = toString(args[1]);
    await Deno.writeTextFile(pathStr, dataStr);
    return makeNil();
  }),

  // (fetch "url") performs an HTTP fetch and wraps the response.
  fetch: hostFunc(async (args) => {
    const url = toString(args[0]);
    const resp = await fetch(url);
    const respObj = {
      status: resp.status,
      text: async () => jsToHql(await resp.text()),
      json: async () => jsToHql(await resp.json()),
    };
    return wrapJsValue(respObj);
  }),

  // (sleep ms) pauses execution for the given milliseconds.
  sleep: hostFunc(async (args) => {
    const ms = toNumber(args[0]);
    await new Promise((r) => setTimeout(r, ms));
    return makeNil();
  }),

  // (get obj "propertyName") accesses a property on a JavaScript object.
  get: hostFunc((args) => {
    const obj = hqlToJs(args[0]);
    const key = toString(args[1]);
    return wrapJsValue(obj[key]);
  }),
};


// Populate the base environment with the built-in functions.
for (const key in builtIns) {
  baseEnv.set(key, builtIns[key]);
}

//////////////////////////////////////////////////////////////////////////////
// 7. REPL and File Execution (with Multiline Support)
//////////////////////////////////////////////////////////////////////////////

/**
 * A low-level function that reads a single line from standard input.
 */
async function readLine(): Promise<string | null> {
  const buf = new Uint8Array(1024);
  const n = <number>await Deno.stdin.read(buf);
  if (n === null) return null;
  return new TextDecoder().decode(buf.subarray(0, n)).replace(/\r?\n$/, "");
}

/**
 * Helper function that counts parentheses in the input string.
 * It ignores parentheses inside string literals.
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
 * Reads multiple lines until the number of "(" and ")" is balanced.
 * Uses "HQL> " for the primary prompt and "....> " as the continuation prompt.
 */
async function readMultiline(): Promise<string | null> {
  let code = "";
  let parenCount = 0;
  while (true) {
    const prompt = parenCount > 0 ? "....> " : "HQL> ";
    await Deno.stdout.write(new TextEncoder().encode(prompt));
    const line = await readLine();
    if (line === null) {
      // If no input and nothing accumulated, return null.
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
 * Safely evaluates an AST node, handling macro expansion before evaluation.
 */
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

/**
 * Starts the interactive REPL loop using multiline input.
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
        result = await evaluateMacroSafe(form, env);
      }
      if (result instanceof Promise) result = await result;
      console.log(formatValue(result));
    } catch (e) {
      console.error("Error:", e.message);
    }
  }
}

/**
 * Main execution: if a filename is provided, execute the file; otherwise start REPL.
 */
if (import.meta.main) {
  if (Deno.args.length > 0) {
    const filename = Deno.args[0];
    const source = await Deno.readTextFile(filename);
    const forms = parseHQL(source);
    const env = new Env({}, baseEnv);
    let result: HQLValue = makeNil();
    for (const form of forms) {
      result = await evaluateMacroSafe(form, env);
    }
  } else {
    console.log("Welcome to HQL. Type (exit) or Ctrl+C to quit.");
    await repl(new Env({}, baseEnv));
  }
}
