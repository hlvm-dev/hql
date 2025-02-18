// eval.ts
import {
  HQLValue,
  HQLSymbol,
  HQLList,
  HQLFn,
  HQLMacro,
  makeNil,
  makeNumber,
  makeString,
  makeBoolean,
  makeSymbol,
  HQLEnumCase,
  makeList
} from "./type.ts";
import { Env, baseEnv } from "./env.ts";
import { wrapJsValue } from "./interop.ts";
import { compileHQL } from "./compiler/compiler.ts";
import { join, dirname, relative } from "https://deno.land/std@0.170.0/path/mod.ts";

// ─── CONVERSIONS BETWEEN HQL AND JS ─────────────────────────────

export function hqlToJs(val: HQLValue): any {
  if (!val) return null;
  switch (val.type) {
    case "nil":     return null;
    case "boolean": return val.value;
    case "number":  return val.value;
    case "string":  return val.value;
    case "symbol":
      if (val.name.includes(".")) {
        const parts = val.name.split(".");
        if (parts.length === 2) {
          const [enumName, caseName] = parts;
          const enumVal = baseEnv.get(enumName);
          if (
            enumVal &&
            enumVal.type === "opaque" &&
            enumVal.value &&
            typeof enumVal.value === "object" &&
            (enumVal.value as any).isEnum
          ) {
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
    default:       return val;
  }
}

export function jsToHql(obj: any): HQLValue {
  if (obj === null || obj === undefined) return makeNil();
  if (typeof obj === "boolean") return makeBoolean(obj);
  if (typeof obj === "number") return makeNumber(obj);
  if (typeof obj === "string") return makeString(obj);
  if (Array.isArray(obj)) return makeList(obj.map(jsToHql));
  return { type: "opaque", value: obj };
}

// ─── SHARED EVALUATION HELPERS ───────────────────────────────────

function evaluateAtom(ast: HQLValue, env: Env): HQLValue {
  if (ast.type === "enum-case") return resolveEnumCase(ast, env);
  if (ast.type === "symbol") return resolveSymbol(ast, env);
  if (["number", "string", "boolean", "nil", "list"].includes(ast.type))
    return ast;
  return ast;
}

function resolveSymbol(ast: HQLSymbol, env: Env): HQLValue {
  if (ast.name.includes(".")) {
    const parts = ast.name.split(".");
    if (parts.length === 2) {
      const [enumName, caseName] = parts;
      const enumVal = env.get(enumName);
      if (
        enumVal &&
        enumVal.type === "opaque" &&
        enumVal.value &&
        typeof enumVal.value === "object" &&
        (enumVal.value as any).isEnum
      ) {
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

// ─── SPECIAL FORMS: new, if, function calls, etc. ───────────────

async function handleNewAsync(rest: HQLValue[], env: Env): Promise<HQLValue> {
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

function handleNewSync(rest: HQLValue[], env: Env): HQLValue {
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

async function handleIfAsync(rest: HQLValue[], env: Env): Promise<HQLValue> {
  const cond = await evaluateAsync(rest[0], env);
  return truthy(cond)
    ? (rest[1] ? await evaluateAsync(rest[1], env) : makeNil())
    : (rest[2] ? await evaluateAsync(rest[2], env) : makeNil());
}

function handleIfSync(rest: HQLValue[], env: Env): HQLValue {
  const cond = evaluateSync(rest[0], env);
  return truthy(cond)
    ? (rest[1] ? evaluateSync(rest[1], env) : makeNil())
    : (rest[2] ? evaluateSync(rest[2], env) : makeNil());
}

async function handleFunctionCallAsync(fnVal: HQLFn, rest: HQLValue[], env: Env): Promise<HQLValue> {
  const argVals: HQLValue[] = [];
  for (const r of rest) {
    if (r.type === "symbol" && r.name.endsWith(":")) {
      argVals.push(r);
    } else {
      argVals.push(await evaluateAsync(r, env));
    }
  }
  return await applyFnAsync(fnVal, argVals);
}

function handleFunctionCallSync(fnVal: HQLFn, rest: HQLValue[], env: Env): HQLValue {
  const argVals: HQLValue[] = [];
  for (const r of rest) {
    if (r.type === "symbol" && r.name.endsWith(":")) {
      argVals.push(r);
    } else {
      argVals.push(evaluateSync(r, env));
    }
  }
  return applyFnSync(fnVal, argVals);
}

function truthy(val: HQLValue): boolean {
  return !!val && val.type !== "nil" && (val.type !== "boolean" || !!val.value);
}

// ─── FUNCTION APPLICATION HELPERS ─────────────────────────────

function isLabel(arg: HQLValue): boolean {
  if (arg.type === "symbol") return arg.name.endsWith(":");
  if (arg.type === "string") return (arg.value as string).endsWith(":");
  return false;
}

function processLabeledArgs(fnVal: HQLFn, argVals: HQLValue[]): HQLValue[] {
  const declared = fnVal.params;
  if (
    argVals.length === 1 &&
    argVals[0].type === "opaque" &&
    typeof argVals[0].value === "object" &&
    !Array.isArray(argVals[0].value)
  ) {
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
  if (
    argVals.length > 1 &&
    argVals[0].type === "opaque" &&
    typeof argVals[0].value === "object" &&
    !Array.isArray(argVals[0].value)
  ) {
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

export async function applyFnAsync(fnVal: HQLFn, argVals: HQLValue[]): Promise<HQLValue> {
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

export function applyFnSync(fnVal: HQLFn, argVals: HQLValue[]): HQLValue {
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

// ─── FUNCTION DEFINITION HELPERS ─────────────────────────────

export function parseParamList(paramsAst: HQLValue): { paramNames: string[], typed: boolean } {
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
    return { paramNames: tokens.map((t: any) => t.name), typed: false };
  }
}

export function extractBodyForms(forms: HQLValue[]): HQLValue[] {
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

export function makeFunctionLiteral(parts: HQLValue[], env: Env, isPure: boolean): HQLFn {
  if (parts.length === 0) {
    throw new Error("Function literal expects a parameter list");
  }
  if (parts[0].type === "list" && parts[0].value.length > 0 && parts[0].value[0].type === "list") {
    parts = (parts[0] as HQLList).value.concat(parts.slice(1));
  }
  const paramList = parts[0];
  const { paramNames, typed } = parseParamList(paramList);
  let bodyForms: HQLValue[];
  if (
    parts.length > 1 &&
    parts[1].type === "list" &&
    parts[1].value.length > 0 &&
    parts[1].value[0].type === "symbol" &&
    parts[1].value[0].name === "->"
  ) {
    if (parts[1].value.length === 2) {
      bodyForms = parts.slice(2);
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
    hostFn: undefined,
  };
}

export function makeFunctionLiteralWrapper(parts: HQLValue[], env: Env, isPure: boolean): HQLFn {
  return makeFunctionLiteral(parts, env, isPure);
}

// ─── DEFINITION FORMS ───────────────────────────────────────────

export function handleDefn(formName: string, rest: HQLValue[], env: Env): HQLValue {
  if (rest.length < 2) throw new Error("defn expects a name and a function definition");
  const nameSym = rest[0];
  if (nameSym.type !== "symbol") throw new Error("defn expects a symbol as function name");
  const fnVal = makeFunctionLiteralWrapper(rest.slice(1), env, formName === "defx");
  env.set(nameSym.name, fnVal);
  // Also export the definition.
  if (env.exports) {
    env.exports[nameSym.name] = fnVal;
  }
  return nameSym;
}

export function handleDefinitionForm(
  formName: "def" | "defsync" | "defmacro",
  rest: HQLValue[],
  env: Env,
  evalFn: (ast: HQLValue, env: Env, realPath?: string) => Promise<HQLValue> | HQLValue,
  markSync: boolean,
  realPath?: string
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
      isMacro: true,
    };
    env.set(nameSym.name, macroVal);
    if (env.exports) {
      env.exports[nameSym.name] = macroVal;
    }
    return makeSymbol(nameSym.name);
  }
  const finalize = (v: HQLValue) => {
    if (markSync && v.type === "function") {
      v.isSync = true;
    }
    env.set(nameSym.name, v);
    // Also update the exports map.
    if (env.exports) {
      env.exports[nameSym.name] = v;
    }
    return v;
  };
  const maybePromise = evalFn(valExpr, env, realPath);
  if (maybePromise instanceof Promise) {
    return maybePromise.then(finalize);
  } else {
    return finalize(maybePromise);
  }
}

// ─── MACRO EXPANSION ───────────────────────────────────────────

export async function macroExpand(macro: HQLMacro, rawArgs: HQLValue[], env: Env): Promise<HQLValue> {
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

// ─── EVALUATION FUNCTIONS ──────────────────────────────────────

export async function evaluateAsync(ast: HQLValue, env: Env, realPath?: string): Promise<HQLValue> {
  if (ast.type === "list" && ast.value.length > 0) {
    const [head, ...rest] = ast.value;
    if (head.type === "symbol") {
      switch (head.name) {
        case "new":
          return await handleNewAsync(rest, env);
        case "quote":
          return rest[0] ?? makeNil();
        case "if":
          return await handleIfAsync(rest, env);
        case "def":
        case "defsync":
        case "defmacro":
          return await handleDefinitionForm(
            head.name as "def" | "defsync" | "defmacro",
            rest,
            env,
            evaluateAsync,
            head.name === "defsync",
            realPath
          );
        case "export": {
          if (rest.length !== 2) throw new Error("(export) expects exactly two arguments: string and value");
          const exportNameAst = rest[0];
          if (exportNameAst.type !== "string") throw new Error("(export) expects first argument to be a string");
          const exportValue = await evaluateAsync(rest[1], env, realPath);
          if (!env.exports) env.exports = {};
          env.exports[exportNameAst.value] = exportValue;
          return exportValue;
        }
        case "fn":
        case "fx":
          return makeFunctionLiteralWrapper(rest, env, head.name === "fx");
        case "defn":
        case "defx":
          return handleDefn(head.name, rest, env);
        case "defenum":
          return handleDefenum(rest, env);
        case "import":
          return await handleImportSpecialForm(rest, env, realPath);
      }
    }
    const fnVal = await evaluateAsync(head, env, realPath);
    if (fnVal.type === "function") {
      return await handleFunctionCallAsync(fnVal, rest, env);
    }
    throw new Error(`Attempt to call non-function: ${head.type}`);
  }
  return evaluateAtom(ast, env);
}

export function evaluateSync(ast: HQLValue, env: Env): HQLValue {
  if (ast.type === "list" && ast.value.length > 0) {
    const [head, ...rest] = ast.value;
    if (head.type === "symbol") {
      switch (head.name) {
        case "new":
          return handleNewSync(rest, env);
        case "quote":
          return rest[0] ?? makeNil();
        case "if":
          return handleIfSync(rest, env);
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
          if (exportNameAst.type !== "string") throw new Error("(export) expects first argument to be a string");
          const exportValue = evaluateSync(rest[1], env);
          if (!env.exports) env.exports = {};
          env.exports[exportNameAst.value] = exportValue;
          return exportValue;
        }
        case "fn":
        case "fx":
          return makeFunctionLiteralWrapper(rest, env, head.name === "fx");
        case "defn":
        case "defx":
          return handleDefn(head.name, rest, env);
        case "defenum":
          return handleDefenum(rest, env);
      }
    }
    const fnVal = evaluateSync(head, env);
    if (fnVal.type === "function") {
      return handleFunctionCallSync(fnVal, rest, env);
    }
    throw new Error(`Attempt to call non-function: ${head.type}`);
  }
  return evaluateAtom(ast, env);
}

// ─── SPECIAL FORMS: defenum and import ─────────────────────────

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
    enumObj[caseName] = { type: "opaque", value: Symbol(enumName + "." + caseName) };
  }
  (enumObj as any).isEnum = true;
  Object.freeze(enumObj);
  const enumHQL = wrapJsValue(enumObj);
  env.set(enumName, enumHQL);
  return enumHQL;
}

async function handleImportSpecialForm(rest: HQLValue[], env: Env, realPath?: string): Promise<HQLValue> {
  if (rest.length < 1) throw new Error("(import) expects a URL");
  const urlVal = await evaluateAsync(rest[0], env, realPath);
  if (urlVal.type !== "string") throw new Error("import expects a string URL");
  const callerPath = realPath || (env as any).fileBase;
  const baseUrl = callerPath ? `file://${dirname(callerPath)}/` : `file://${Deno.cwd()}/`;
  return await doImport(urlVal.value, baseUrl);
}

const cdnCandidates = [
  "https://esm.sh/",
  "https://jspm.dev/",
  "https://cdn.skypack.dev/"
];

export async function doImport(url: string, baseUrl?: string): Promise<HQLValue> {
  let modUrl: string;
  if (url.startsWith("npm:")) {
    return await recurImport(url, cdnCandidates);
  }
  try {
    new URL(url);
    modUrl = url;
  } catch (e) {
    modUrl = new URL(url, baseUrl ? baseUrl : `file://${Deno.cwd()}/`).toString();
  }
  if (modUrl.startsWith("file://")) {
    const filePath = modUrl.slice(7);
    if (filePath.endsWith(".hql")) {
      const cacheDir = join(Deno.cwd(), ".hqlcache");
      const relPath = relative(Deno.cwd(), filePath);
      const cacheFile = join(cacheDir, relPath + ".js");
      let needCompile = true;
      try {
        const srcStat = await Deno.stat(filePath);
        const cacheStat = await Deno.stat(cacheFile);
        if (cacheStat.mtime && srcStat.mtime && cacheStat.mtime >= srcStat.mtime) {
          needCompile = false;
        }
      } catch (_e) {
        needCompile = true;
      }
      if (needCompile) {
        const source = await Deno.readTextFile(filePath);
        const compiled = await compileHQL(source, filePath);
        await Deno.mkdir(dirname(cacheFile), { recursive: true });
        await Deno.writeTextFile(cacheFile, compiled);
      }
      modUrl = new URL(cacheFile, `file://${Deno.cwd()}/`).toString();
    }
  } else {
    if (!modUrl.includes("?bundle")) {
      modUrl += "?bundle";
    }
  }
  const modObj = await import(modUrl);
  if (modObj.default?.__hql_module) return modObj.default.__hql_module;
  if (modObj.__hql_module) return modObj.__hql_module;
  return wrapJsValue(modObj.default ?? modObj);
}

async function recurImport(npmUrl: string, cdns: string[]): Promise<HQLValue> {
  if (cdns.length === 0) {
    throw new Error(`All CDN candidates failed for module ${npmUrl}`);
  }
  const candidate = cdns[0];
  const replaced = npmUrl.replace(/^npm:/, candidate);
  try {
    const modObj = await import(replaced);
    if (modObj.default?.__hql_module) return modObj.default.__hql_module;
    if (modObj.__hql_module) return modObj.__hql_module;
    return wrapJsValue(modObj.default ?? modObj);
  } catch (e) {
    return await recurImport(npmUrl, cdns.slice(1));
  }
}

// ─── EXPORTS (helpers) ─────────────────────────────────────────

export function getExport(name: string, targetExports: Record<string, HQLValue>): any {
  if (!Object.prototype.hasOwnProperty.call(targetExports, name)) {
    throw new Error(`HQL export '${name}' not found`);
  }
  return hqlToJs(targetExports[name]);
}
