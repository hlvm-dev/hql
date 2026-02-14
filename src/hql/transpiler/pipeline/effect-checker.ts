/**
 * Effect Checker for HQL fx
 *
 * Replaces allowlist-based purity-checker.ts with a constraint-based effect system.
 * Supports higher-order purity (callback params with effect annotations) and
 * call-site soundness checking.
 *
 * Two passes:
 * 1. Body check — each pure:true function's body must contain only pure operations
 * 2. Call-site check — arguments passed to Pure-annotated params must be pure
 */

import * as IR from "../type/hql_ir.ts";
import { forEachNodeInScope, forEachNode } from "../utils/ir-tree-walker.ts";
import { getFnFunction } from "../syntax/function.ts";
import { FIRST_CLASS_OPERATORS } from "../keyword/primitives.ts";
import { ValidationError } from "../../../common/error.ts";

// ═══════════════════════════════════════════════════
// 1. Effect Algebra
// ═══════════════════════════════════════════════════

type Effect = "Pure" | "Impure";

function isSubeffect(actual: Effect, required: Effect): boolean {
  if (required === "Impure") return true;   // Impure accepts anything
  return actual === "Pure";                  // Pure requires Pure
}

// ═══════════════════════════════════════════════════
// 2. Constraint
// ═══════════════════════════════════════════════════

interface EffectConstraint {
  actual: Effect;
  required: Effect;
  node: IR.IRNode;
  message: string;
}

// ═══════════════════════════════════════════════════
// 3. Environment (scope-aware name → Effect)
// ═══════════════════════════════════════════════════

class EffectEnvironment {
  private bindings = new Map<string, Effect>();
  constructor(private parent: EffectEnvironment | null = null) {}

  bind(name: string, effect: Effect): void {
    this.bindings.set(name, effect);
  }

  lookup(name: string): Effect | undefined {
    return this.bindings.get(name) ?? this.parent?.lookup(name);
  }
}

// ═══════════════════════════════════════════════════
// 4. Built-in Signatures (4 ReadonlyMap<string, Effect>)
// ═══════════════════════════════════════════════════

// Merged from purity-checker.ts 9 Sets into 4 Maps

const FUNCTION_EFFECTS: ReadonlyMap<string, Effect> = new Map<string, Effect>([
  // Pure builtins
  ...["map", "filter", "reduce", "first", "rest", "cons", "nth", "count",
    "range", "take", "drop", "flatten", "distinct", "concat", "str",
    "isEmpty", "some", "every", "identity", "comp", "partial", "apply",
    "keys", "vals", "get", "assoc", "dissoc", "merge", "zipmap",
    "list", "vector", "hashMap", "set", "sorted",
    "not", "inc", "dec", "even?", "odd?", "zero?", "pos?", "neg?",
    "min", "max", "abs", "parseInt", "parseFloat",
    "type", "string?", "number?", "boolean?", "nil?", "fn?", "array?", "map?",
    "pr_str",
  ].map((n): [string, Effect] => [n, "Pure"]),
  // Pure internal helpers
  ...["__hql_deepFreeze", "__hql_hash_map", "__hql_get", "__hql_getNumeric",
    "__hql_equal", "__hql_not_equal", "__hql_str", "__hql_type",
    "__hql_identity", "__hql_create_range", "__hql_lazy_map", "__hql_lazy_filter",
    "__hql_lazy_take", "__hql_first", "__hql_rest", "__hql_nth",
    "__hql_assoc", "__hql_dissoc", "__hql_update", "__hql_conj",
    "__hql_into", "__hql_range", "__hql_toSequence", "__hql_toIterable",
    "__hql_match_obj", "__hql_trampoline", "__hql_trampoline_gen",
    "__hql_throw", "__hql_get_op",
  ].map((n): [string, Effect] => [n, "Pure"]),
  // Impure globals
  ...["fetch", "setTimeout", "setInterval", "clearTimeout", "clearInterval",
    "alert", "confirm", "prompt",
    "queueMicrotask", "requestAnimationFrame", "cancelAnimationFrame",
  ].map((n): [string, Effect] => [n, "Impure"]),
]);

