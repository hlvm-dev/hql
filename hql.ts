#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env
/**
 * HQL Interpreter (Production)
 *
 * Features:
 *  - Single–pass parser with minimal allocations.
 *  - Separate async and sync evaluation paths.
 *  - Functions (declared via defn or defx) now support both positional and fully labeled calls.
 *    In a labeled call, label names are ignored and arguments are bound by position.
 *    (Mixed labeled and positional arguments are still rejected.)
 *  - In transpile mode, typed functions are always exported as async.
 *
 * Usage:
 *   deno run --allow-read --allow-write --allow-net --allow-env hql.ts file.hql
 *   deno run --allow-read --allow-write --allow-net --allow-env hql.ts --transpile file.hql
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
  | HQLEnumCase
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
  isPure?: boolean;
  hostFn?: (args: HQLValue[]) => Promise<HQLValue> | HQLValue;
  isSync?: boolean;
  typed?: boolean;
}

export interface HQLMacro {
  type: "function";
  params: string[];
  body: HQLValue[];
  closure: Env;
  isMacro: true;
}

export interface HQLOpaque { type: "opaque"; value: any; }

// NEW: Enum–case AST node (for tokens like .hlvm)
export interface HQLEnumCase { type: "enum-case"; name: string; }

//////////////////////////////////////////////////////////////////////////////
// FACTORIES
//////////////////////////////////////////////////////////////////////////////

function makeSymbol(name: string): HQLSymbol { return { type: "symbol", name }; }
function makeList(value: HQLValue[]): HQLList { return { type: "list", value }; }
function makeNumber(n: number): HQLNumber { return { type: "number", value: n }; }
function makeString(s: string): HQLString { return { type: "string", value: s }; }
function makeBoolean(b: boolean): HQLBoolean { return { type: "boolean", value: b }; }
function makeNil(): HQLNil { return { type: "nil" }; }

// NEW: Factory for enum-case nodes.
function makeEnumCase(name: string): HQLEnumCase { return { type: "enum-case", name }; }

//////////////////////////////////////////////////////////////////////////////
// ENVIRONMENT
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
// PARSER
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
      if (input.charAt(i) === '"') {
        i++;
        break;
      }
      buf += input.charAt(i);
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
    // NEW: if token starts with a dot, it is an enum-case.
    if (raw.startsWith(".")) {
      return makeEnumCase(raw.substring(1));
    }
    if (/^[+-]?\d+(\.\d+)?$/.test(raw)) return makeNumber(parseFloat(raw));
    if (raw === "true") return makeBoolean(true);
    if (raw === "false") return makeBoolean(false);
    if (raw === "nil") return makeNil();
    return makeSymbol(raw);
  }

  function readList(): HQLList {
    i++; // skip opening ( or [
    const items: HQLValue[] = [];
    while (true) {
      skipWs();
      if (i >= len) throw new Error("Missing closing )");
      const ch = input.charAt(i);
      if (ch === ")" || ch === "]") {
        i++;
        break;
      }
      items.push(readForm());
    }
    return makeList(items);
  }

  function readForm(): HQLValue {
    skipWs();
    if (i >= len) {
      throw new Error("Unexpected EOF");
    }
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
// EXPORTS MANAGEMENT
//////////////////////////////////////////////////////////////////////////////

export function getExport(name: string, targetExports: Record<string, HQLValue>): any {
  if (!Object.prototype.hasOwnProperty.call(targetExports, name)) {
    throw new Error(`HQL export '${name}' not found`);
  }
  return hqlToJs(targetExports[name]);
}

//////////////////////////////////////////////////////////////////////////////
// BUILT-IN FUNCTIONS & BASE ENVIRONMENT
//////////////////////////////////////////////////////////////////////////////

export const baseEnv = new Env({}, null);
baseEnv.exports = {};

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
    typed: false,
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
    case "list":
      return "(" + val.value.map(formatValue).join(" ") + ")";
    case "function": return val.isMacro ? "<macro>" : "<fn>";
    case "opaque": {
      const obj = val.value;
      if (obj instanceof Set) {
         return `Set { ${Array.from(obj).map(x => formatValue(jsToHql(x))).join(", ")} }`;
      } else if (obj instanceof Map) {
         return `Map { ${Array.from(obj.entries()).map(([k, v]) => `${formatValue(jsToHql(k))} => ${formatValue(jsToHql(v))}`).join(", ")} }`;
      } else if (obj instanceof Date) {
         return obj.toISOString();
      } else if (obj instanceof RegExp) {
         return obj.toString();
      } else if (obj instanceof Error) {
         return `Error: ${obj.message}`;
      } else if (obj instanceof URL) {
         return obj.toString();
      } else if (Array.isArray(obj)) {
         return `[ ${obj.map(x => formatValue(jsToHql(x))).join(", ")} ]`;
      } else if (typeof obj === "object" && obj !== null) {
         try {
           return JSON.stringify(obj);
         } catch(e) {
           return String(obj);
         }
      } else {
         return String(obj);
      }
    }
    default: return String(val);
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
        return makeNumber(nums.length === 1 ? -nums[0] : nums.slice(1).reduce((acc, x) => acc - x, nums[0]));
      case "/":
        return makeNumber(nums.length === 1 ? 1 / nums[0] : nums.slice(1).reduce((acc, x) => acc / x, nums[0]));
      default: return makeNil();
    }
  };
}

const builtIns: Record<string, HQLValue> = {
  print: hostFunc((args) => {
    console.log(...args.map(a => formatValue(a)));
    return makeNil();
  }),
  log: hostFunc((args) => {
    console.log(...args.map(a => formatValue(a)));
    return makeNil();
  }),
  keyword: hostFunc(([s]) => {
    if (!s || s.type !== "string") throw new Error("(keyword) expects one string");
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
  set: hostFunc(args => wrapJsValue(new Set(args.map(a => hqlToJs(a))))),
  get: hostFunc(([obj, prop]) => {
    const jsObj = (obj && obj.type === "opaque") ? obj.value : hqlToJs(obj);
    const key = (prop && prop.type === "string") ? prop.value : formatValue(prop);
    const val = jsObj?.[key];
    if (typeof val === "function") {
      const n = val.length;
      const paramNames: string[] = [];
      for (let i = 0; i < n; i++) {
        paramNames.push("arg" + i);
      }
      return {
        type: "function",
        params: paramNames,
        body: [],
        closure: baseEnv,
        hostFn: (args: HQLValue[]) => {
          const jsArgs = args.map(hqlToJs);
          const r = val(...jsArgs);
          return r instanceof Promise ? r.then(jsToHql) : jsToHql(r);
        },
        typed: false
      } as HQLFn;
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
  import: hostFunc(async (args) => {
    if (args.length < 1) throw new Error("(import) expects a URL");
    const urlVal = await evaluateAsync(args[0], baseEnv);
    if (urlVal.type !== "string") throw new Error("import expects a string URL");
    const rawUrl = urlVal.value;
    const modUrl = rawUrl.startsWith("npm:")
      ? rawUrl
      : (rawUrl.includes("?bundle") ? rawUrl : rawUrl + "?bundle");
    const modObj = await import(modUrl);
    if (modObj.default?.__hql_module) return modObj.default.__hql_module;
    if (modObj.__hql_module) return modObj.__hql_module;
    return wrapJsValue(modObj.default ?? modObj);
  })
};

for (const k in builtIns) {
  baseEnv.set(k, builtIns[k]);
}

const builtInNameMap = new Map<HQLValue, string>();
for (const [k, v] of Object.entries(builtIns)) {
  builtInNameMap.set(v, k);
}

//////////////////////////////////////////////////////////////////////////////
// CONVERSIONS BETWEEN HQL AND JS
//////////////////////////////////////////////////////////////////////////////

function hqlToJs(val: HQLValue): any {
  if (!val) return null;
  switch (val.type) {
    case "nil":     return null;
    case "boolean": return val.value;
    case "number":  return val.value;
    case "string":  return val.value;
    case "symbol":  // NEW: If a symbol contains a dot, try to resolve it as an enum case.
      if (val.name.includes(".")) {
        const parts = val.name.split(".");
        if (parts.length === 2) {
          const [enumName, caseName] = parts;
          const enumVal = baseEnv.get(enumName);
          if (enumVal && enumVal.type === "opaque" && enumVal.value && typeof enumVal.value === "object" && (enumVal.value as any).isEnum) {
            if (caseName in enumVal.value) {
              return enumVal.value[caseName].value;
            } else {
              throw new Error(`Enum '${enumName}' does not have a case '${caseName}'`);
            }
          }
        }
      }
      return val.name;
    case "list":
      return Array.isArray(val.value) ? val.value.map(hqlToJs) : [];
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
    case "opaque": return val.value;
    default: return val;
  }
}

function jsToHql(obj: any): HQLValue {
  if (obj === null || obj === undefined) return makeNil();
  if (typeof obj === "boolean") return makeBoolean(obj);
  if (typeof obj === "number") return makeNumber(obj);
  if (typeof obj === "string") return makeString(obj);
  if (Array.isArray(obj)) return makeList(obj.map(jsToHql));
  return { type: "opaque", value: obj };
}

//////////////////////////////////////////////////////////////////////////////
// FUNCTION DEFINITION HELPERS
//////////////////////////////////////////////////////////////////////////////

function parseParamList(paramsAst: HQLValue): { paramNames: string[], typed: boolean } {
  if (!paramsAst || paramsAst.type !== "list") {
    throw new Error("Expected a list of parameters");
  }
  const tokens: HQLValue[] = paramsAst.value;
  if (tokens.length === 0) return { paramNames: [], typed: false };
  if (tokens[0].type === "symbol" && tokens[0].name.endsWith(":")) {
    if (tokens.length % 2 !== 0) {
      throw new Error("Typed param list must have pairs of name: type");
    }
    const paramNames: string[] = [];
    for (let i = 0; i < tokens.length; i += 2) {
      const nameToken = tokens[i];
      const typeToken = tokens[i + 1];
      if (nameToken.type !== "symbol" || !nameToken.name.endsWith(":")) {
        throw new Error("Param name must end with ':' in typed param list");
      }
      if (typeToken.type !== "symbol") {
        throw new Error("Typed param must have a symbol type");
      }
      paramNames.push(nameToken.name.slice(0, -1));
    }
    return { paramNames, typed: true };
  } else {
    for (const tok of tokens) {
      if (tok.type !== "symbol") {
        throw new Error("Param must be a symbol for untyped function");
      }
      if (tok.name.endsWith(":")) {
        throw new Error("All parameters must be annotated if any is annotated");
      }
    }
    return { paramNames: tokens.map((t: HQLSymbol) => t.name), typed: false };
  }
}

// NEW: Modified makeFunctionLiteral to allow omitting the return type if it is Void.
function makeFunctionLiteral(parts: HQLValue[], env: Env, isPure: boolean): HQLFn {
  if (parts.length === 0) {
    throw new Error("Function literal expects a parameter list");
  }
  // If the parameters (and optional return type) are wrapped in extra parentheses, flatten one level.
  if (parts[0].type === "list" && parts[0].value.length > 0 && parts[0].value[0].type === "list") {
    parts = (parts[0] as HQLList).value.concat(parts.slice(1));
  }
  const paramList = parts[0];
  const { paramNames, typed } = parseParamList(paramList);
  let bodyForms: HQLValue[];
  // If a return type annotation exists (i.e. a list starting with "->")
  if (parts.length > 1 &&
      parts[1].type === "list" &&
      parts[1].value.length > 0 &&
      parts[1].value[0].type === "symbol" &&
      parts[1].value[0].name === "->") {
    if (parts[1].value.length === 2) {
      const retTypeToken = parts[1].value[1];
      // If the return type is Void, ignore the annotation.
      if (retTypeToken.type === "symbol" && retTypeToken.name === "Void") {
        bodyForms = parts.slice(2);
      } else {
        bodyForms = parts.slice(2);
      }
    } else {
      throw new Error("Invalid return type annotation");
    }
  } else {
    bodyForms = parts.slice(1);
  }
  return {
    type: "function",
    params: paramNames,
    body: extractBodyForms(bodyForms),
    closure: env,
    isMacro: false,
    isPure: isPure,
    typed: typed,
    hostFn: undefined
  };
}

function extractBodyForms(forms: HQLValue[]): HQLValue[] {
  if (
    forms.length > 0 &&
    forms[0].type === "list" &&
    forms[0].value[0]?.type === "symbol" &&
    forms[0].value[0].name === "return"
  ) {
    return forms.slice(1);
  }
  return forms;
}

function makeFunctionLiteralWrapper(parts: HQLValue[], env: Env, isPure: boolean): HQLFn {
  return makeFunctionLiteral(parts, env, isPure);
}

//////////////////////////////////////////////////////////////////////////////
// FUNCTION APPLICATION (SYNC & ASYNC)
//////////////////////////////////////////////////////////////////////////////

function isLabel(arg: HQLValue): boolean {
  if (arg.type === "symbol") return arg.name.endsWith(":");
  if (arg.type === "string") return (arg.value as string).endsWith(":");
  return false;
}

function processLabeledArgs(fnVal: HQLFn, argVals: HQLValue[]): HQLValue[] {
  const declared = fnVal.params;
  
  if (argVals.length === 1 &&
      argVals[0].type === "opaque" &&
      typeof argVals[0].value === "object" &&
      !Array.isArray(argVals[0].value)) {
    const obj = argVals[0].value as Record<string, any>;
    const labelMap: Record<string, HQLValue> = {};
    for (const k in obj) {
      let key = k;
      if (key.endsWith(":")) {
        key = key.slice(0, -1);
      }
      labelMap[key] = jsToHql(obj[k]);
    }
    const out: HQLValue[] = [];
    for (const p of declared) {
      if (!(p in labelMap)) {
        throw new Error(`Missing argument for parameter '${p}'`);
      }
      out.push(labelMap[p]);
    }
    return out;
  }
  
  if (argVals.length > 1 &&
      argVals[0].type === "opaque" &&
      typeof argVals[0].value === "object" &&
      !Array.isArray(argVals[0].value)) {
    throw new Error("Mixed labeled and positional arguments are not allowed");
  }
  
  const hasLabel = argVals.some(isLabel);
  if (hasLabel) {
    if (argVals.length % 2 !== 0) {
      throw new Error("Labeled function call must have an even number of arguments (label-value pairs)");
    }
    const values: HQLValue[] = [];
    for (let i = 0; i < argVals.length; i += 2) {
      const lab = argVals[i];
      if (!isLabel(lab)) {
        throw new Error("Expected label (string or symbol) ending with ':'");
      }
      values.push(argVals[i + 1]);
    }
    if (values.length !== declared.length) {
      throw new Error(`Expected ${declared.length} arguments, but got ${values.length} from labeled call`);
    }
    return values;
  }
  
  if (argVals.length !== declared.length) {
    throw new Error(`Expected ${declared.length} arguments, but got ${argVals.length}`);
  }
  return argVals;
}

async function applyFnAsync(fnVal: HQLFn, argVals: HQLValue[]): Promise<HQLValue> {
  if (fnVal.hostFn) {
    let ret = fnVal.hostFn(argVals);
    if (ret instanceof Promise) ret = await ret;
    return ret;
  }
  argVals = processLabeledArgs(fnVal, argVals);
  if (argVals.length < fnVal.params.length) {
    throw new Error(`Not enough args: got ${argVals.length}, want ${fnVal.params.length}`);
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
    const ret = fnVal.hostFn(argVals);
    if (ret instanceof Promise) throw new Error("Sync function attempted async operation!");
    return ret;
  }
  argVals = processLabeledArgs(fnVal, argVals);
  if (argVals.length < fnVal.params.length) {
    throw new Error(`Not enough args: got ${argVals.length}, want ${fnVal.params.length}`);
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
// NEW: Enum and defenum Support
//////////////////////////////////////////////////////////////////////////////

// Special form: defenum
function handleDefenum(rest: HQLValue[], env: Env): HQLValue {
  if (rest.length < 2) {
    throw new Error("defenum expects at least an enum name and one case");
  }
  const enumNameToken = rest[0];
  if (enumNameToken.type !== "symbol") {
    throw new Error("defenum expects the enum name to be a symbol");
  }
  const enumName = enumNameToken.name;
  const cases = rest.slice(1);
  const enumObj: Record<string, HQLValue> = {};
  for (const c of cases) {
    if (c.type !== "symbol") {
      throw new Error("Enum cases must be symbols");
    }
    const caseName = c.name;
    // Create a unique value for each enum case (using a JS Symbol wrapped in an opaque)
    enumObj[caseName] = { type: "opaque", value: Symbol(enumName + "." + caseName) };
  }
  // Mark this object as an enum and freeze it.
  (enumObj as any).isEnum = true;
  Object.freeze(enumObj);
  const enumHQL = wrapJsValue(enumObj);
  env.set(enumName, enumHQL);
  return enumHQL;
}

// Helper: resolve an enum-case node.
function resolveEnumCase(enumCase: HQLEnumCase, env: Env): HQLValue {
  let result: HQLValue | null = null;
  let currentEnv: Env | null = env;
  while (currentEnv) {
    for (const key in currentEnv.bindings) {
      const binding = currentEnv.bindings[key];
      if (
        binding.type === "opaque" &&
        binding.value &&
        typeof binding.value === "object" &&
        (binding.value as any).isEnum
      ) {
        if (enumCase.name in binding.value) {
          if (result !== null) {
            throw new Error(`Ambiguous enum case '.${enumCase.name}' found in multiple enums`);
          }
          result = binding.value[enumCase.name];
        }
      }
    }
    currentEnv = currentEnv.outer;
  }
  if (result === null) {
    throw new Error(`Enum case '.${enumCase.name}' not found`);
  }
  return result;
}

//////////////////////////////////////////////////////////////////////////////
// EVALUATION: ASYNC & SYNC
//////////////////////////////////////////////////////////////////////////////

export async function evaluateAsync(ast: HQLValue, env: Env): Promise<HQLValue> {
  if (ast.type === "list" && ast.value.length > 0) {
    const [head, ...rest] = ast.value;
    if (head.type === "symbol") {
      switch (head.name) {
        case "new": {
          if (rest.length === 0) throw new Error("(new) expects at least one argument");
          const ctorVal = await evaluateAsync(rest[0], env);
          const jsCtor = hqlToJs(ctorVal);
          const args: any[] = [];
          for (let j = 1; j < rest.length; j++) {
            const argVal = await evaluateAsync(rest[j], env);
            args.push(hqlToJs(argVal));
          }
          if (jsCtor === Set && args.length === 1) {
            args[0] = Array.from(args[0]);
          }
          return wrapJsValue(Reflect.construct(jsCtor, args));
        }
        case "quote":
          return rest[0] ?? makeNil();
        case "if": {
          const cond = await evaluateAsync(rest[0], env);
          return truthy(cond)
            ? rest[1] ? await evaluateAsync(rest[1], env) : makeNil()
            : rest[2] ? await evaluateAsync(rest[2], env) : makeNil();
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
        case "export": {
          if (rest.length !== 2) throw new Error("(export) expects exactly two arguments: string and value");
          const exportNameAst = rest[0];
          if (exportNameAst.type !== "string") {
            throw new Error("(export) expects first argument to be a string");
          }
          const exportValue = await evaluateAsync(rest[1], env);
          if (!env.exports) env.exports = {};
          env.exports[exportNameAst.value] = exportValue;
          return exportValue;
        }
        case "fn":
        case "fx":
          return makeFunctionLiteralWrapper(rest, env, head.name === "fx");
        case "defn":
        case "defx": {
          if (rest.length < 2) throw new Error("defn expects a name and a function definition");
          const nameSym = rest[0];
          if (nameSym.type !== "symbol") throw new Error("defn expects a symbol as function name");
          const fnVal = makeFunctionLiteralWrapper(rest.slice(1), env, head.name === "defx");
          env.set(nameSym.name, fnVal);
          return nameSym;
        }
        case "defenum":
          return handleDefenum(rest, env);
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
    // Function call
    const fnVal = await evaluateAsync(head, env);
    if (fnVal.type === "function") {
      let argVals: HQLValue[] = [];
      for (const r of rest) {
        if (r.type === "symbol" && r.name.endsWith(":")) {
          argVals.push(r);
        } else {
          argVals.push(await evaluateAsync(r, env));
        }
      }
      return await applyFnAsync(fnVal, argVals);
    }
    throw new Error(`Attempt to call non-function: ${head.type}`);
  }
  // NEW: Resolve enum–case nodes
  if (ast.type === "enum-case") {
    return resolveEnumCase(ast, env);
  }
  // NEW: For symbol nodes, support fully qualified enum cases (e.g. Destination.hlvm)
  if (ast.type === "symbol") {
    if (ast.name.includes(".")) {
      const parts = ast.name.split(".");
      if (parts.length === 2) {
        const [enumName, caseName] = parts;
        const enumVal = env.get(enumName);
        if (enumVal && enumVal.type === "opaque" && enumVal.value && typeof enumVal.value === "object" && (enumVal.value as any).isEnum) {
          if (caseName in enumVal.value) {
            return enumVal.value[caseName];
          } else {
            throw new Error(`Enum '${enumName}' does not have a case '${caseName}'`);
          }
        }
      }
    }
    return env.get(ast.name);
  }
  if (["number", "string", "boolean", "nil"].includes(ast.type)) {
    return ast;
  }
  if (ast.type === "list") {
    return ast;
  }
  return ast;
}

export function evaluateSync(ast: HQLValue, env: Env): HQLValue {
  if (ast.type === "list" && ast.value.length > 0) {
    const [head, ...rest] = ast.value;
    if (head.type === "symbol") {
      switch (head.name) {
        case "new": {
          if (rest.length === 0) throw new Error("(new) expects at least one argument");
          const ctorVal = evaluateSync(rest[0], env);
          const jsCtor = hqlToJs(ctorVal);
          const args: any[] = [];
          for (let j = 1; j < rest.length; j++) {
            const argVal = evaluateSync(rest[j], env);
            args.push(hqlToJs(argVal));
          }
          if (jsCtor === Set && args.length === 1) {
            args[0] = Array.from(args[0]);
          }
          return wrapJsValue(Reflect.construct(jsCtor, args));
        }
        case "quote":
          return rest[0] ?? makeNil();
        case "if": {
          const cond = evaluateSync(rest[0], env);
          return truthy(cond)
            ? rest[1] ? evaluateSync(rest[1], env) : makeNil()
            : rest[2] ? evaluateSync(rest[2], env) : makeNil();
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
        case "export": {
          if (rest.length !== 2) throw new Error("(export) expects exactly two arguments: string and value");
          const exportNameAst = rest[0];
          if (exportNameAst.type !== "string") {
            throw new Error("(export) expects first argument to be a string");
          }
          const exportValue = evaluateSync(rest[1], env);
          if (!env.exports) env.exports = {};
          env.exports[exportNameAst.value] = exportValue;
          return exportValue;
        }
        case "fn":
        case "fx":
          return makeFunctionLiteralWrapper(rest, env, head.name === "fx");
        case "defn":
        case "defx": {
          if (rest.length < 2) throw new Error("defn expects a name and a function definition");
          const nameSym = rest[0];
          if (nameSym.type !== "symbol") throw new Error("defn expects a symbol as function name");
          const fnVal = makeFunctionLiteralWrapper(rest.slice(1), env, head.name === "defx");
          env.set(nameSym.name, fnVal);
          return nameSym;
        }
        case "defenum":
          return handleDefenum(rest, env);
      }
    }
    // Function call
    const fnVal = evaluateSync(head, env);
    if (fnVal.type === "function") {
      let argVals: HQLValue[] = [];
      for (const r of rest) {
        if (r.type === "symbol" && r.name.endsWith(":")) {
          argVals.push(r);
        } else {
          argVals.push(evaluateSync(r, env));
        }
      }
      return applyFnSync(fnVal, argVals);
    }
    throw new Error(`Attempt to call non-function: ${head.type}`);
  }
  // NEW: Resolve enum–case nodes
  if (ast.type === "enum-case") {
    return resolveEnumCase(ast, env);
  }
  // NEW: For symbol nodes, support fully qualified enum cases (e.g. Destination.hlvm)
  if (ast.type === "symbol") {
    if (ast.name.includes(".")) {
      const parts = ast.name.split(".");
      if (parts.length === 2) {
        const [enumName, caseName] = parts;
        const enumVal = env.get(enumName);
        if (enumVal && enumVal.type === "opaque" && enumVal.value && typeof enumVal.value === "object" && (enumVal.value as any).isEnum) {
          if (caseName in enumVal.value) {
            return enumVal.value[caseName];
          } else {
            throw new Error(`Enum '${enumName}' does not have a case '${caseName}'`);
          }
        }
      }
    }
    return env.get(ast.name);
  }
  if (["number", "string", "boolean", "nil"].includes(ast.type)) {
    return ast;
  }
  if (ast.type === "list") {
    return ast;
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
    const macroVal: HQLMacro = {
      type: "function",
      params,
      body: rest.slice(2),
      closure: env,
      isMacro: true
    };
    env.set(nameSym.name, macroVal);
    return makeSymbol(nameSym.name);
  }
  const finalize = (v: HQLValue) => {
    if (markSync && v.type === "function") {
      v.isSync = true;
    }
    env.set(nameSym.name, v);
    return v;
  };
  const maybePromise = evalFn(valExpr, env);
  if (maybePromise instanceof Promise) {
    return maybePromise.then(finalize);
  } else {
    return finalize(maybePromise);
  }
}

async function macroExpand(macro: HQLMacro, rawArgs: HQLValue[], env: Env): Promise<HQLValue> {
  if (rawArgs.length < macro.params.length) {
    throw new Error(`Not enough macro arguments: expected ${macro.params.length}`);
  }
  const macroEnv = new Env({}, macro.closure);
  macro.params.forEach((p, i) => macroEnv.set(p, rawArgs[i]));
  let out: HQLValue = makeNil();
  for (const f of macro.body) {
    out = await evaluateAsync(f, macroEnv);
  }
  return out;
}

//////////////////////////////////////////////////////////////////////////////
// RUN & TRANSPILE
//////////////////////////////////////////////////////////////////////////////

export async function runHQLFile(path: string, targetExports?: Record<string, HQLValue>): Promise<Record<string, HQLValue>> {
  const exportsMap = targetExports || {};
  const source = await Deno.readTextFile(path);
  const forms = parseHQL(source);
  const env = new Env({}, baseEnv);
  env.exports = exportsMap;
  for (const f of forms) {
    await evaluateAsync(f, env);
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
  const names = Object.keys(exportsMap);
  if (!outputPath) {
    outputPath = inputPath.endsWith(".hql") ? inputPath + ".js" : inputPath + ".js";
  }
  let code = `import { runHQLFile, getExport } from "./hql.ts";\n\n`;
  code += `const _exports = await runHQLFile("${inputPath}");\n\n`;
  for (const name of names) {
    const val = exportsMap[name];
    const isFn = val?.type === "function";
    if (isFn && val.typed) {
      code += `
export async function ${name}(...args) {
  const fn = getExport("${name}", _exports);
  return await fn(...args);
}
`;
    } else if (isFn) {
      const isSync = val.isSync;
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
  console.log(`Transpiled ${inputPath} -> ${outputPath}. Exports: ${names.join(", ")}`);
}

//////////////////////////////////////////////////////////////////////////////
// CLI & REPL
//////////////////////////////////////////////////////////////////////////////

if (import.meta.main) {
  if (Deno.args[0] === "--transpile") {
    if (Deno.args.length < 2) {
      console.error("Missing HQL file in transpile mode.");
      Deno.exit(1);
    }
    const inputFile = Deno.args[1];
    const outFile = Deno.args[2] || undefined;
    await transpileHQLFile(inputFile, outFile);
  } else if (Deno.args.length > 0) {
    const file = Deno.args[0];
    await runHQLFile(file);
  } else {
    console.log("Welcome to HQL. Type (exit) or Ctrl+C to quit.");
    await repl(new Env({}, baseEnv));
  }
}

async function readLine(): Promise<string | null> {
  const buf = new Uint8Array(1024);
  const n = await Deno.stdin.read(buf);
  if (n === null) return null;
  return new TextDecoder().decode(buf.subarray(0, n)).replace(/\r?\n$/, "");
}

function countParens(input: string): number {
  let c = 0, str = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charAt(i);
    if (ch === '"' && (i === 0 || input.charAt(i - 1) !== "\\")) {
      str = !str;
    }
    if (!str) {
      if (ch === "(") c++;
      else if (ch === ")") c--;
    }
  }
  return c;
}

async function readMultiline(): Promise<string | null> {
  let code = "";
  let pc = 0;
  while (true) {
    const prompt = pc > 0 ? "...> " : "HQL> ";
    await Deno.stdout.write(new TextEncoder().encode(prompt));
    const line = await readLine();
    if (line === null) return code.trim() === "" ? null : code;
    code += line + "\n";
    pc = countParens(code);
    if (pc <= 0) break;
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
      for (const f of forms) {
        result = await evaluateAsync(f, env);
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
