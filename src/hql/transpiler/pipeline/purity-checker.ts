/**
 * Purity Checker for HQL fx
 *
 * Validates that pure functions (fx) contain no side effects.
 * Called during semantic validation after IR generation.
 * Uses forEachNodeInScope from ir-tree-walker to walk the function body
 * without crossing into nested fn boundaries.
 */

import * as IR from "../type/hql_ir.ts";
import { forEachNodeInScope } from "../utils/ir-tree-walker.ts";
import { getFnFunction } from "../syntax/function.ts";
import { FIRST_CLASS_OPERATORS } from "../keyword/primitives.ts";
import { ValidationError } from "../../../common/error.ts";

// Known pure HQL stdlib/builtin functions
const PURE_BUILTIN_FUNCTIONS = new Set([
  "map", "filter", "reduce", "first", "rest", "cons", "nth", "count",
  "range", "take", "drop", "flatten", "distinct", "concat", "str",
  "isEmpty", "some", "every", "identity", "comp", "partial", "apply",
  "keys", "vals", "get", "assoc", "dissoc", "merge", "zipmap",
  "list", "vector", "hashMap", "set", "sorted",
  "not", "inc", "dec", "even?", "odd?", "zero?", "pos?", "neg?",
  "min", "max", "abs", "parseInt", "parseFloat",
  "type", "string?", "number?", "boolean?", "nil?", "fn?", "array?", "map?",
  "pr_str",
]);

// Static member calls known to be pure: "Object.method"
const PURE_MEMBER_CALLS = new Set([
  "Math.floor", "Math.ceil", "Math.abs", "Math.sqrt", "Math.min", "Math.max",
  "Math.pow", "Math.log", "Math.round", "Math.trunc", "Math.sign",
  "Math.PI", "Math.E",
  "String.fromCharCode", "String.fromCodePoint",
  "Number.isFinite", "Number.isNaN", "Number.isInteger", "Number.isSafeInteger",
  "Number.parseInt", "Number.parseFloat",
  "JSON.stringify", "JSON.parse",
  "Object.keys", "Object.values", "Object.entries", "Object.freeze",
  "Object.fromEntries", "Object.hasOwn",
  "Array.isArray", "Array.from", "Array.of",
]);

// Static member calls known to be impure
const IMPURE_MEMBER_CALLS = new Set([
  "console.log", "console.error", "console.warn", "console.info", "console.debug",
  "console.dir", "console.table", "console.trace", "console.time", "console.timeEnd",
  "Math.random",
  "Date.now",
  "performance.now",
  "Object.assign",
]);

// Instance methods known to be pure (non-mutating)
const PURE_METHODS = new Set([
  "slice", "map", "filter", "reduce", "reduceRight",
  "indexOf", "lastIndexOf", "includes", "find", "findIndex", "findLast", "findLastIndex",
  "every", "some", "flat", "flatMap", "concat", "join",
  "toString", "valueOf", "toLocaleString",
  "trim", "trimStart", "trimEnd", "toUpperCase", "toLowerCase",
  "charAt", "charCodeAt", "codePointAt",
  "startsWith", "endsWith", "padStart", "padEnd", "repeat",
  "replace", "replaceAll", "split", "substring", "at", "with",
  "keys", "values", "entries", "has", "get",
  "match", "matchAll", "search", "test",
]);

// Instance methods known to be impure (mutating)
const IMPURE_METHODS = new Set([
  "push", "pop", "shift", "unshift", "splice", "sort", "reverse",
  "fill", "copyWithin",
  "set", "delete", "clear", "add",
]);

// Constructors known to produce pure values (no I/O, deterministic)
const PURE_CONSTRUCTORS = new Set([
  "Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "URIError",
  "Map", "Set", "Array", "RegExp", "WeakMap", "WeakSet", "URL",
  "Int8Array", "Uint8Array", "Int16Array", "Uint16Array",
  "Int32Array", "Uint32Array", "Float32Array", "Float64Array",
]);

// Known impure global functions
const IMPURE_GLOBALS = new Set([
  "fetch", "setTimeout", "setInterval", "clearTimeout", "clearInterval",
  "alert", "confirm", "prompt",
  "queueMicrotask", "requestAnimationFrame", "cancelAnimationFrame",
]);