const MEMBER_EFFECTS: ReadonlyMap<string, Effect> = new Map<string, Effect>([
  // Pure member calls
  ...["Math.floor", "Math.ceil", "Math.abs", "Math.sqrt", "Math.min", "Math.max",
    "Math.pow", "Math.log", "Math.round", "Math.trunc", "Math.sign",
    "Math.PI", "Math.E",
    "String.fromCharCode", "String.fromCodePoint",
    "Number.isFinite", "Number.isNaN", "Number.isInteger", "Number.isSafeInteger",
    "Number.parseInt", "Number.parseFloat",
    "JSON.stringify", "JSON.parse",
    "Object.keys", "Object.values", "Object.entries", "Object.freeze",
    "Object.fromEntries", "Object.hasOwn",
    "Array.isArray", "Array.from", "Array.of",
  ].map((n): [string, Effect] => [n, "Pure"]),
  // Impure member calls
  ...["console.log", "console.error", "console.warn", "console.info", "console.debug",
    "console.dir", "console.table", "console.trace", "console.time", "console.timeEnd",
    "Math.random", "Date.now", "performance.now",
    "Object.assign",
  ].map((n): [string, Effect] => [n, "Impure"]),
]);

const METHOD_EFFECTS: ReadonlyMap<string, Effect> = new Map<string, Effect>([
  // Pure methods
  ...["slice", "map", "filter", "reduce", "reduceRight",
    "indexOf", "lastIndexOf", "includes", "find", "findIndex", "findLast", "findLastIndex",
    "every", "some", "flat", "flatMap", "concat", "join",
    "toString", "valueOf", "toLocaleString",
    "trim", "trimStart", "trimEnd", "toUpperCase", "toLowerCase",
    "charAt", "charCodeAt", "codePointAt",
    "startsWith", "endsWith", "padStart", "padEnd", "repeat",
    "replace", "replaceAll", "split", "substring", "at", "with",
    "keys", "values", "entries", "has", "get",
    "match", "matchAll", "search", "test",
  ].map((n): [string, Effect] => [n, "Pure"]),
  // Impure methods
  ...["push", "pop", "shift", "unshift", "splice", "sort", "reverse",
    "fill", "copyWithin",
    "set", "delete", "clear", "add",
  ].map((n): [string, Effect] => [n, "Impure"]),
]);

const CONSTRUCTOR_EFFECTS: ReadonlyMap<string, Effect> = new Map<string, Effect>([
  ...["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "URIError",
    "Map", "Set", "Array", "RegExp", "WeakMap", "WeakSet", "URL",
    "Int8Array", "Uint8Array", "Int16Array", "Uint16Array",
    "Int32Array", "Uint32Array", "Float32Array", "Float64Array",
  ].map((n): [string, Effect] => [n, "Pure"]),
  ["Date", "Impure"],
]);

// ═══════════════════════════════════════════════════
// 5. Per-IR Signature Table (per C3)
// ═══════════════════════════════════════════════════

interface FunctionSignature {
  params: { name: string; effectAnnotation?: "Pure" | "Impure" }[];
  pure: boolean;
}

type SignatureTable = Map<string, FunctionSignature>;

function buildSignatureTable(ir: IR.IRProgram): SignatureTable {
  const table: SignatureTable = new Map();

  forEachNode(ir, (node) => {
    if (node.type === IR.IRNodeType.FnFunctionDeclaration) {
      const fn = node as IR.IRFnFunctionDeclaration;
      if (fn.id) {
        table.set(fn.id.name, {
          params: fn.params.map(p => {
            if (p.type === IR.IRNodeType.Identifier) {
              const id = p as IR.IRIdentifier;
              return { name: id.name, effectAnnotation: id.effectAnnotation };
            }
            return { name: "<pattern>" };
          }),
          pure: fn.pure === true,
        });
      }
    } else if (node.type === IR.IRNodeType.FunctionExpression) {
      const fn = node as IR.IRFunctionExpression;
      if (fn.id) {
        table.set(fn.id.name, {
          params: fn.params.map(p => {
            if (p.type === IR.IRNodeType.Identifier) {
              const id = p as IR.IRIdentifier;
              return { name: id.name, effectAnnotation: id.effectAnnotation };
            }
            return { name: "<pattern>" };
          }),
          pure: fn.pure === true,
        });
      }
    }
  });

  return table;
}

