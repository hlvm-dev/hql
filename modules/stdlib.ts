// stdlib.ts
import { HQLValue, makeNil, makeNumber, makeString, makeSymbol, makeList } from "./type.ts";
import { evaluateSync, evaluateAsync, applyFnSync, doImport, jsToHql, hqlToJs } from "./eval.ts";
import { wrapJsValue } from "./interop.ts";
import { baseEnv } from "./env.ts";

export function formatValue(val: HQLValue): string {
  if (!val) return "nil";
  switch (val.type) {
    case "number":
      return String(val.value);
    case "string":
      return JSON.stringify(val.value);
    case "boolean":
      return val.value ? "true" : "false";
    case "nil":
      return "nil";
    case "symbol":
      return val.name;
    case "list":
      return "(" + val.value.map(formatValue).join(" ") + ")";
    case "function":
      return val.isMacro ? "<macro>" : "<fn>";
    case "opaque": {
      const obj = val.value;
      if (obj instanceof Set) {
        return `Set { ${Array.from(obj).map(x => formatValue(jsToHql(x))).join(", ")} }`;
      } else if (obj instanceof Map) {
        // Updated to avoid nested backticks:
        return `Map { ${Array.from(obj.entries())
          .map(([k, v]) => `${formatValue(jsToHql(k))} => ${formatValue(jsToHql(v))}`)
          .join(", ")} }`;
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
        } catch (e) {
          return String(obj);
        }
      } else {
        return String(obj);
      }
    }
    default:
      return String(val);
  }
}

// Host function wrapper.
function hostFunc(fn: (args: HQLValue[]) => Promise<HQLValue> | HQLValue): HQLValue {
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
      case "+":
        return makeNumber(nums.reduce((acc, x) => acc + x, 0));
      case "*":
        return makeNumber(nums.reduce((acc, x) => acc * x, 1));
      case "-":
        return makeNumber(
          nums.length === 1
            ? -nums[0]
            : nums.slice(1).reduce((acc, x) => acc - x, nums[0])
        );
      case "/":
        return makeNumber(
          nums.length === 1
            ? 1 / nums[0]
            : nums.slice(1).reduce((acc, x) => acc / x, nums[0])
        );
      default:
        return makeNil();
    }
  };
}

export const stdlibs: Record<string, HQLValue> = {
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
      };
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
    return await doImport(urlVal.value);
  })
};

// Register some standard JS constructors in the base environment:
baseEnv.set("Set", wrapJsValue(Set));
baseEnv.set("Array", wrapJsValue(Array));
baseEnv.set("Map", wrapJsValue(Map));
baseEnv.set("Date", wrapJsValue(Date));
baseEnv.set("RegExp", wrapJsValue(RegExp));
baseEnv.set("Error", wrapJsValue(Error));
baseEnv.set("URL", wrapJsValue(URL));

// Provide a convenient "str" alias for "string-append":
baseEnv.set("str", stdlibs["string-append"]);

// Finally, attach all the standard libs:
for (const lib in stdlibs) {
  baseEnv.set(lib, stdlibs[lib]);
}