// Compiler/runtime helpers that are safe in fx.
// These are injected during lowering and are not user-level side effects.
const PURE_INTERNAL_HELPERS = new Set([
  "__hql_deepFreeze",
  "__hql_hash_map",
  "__hql_get",
  "__hql_getNumeric",
  "__hql_equal",
  "__hql_not_equal",
  "__hql_str",
  "__hql_type",
  "__hql_identity",
  "__hql_create_range",
  "__hql_lazy_map",
  "__hql_lazy_filter",
  "__hql_lazy_take",
  "__hql_first",
  "__hql_rest",
  "__hql_nth",
  "__hql_assoc",
  "__hql_dissoc",
  "__hql_update",
  "__hql_conj",
  "__hql_into",
  "__hql_range",
  "__hql_toSequence",
  "__hql_toIterable",
  "__hql_match_obj",
  "__hql_trampoline",
  "__hql_trampoline_gen",
  "__hql_throw",
  "__hql_get_op",
]);

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

function purityError(
  msg: string,
  fnName: string,
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

/**
 * Validate that a pure function (fx) body contains no side effects.
 * Throws ValidationError if impure operations are found.
 */
export function validatePurity(
  node: IR.IRFnFunctionDeclaration | IR.IRFunctionExpression,
  name: string,
): void {
  const selfName = name;

  // Walk every node in the function body (stops at nested fn boundaries)
  forEachNodeInScope(node.body, (child) => {
    switch (child.type) {
      // Mutation
      case IR.IRNodeType.AssignmentExpression:
        throw purityError(
          `Mutation (assignment) is not allowed in pure function '${name}'`,
          name,
          child,
        );

      // Async I/O
      case IR.IRNodeType.AwaitExpression:
        throw purityError(
          `'await' is not allowed in pure function '${name}' (async I/O)`,
          name,
          child,
        );

      // Generator effects
      case IR.IRNodeType.YieldExpression:
        throw purityError(
          `'yield' is not allowed in pure function '${name}' (generator effect)`,
          name,
          child,
        );

      // Async iteration
      case IR.IRNodeType.ForOfStatement: {
        const forOf = child as IR.IRForOfStatement;
        if (forOf.await) {
          throw purityError(
            `'for-await-of' is not allowed in pure function '${name}' (async iteration)`,
            name,
            child,
          );
        }
        break;
      }

      // Function calls (both direct and member calls)
      case IR.IRNodeType.CallExpression: {
        const call = child as IR.IRCallExpression;
        validateCallCallee(call.callee, name, selfName, child);
        break;
      }

      // Optional calls (?.()) follow the same purity rules
      case IR.IRNodeType.OptionalCallExpression: {
        const call = child as IR.IROptionalCallExpression;
        validateCallCallee(call.callee, name, selfName, child);
        break;
      }

      // CallMemberExpression (alternative IR form for member calls)
      case IR.IRNodeType.CallMemberExpression: {
        const callMem = child as IR.IRCallMemberExpression;
        const objName = identifierName(callMem.object);
        const propName = identifierName(callMem.property);

        if (objName && propName) {
          validateMemberCall(`${objName}.${propName}`, name, child);
          break;
        } else if (propName) {
          if (IMPURE_METHODS.has(propName)) {
            throw purityError(
              `'.${propName}' is a mutating method and not allowed in pure function '${name}'`,
              name,
              child,
            );
          }
          if (PURE_METHODS.has(propName)) {
            break;
          }
          throw purityError(
            `Unknown member method '.${propName}' is not allowed in pure function '${name}'`,
            name,
            child,
          );
        }
        throw purityError(
          `Dynamic member call is not allowed in pure function '${name}'`,
          name,
          child,
        );
      }

      // JsMethodAccess: (Math.random), (Date.now), etc.
      case IR.IRNodeType.JsMethodAccess: {
        const access = child as IR.IRJsMethodAccess;
        const objName = identifierName(access.object);
        if (objName) {
          const fullPath = `${objName}.${access.method}`;
          if (IMPURE_MEMBER_CALLS.has(fullPath)) {
            throw purityError(
              `'${fullPath}' is not allowed in pure function '${name}' (side effect)`,
              name,
              child,
            );
          }
        }
        if (IMPURE_METHODS.has(access.method)) {
          throw purityError(
            `'.${access.method}' is a mutating method and not allowed in pure function '${name}'`,
            name,
            child,
          );
        }
        break;
      }

      // new expressions
      case IR.IRNodeType.NewExpression: {
        const newExpr = child as IR.IRNewExpression;
        const ctorName = identifierName(newExpr.callee);
        if (!ctorName) {
          throw purityError(
            `Dynamic constructor call is not allowed in pure function '${name}'`,
            name,
            child,
          );
        }
        if (ctorName === "Date") {
          throw purityError(
            `'new Date()' is not allowed in pure function '${name}' (nondeterministic)`,
            name,
            child,
          );
        }
        if (PURE_CONSTRUCTORS.has(ctorName)) {
          break;
        }
        throw purityError(
          `'new ${ctorName}()' is not allowed in pure function '${name}'`,
          name,
          child,
        );
        break;
      }
    }
  });
}

function validateCallCallee(
  callee: IR.IRNode,
  fnName: string,
  selfName: string,
  node: IR.IRNode,
): void {
  const calleeName = identifierName(callee);
  if (calleeName) {
    validateCallee(calleeName, fnName, selfName, node);
    return;
  }

  const path = memberPath(callee);
  if (path) {
    validateMemberCall(path, fnName, node);
    return;
  }

  if (callee.type === IR.IRNodeType.MemberExpression) {
    const mem = callee as IR.IRMemberExpression;
    const propName = identifierName(mem.property);
    if (propName) {
      if (IMPURE_METHODS.has(propName)) {
        throw purityError(
          `'.${propName}' is a mutating method and not allowed in pure function '${fnName}'`,
          fnName,
          node,
        );
      }
      if (PURE_METHODS.has(propName)) {
        return;
      }
      throw purityError(
        `Unknown member method '.${propName}' is not allowed in pure function '${fnName}'`,
        fnName,
        node,
      );
    }
    throw purityError(
      `Dynamic member call is not allowed in pure function '${fnName}'`,
      fnName,
      node,
    );
  }

  if (callee.type === IR.IRNodeType.FunctionExpression) {
    const fnExpr = callee as IR.IRFunctionExpression;
    // Allow compiler-generated IIFEs (e.g., loop/recur lowering), but block
    // user-authored inline invocation which can hide impure operations.
    if (isCompilerGeneratedFunctionExpression(fnExpr)) {
      return;
    }
    throw purityError(
      `Direct invocation of inline function expressions is not allowed in pure function '${fnName}'`,
      fnName,
      node,
    );
  }

  throw purityError(
    `Dynamic function call is not allowed in pure function '${fnName}'`,
    fnName,
    node,
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

function validateMemberCall(
  fullPath: string,
  fnName: string,
  node: IR.IRNode,
): void {
  // Known impure static calls
  if (IMPURE_MEMBER_CALLS.has(fullPath)) {
    throw purityError(
      `'${fullPath}' is not allowed in pure function '${fnName}' (side effect)`,
      fnName,
      node,
    );
  }
  // Known pure static calls
  if (PURE_MEMBER_CALLS.has(fullPath)) return;

  // Check if the property part is an impure instance method
  const dotIdx = fullPath.lastIndexOf(".");
  if (dotIdx >= 0) {
    const method = fullPath.slice(dotIdx + 1);
    if (IMPURE_METHODS.has(method)) {
      throw purityError(
        `'.${method}' is a mutating method and not allowed in pure function '${fnName}'`,
        fnName,
        node,
      );
    }
    if (PURE_METHODS.has(method)) return;
  }
  throw purityError(
    `Unknown member call '${fullPath}' is not allowed in pure function '${fnName}'`,
    fnName,
    node,
  );
}

function validateCallee(
  calleeName: string,
  fnName: string,
  selfName: string,
  node: IR.IRNode,
): void {
  // Self-recursion is always allowed
  if (calleeName === selfName) return;

  // Pure builtin functions
  if (PURE_BUILTIN_FUNCTIONS.has(calleeName)) return;

  // First-class operators (+, -, *, /, etc.)
  if (FIRST_CLASS_OPERATORS.has(calleeName)) return;

  // Internal runtime helpers generated by the compiler
  if (PURE_INTERNAL_HELPERS.has(calleeName)) return;

  // Known impure globals
  if (IMPURE_GLOBALS.has(calleeName)) {
    throw purityError(
      `'${calleeName}' is not allowed in pure function '${fnName}' (side effect)`,
      fnName,
      node,
    );
  }

  // Check if it's another registered fn function
  // Registry uses original names (with hyphens), but IR uses sanitized names (with underscores)
  const target = getFnFunction(calleeName) || getFnFunction(calleeName.replace(/_/g, "-"));
  if (target) {
    if (target.pure) return; // Another fx — allowed
    throw purityError(
      `Cannot call impure function '${calleeName}' from pure function '${fnName}'`,
      fnName,
      node,
    );
  }

  throw purityError(
    `Cannot call unknown function '${calleeName}' from pure function '${fnName}'`,
    fnName,
    node,
  );
}