function lookupSignature(
  name: string, sigTable: SignatureTable
): FunctionSignature | undefined {
  const local = sigTable.get(name);
  if (local) return local;

  // Fallback: global registry (cross-module / imported names)
  const regEntry = getFnFunction(name) || getFnFunction(name.replace(/_/g, "-"));
  if (regEntry) {
    return {
      params: regEntry.params.map(p => {
        if (p.type === IR.IRNodeType.Identifier) {
          const id = p as IR.IRIdentifier;
          return { name: id.name, effectAnnotation: id.effectAnnotation };
        }
        return { name: "<pattern>" };
      }),
      pure: regEntry.pure === true,
    };
  }
  return undefined;
}

// ═══════════════════════════════════════════════════
// 6. Helpers
// ═══════════════════════════════════════════════════

function identifierName(node: IR.IRNode): string | undefined {
  if (node.type === IR.IRNodeType.Identifier) {
    return (node as IR.IRIdentifier).name;
  }
  return undefined;
}

function memberPath(node: IR.IRNode): string | undefined {
  if (node.type === IR.IRNodeType.MemberExpression) {
    const mem = node as IR.IRMemberExpression;
    const objName = identifierName(mem.object);
    const propName = identifierName(mem.property);
    if (objName && propName) return `${objName}.${propName}`;
  }
  return undefined;
}

function effectError(
  msg: string,
  node: IR.IRNode,
): ValidationError {
  return new ValidationError(
    msg,
    "purity check",
    undefined,
    undefined,
    {
      line: node.position?.line,
      column: node.position?.column,
      filePath: node.position?.filePath,
    },
  );
}

function isCompilerGeneratedFunctionExpression(fnExpr: IR.IRFunctionExpression): boolean {
  if (fnExpr.body.body.length === 0) return false;
  return fnExpr.body.body.every((stmt) =>
    stmt.position?.line === undefined &&
    stmt.position?.column === undefined &&
    stmt.position?.filePath === undefined
  );
}

// ═══════════════════════════════════════════════════
// 7. Callee Effect Resolution
// ═══════════════════════════════════════════════════

function resolveCalleeEffect(
  callee: IR.IRNode, env: EffectEnvironment, sigTable: SignatureTable
): Effect {
  // Direct call by name
  const name = identifierName(callee);
  if (name) {
    // 1. Environment lookup (params, self-recursion)
    const envEffect = env.lookup(name);
    if (envEffect !== undefined) return envEffect;

    // 2. FUNCTION_EFFECTS (builtins, impure globals, internal helpers)
    const builtinEffect = FUNCTION_EFFECTS.get(name);
    if (builtinEffect !== undefined) return builtinEffect;

    // 3. First-class operators → Pure
    if (FIRST_CLASS_OPERATORS.has(name)) return "Pure";

    // 4. Signature table (same-module functions)
    const sig = sigTable.get(name);
    if (sig) return sig.pure ? "Pure" : "Impure";

    // 5. Registry fallback (cross-module)
    const regEntry = getFnFunction(name) || getFnFunction(name.replace(/_/g, "-"));
    if (regEntry) return regEntry.pure ? "Pure" : "Impure";

    // 6. Default → Impure (fail-closed)
    return "Impure";
  }

  // Member call: obj.method
  const path = memberPath(callee);
  if (path) {
    const memberEffect = MEMBER_EFFECTS.get(path);
    if (memberEffect !== undefined) return memberEffect;

    // Check method name alone
    const dotIdx = path.lastIndexOf(".");
    if (dotIdx >= 0) {
      const method = path.slice(dotIdx + 1);
      const methodEffect = METHOD_EFFECTS.get(method);
      if (methodEffect !== undefined) return methodEffect;
    }

    return "Impure"; // unknown member call → fail-closed
  }

  // MemberExpression with only property identifiable → check method
  if (callee.type === IR.IRNodeType.MemberExpression) {
    const mem = callee as IR.IRMemberExpression;
    const propName = identifierName(mem.property);
    if (propName) {
      const methodEffect = METHOD_EFFECTS.get(propName);
      if (methodEffect !== undefined) return methodEffect;
    }
    return "Impure"; // dynamic member call
  }

  // Inline function expression (IIFE)
  if (callee.type === IR.IRNodeType.FunctionExpression) {
    const fnExpr = callee as IR.IRFunctionExpression;
    if (isCompilerGeneratedFunctionExpression(fnExpr)) return "Pure";
    return "Impure";
  }

  return "Impure"; // dynamic call
}

function resolveMemberCallEffect(
  objName: string | undefined, propName: string | undefined,
): Effect {
  if (objName && propName) {
    const fullPath = `${objName}.${propName}`;
    const memberEffect = MEMBER_EFFECTS.get(fullPath);
    if (memberEffect !== undefined) return memberEffect;
    const methodEffect = METHOD_EFFECTS.get(propName);
    if (methodEffect !== undefined) return methodEffect;
    return "Impure";
  }
  if (propName) {
    const methodEffect = METHOD_EFFECTS.get(propName);
    if (methodEffect !== undefined) return methodEffect;
    return "Impure";
  }
  return "Impure";
}

// ═══════════════════════════════════════════════════
// 8. Body Check (constraint gen + solve)
// ═══════════════════════════════════════════════════

function generateBodyConstraints(
  body: IR.IRBlockStatement, env: EffectEnvironment,
  fnName: string, sigTable: SignatureTable
): EffectConstraint[] {
  const constraints: EffectConstraint[] = [];

  forEachNodeInScope(body, (child) => {
    switch (child.type) {
      // Mutation
      case IR.IRNodeType.AssignmentExpression:
        constraints.push({
          actual: "Impure", required: "Pure", node: child,
          message: `Mutation (assignment) is not allowed in pure function '${fnName}'`,
        });
        break;

      // Async I/O
      case IR.IRNodeType.AwaitExpression:
        constraints.push({
          actual: "Impure", required: "Pure", node: child,
          message: `'await' is not allowed in pure function '${fnName}' (async I/O)`,
        });
        break;

      // Generator effects
      case IR.IRNodeType.YieldExpression:
        constraints.push({
          actual: "Impure", required: "Pure", node: child,
          message: `'yield' is not allowed in pure function '${fnName}' (generator effect)`,
        });
        break;

      // Async iteration
      case IR.IRNodeType.ForOfStatement: {
        const forOf = child as IR.IRForOfStatement;
        if (forOf.await) {
          constraints.push({
            actual: "Impure", required: "Pure", node: child,
            message: `'for-await-of' is not allowed in pure function '${fnName}' (async iteration)`,
          });
        }
        break;
      }

      // Function calls
      case IR.IRNodeType.CallExpression: {
        const call = child as IR.IRCallExpression;
        const effect = resolveCalleeEffect(call.callee, env, sigTable);
        if (effect === "Impure") {
          const calleeName = identifierName(call.callee) || memberPath(call.callee) || "<dynamic>";
          constraints.push({
            actual: "Impure", required: "Pure", node: child,
            message: calleeErrorMessage(calleeName, fnName, call.callee),
          });
        }
        break;
      }

      // Optional calls (?.())
      case IR.IRNodeType.OptionalCallExpression: {
        const call = child as IR.IROptionalCallExpression;
        const effect = resolveCalleeEffect(call.callee, env, sigTable);
        if (effect === "Impure") {
          const calleeName = identifierName(call.callee) || memberPath(call.callee) || "<dynamic>";
          constraints.push({
            actual: "Impure", required: "Pure", node: child,
            message: calleeErrorMessage(calleeName, fnName, call.callee),
          });
        }
        break;
      }

      // CallMemberExpression
      case IR.IRNodeType.CallMemberExpression: {
        const callMem = child as IR.IRCallMemberExpression;
        const objName = identifierName(callMem.object);
        const propName = identifierName(callMem.property);
        const effect = resolveMemberCallEffect(objName, propName);
        if (effect === "Impure") {
          const desc = objName && propName
            ? `${objName}.${propName}`
            : propName ? `.${propName}` : "<dynamic>";
          constraints.push({
            actual: "Impure", required: "Pure", node: child,
            message: memberErrorMessage(desc, fnName),
          });
        }
        break;
      }

      // JsMethodAccess: (Math.random), (Date.now), etc.
      case IR.IRNodeType.JsMethodAccess: {
        const access = child as IR.IRJsMethodAccess;
        const objName = identifierName(access.object);

        if (objName) {
          const fullPath = `${objName}.${access.method}`;
          const memberEffect = MEMBER_EFFECTS.get(fullPath);
          if (memberEffect === "Impure") {
            constraints.push({
              actual: "Impure", required: "Pure", node: child,
              message: `'${fullPath}' is not allowed in pure function '${fnName}' (side effect)`,
            });
            break;
          }
        }

        const methodEffect = METHOD_EFFECTS.get(access.method);
        if (methodEffect === "Impure") {
          constraints.push({
            actual: "Impure", required: "Pure", node: child,
            message: `'.${access.method}' is a mutating method and not allowed in pure function '${fnName}'`,
          });
        }
        break;
      }

      // new expressions
      case IR.IRNodeType.NewExpression: {
        const newExpr = child as IR.IRNewExpression;
        const ctorName = identifierName(newExpr.callee);
        if (!ctorName) {
          constraints.push({
            actual: "Impure", required: "Pure", node: child,
            message: `Dynamic constructor call is not allowed in pure function '${fnName}'`,
          });
          break;
        }
        const ctorEffect = CONSTRUCTOR_EFFECTS.get(ctorName);
        if (ctorEffect === "Impure") {
          constraints.push({
            actual: "Impure", required: "Pure", node: child,
            message: `'new ${ctorName}()' is not allowed in pure function '${fnName}' (nondeterministic)`,
          });
        } else if (ctorEffect === undefined) {
          // Unknown constructor → impure
          constraints.push({
            actual: "Impure", required: "Pure", node: child,
            message: `'new ${ctorName}()' is not allowed in pure function '${fnName}'`,
          });
        }
        break;
      }
    }
  });

  return constraints;
}

function calleeErrorMessage(calleeName: string, fnName: string, callee: IR.IRNode): string {
  // Replicate legacy error messages for exact test compatibility
  if (calleeName === "<dynamic>") {
    if (callee.type === IR.IRNodeType.FunctionExpression) {
      return `Direct invocation of inline function expressions is not allowed in pure function '${fnName}'`;
    }
    if (callee.type === IR.IRNodeType.MemberExpression) {
      const mem = callee as IR.IRMemberExpression;
      const propName = identifierName(mem.property);
      if (propName) {
        const methodEffect = METHOD_EFFECTS.get(propName);
        if (methodEffect === "Impure") {
          return `'.${propName}' is a mutating method and not allowed in pure function '${fnName}'`;
        }
        if (methodEffect === undefined) {
          return `Unknown member method '.${propName}' is not allowed in pure function '${fnName}'`;
        }
      }
      return `Dynamic member call is not allowed in pure function '${fnName}'`;
    }
    return `Dynamic function call is not allowed in pure function '${fnName}'`;
  }

  // Check if it's a member path
  if (calleeName.includes(".")) {
    const memberEffect = MEMBER_EFFECTS.get(calleeName);
    if (memberEffect === "Impure") {
      return `'${calleeName}' is not allowed in pure function '${fnName}' (side effect)`;
    }
    return `Unknown member call '${calleeName}' is not allowed in pure function '${fnName}'`;
  }

  // Check impure globals
  if (FUNCTION_EFFECTS.get(calleeName) === "Impure") {
    return `'${calleeName}' is not allowed in pure function '${fnName}' (side effect)`;
  }

  // Check if it's a known fn (impure)
  const sig = getFnFunction(calleeName) || getFnFunction(calleeName.replace(/_/g, "-"));
  if (sig && !sig.pure) {
    return `Cannot call impure function '${calleeName}' from pure function '${fnName}'`;
  }

  return `Cannot call unknown function '${calleeName}' from pure function '${fnName}'`;
}

function memberErrorMessage(desc: string, fnName: string): string {
  if (desc.startsWith(".")) {
    const method = desc.slice(1);
    if (METHOD_EFFECTS.get(method) === "Impure") {
      return `'${desc}' is a mutating method and not allowed in pure function '${fnName}'`;
    }
    return `Unknown member method '${desc}' is not allowed in pure function '${fnName}'`;
  }
  if (MEMBER_EFFECTS.get(desc) === "Impure") {
    return `'${desc}' is not allowed in pure function '${fnName}' (side effect)`;
  }
  return `Unknown member call '${desc}' is not allowed in pure function '${fnName}'`;
}

function solveConstraints(constraints: EffectConstraint[]): void {
  for (const c of constraints) {
    if (!isSubeffect(c.actual, c.required)) {
      throw effectError(c.message, c.node);
    }
  }
}

// ═══════════════════════════════════════════════════
// 9. Call-Site Check (higher-order purity)
// ═══════════════════════════════════════════════════

function checkCallSiteEffects(ir: IR.IRProgram, sigTable: SignatureTable): void {
  forEachNode(ir, (node) => {
    if (node.type !== IR.IRNodeType.CallExpression) return;

    const call = node as IR.IRCallExpression;
    const calleeName = identifierName(call.callee);
    if (!calleeName) return;

    const sig = lookupSignature(calleeName, sigTable);
    if (!sig) return;

    // Check each argument against parameter effect annotations
    for (let i = 0; i < Math.min(call.arguments.length, sig.params.length); i++) {
      const paramEffect = sig.params[i].effectAnnotation;
      if (!paramEffect || paramEffect === "Impure") continue; // no constraint or accepts anything

      // Parameter requires Pure — resolve argument's effect
      const arg = call.arguments[i];
      const argEffect = resolveArgumentEffect(arg, sigTable);

      if (!isSubeffect(argEffect, paramEffect)) {
        throw effectError(
          `Argument '${describeArg(arg)}' is impure but parameter '${sig.params[i].name}' requires a Pure function`,
          arg,
        );
      }
    }
  });
}

function resolveArgumentEffect(arg: IR.IRNode, sigTable: SignatureTable): Effect {
  // FunctionExpression with pure:true → Pure
  if (arg.type === IR.IRNodeType.FunctionExpression) {
    const fn = arg as IR.IRFunctionExpression;
    return fn.pure ? "Pure" : "Impure";
  }

  // Identifier → lookup in sigTable/registry
  if (arg.type === IR.IRNodeType.Identifier) {
    const name = (arg as IR.IRIdentifier).name;
    const sig = sigTable.get(name);
    if (sig) return sig.pure ? "Pure" : "Impure";

    const regEntry = getFnFunction(name) || getFnFunction(name.replace(/_/g, "-"));
    if (regEntry) return regEntry.pure ? "Pure" : "Impure";

    // Unknown identifier → Impure (fail-closed)
    return "Impure";
  }

  // Other expressions (literals, arithmetic) → Pure (they're values, not callables)
  return "Pure";
}

function describeArg(arg: IR.IRNode): string {
  if (arg.type === IR.IRNodeType.Identifier) {
    return (arg as IR.IRIdentifier).name;
  }
  if (arg.type === IR.IRNodeType.FunctionExpression) {
    const fn = arg as IR.IRFunctionExpression;
    return fn.id?.name ?? "<anonymous fn>";
  }
  return "<expression>";
}

// ═══════════════════════════════════════════════════
// 10. Environment Building
// ═══════════════════════════════════════════════════

function buildEnvironmentFromParams(
  params: IR.IRNode[], selfName: string, selfEffect: Effect
): EffectEnvironment {
  const env = new EffectEnvironment();
  env.bind(selfName, selfEffect);

  for (const p of params) {
    if (p.type === IR.IRNodeType.Identifier) {
      const id = p as IR.IRIdentifier;
      const name = id.name.startsWith("...") ? id.name.slice(3) : id.name;
      // If param has effectAnnotation → use it
      // Otherwise → Impure (fail-closed: unknown callables are assumed impure)
      env.bind(name, id.effectAnnotation ?? "Impure");
    }
  }

  return env;
}

// ═══════════════════════════════════════════════════
// 11. Public API
// ═══════════════════════════════════════════════════

export function checkEffects(ir: IR.IRProgram): void {
  const sigTable = buildSignatureTable(ir);

  // Pass 1: Body check — each pure:true function
  forEachNode(ir, (node) => {
    if (node.type === IR.IRNodeType.FnFunctionDeclaration) {
      const fn = node as IR.IRFnFunctionDeclaration;
      if (fn.pure) {
        const name = fn.id?.name ?? "<anonymous>";
        const env = buildEnvironmentFromParams(fn.params, name, "Pure");
        const constraints = generateBodyConstraints(fn.body, env, name, sigTable);
        solveConstraints(constraints);
      }
    } else if (node.type === IR.IRNodeType.FunctionExpression) {
      const fn = node as IR.IRFunctionExpression;
      if (fn.pure) {
        const name = fn.id?.name ?? "<anonymous fx>";
        const env = buildEnvironmentFromParams(fn.params, name, "Pure");
        const constraints = generateBodyConstraints(fn.body, env, name, sigTable);
        solveConstraints(constraints);
      }
    }
  });

  // Pass 2: Call-site check
  checkCallSiteEffects(ir, sigTable);
}
