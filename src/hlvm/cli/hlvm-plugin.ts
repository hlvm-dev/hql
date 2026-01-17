/**
 * HLVM HQL Plugin for Pure REPL
 * Implements the REPLPlugin interface for HQL language support on HLVM
 */

import { transpile } from "../../../mod.ts";
import { parse } from "../../hql/transpiler/pipeline/parser.ts";
import type { ListNode } from "../../hql/transpiler/type/hql_ast.ts";
import { isList, isSymbol, sexpToString, type SList, type SSymbol, type SLiteral } from "../../hql/s-exp/types.ts";
import type { REPLPlugin, REPLContext, EvalResult } from "@hlvm/repl";
import { isVectorImport, isNamespaceImport } from "../../hql/transpiler/syntax/import-export.ts";
import { sanitizeIdentifier } from "../../common/utils.ts";
import { DECLARATION_KEYWORDS, BINDING_KEYWORDS } from "../../hql/transpiler/keyword/primitives.ts";
import { getPlatform } from "../../platform/platform.ts";

// Special form operators (from primitives.ts - single source of truth)
// Typed as Set<string> to allow .has() with any string operand
const DECLARATION_OPS: Set<string> = new Set(DECLARATION_KEYWORDS);
const BINDING_OPS: Set<string> = new Set(BINDING_KEYWORDS);

// Security: Block prototype pollution via reserved property names
const BLOCKED_GLOBAL_NAMES = new Set([
  '__proto__', 'constructor', 'prototype',
  '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__'
]);

/** Validate that a name is safe to use as a globalThis property */
function assertSafeGlobalName(name: string): void {
  if (BLOCKED_GLOBAL_NAMES.has(name)) {
    throw new Error(`Cannot use reserved name "${name}" as import binding`);
  }
}

// Type definitions
export type ExpressionKind = "declaration" | "binding" | "expression" | "import";

export interface ExpressionType {
  readonly kind: ExpressionKind;
  readonly name?: string;
}

// Pre-compiled regex patterns for hot paths (avoid compilation per call)
const USE_STRICT_REGEX = /^['"]use strict['"];\s*/gm;
const SOURCE_MAP_REGEX = /\/\/# sourceMappingURL=.*$/gm;
const TRAILING_SEMI_REGEX = /;\s*$/;
const EXPR_EVERYWHERE_REGEX = /^let\s+[\w,\s]+;\s*\n*\(/;
const EXPR_EVERYWHERE_LET_REGEX = /^let\s+[\w,\s]+;\s*\n*/;
const EXPR_EVERYWHERE_ASSIGN_REGEX = /^\((\w+)\s*=\s*/;
const FUNCTION_CLASS_DECL_REGEX = /^(function|class)\s+\w+/;

/** Clean transpiled JavaScript - remove use strict, source maps, optionally trailing semicolon */
export function cleanJs(js: string, removeSemi = false): string {
  const cleaned = js.replace(USE_STRICT_REGEX, "").replace(SOURCE_MAP_REGEX, "").trim();
  return removeSemi ? cleaned.replace(TRAILING_SEMI_REGEX, "") : cleaned;
}

/** Generate source comment for generated code */
export function makeComment(lineNumber: number, input: string): string {
  const truncated = input.length > 60 ? input.slice(0, 60) + "..." : input;
  return `\n// Line ${lineNumber}: ${truncated}\n`;
}

/** Analyze expression type from AST */
export function analyzeExpression(ast: SList): ExpressionType {
  if (!isList(ast) || ast.elements.length === 0 || !isSymbol(ast.elements[0])) {
    return { kind: "expression" };
  }

  const op = ast.elements[0].name;
  if (op === "import") return { kind: "import" };

  const el = ast.elements[1];
  const name = isSymbol(el) ? el.name : undefined;

  if (DECLARATION_OPS.has(op)) return { kind: "declaration", name };
  if (BINDING_OPS.has(op) && ast.elements.length >= 3) return { kind: "binding", name };
  return { kind: "expression" };
}

/** Wrap code in try/catch export function that returns {success, value/error} */
export function wrapInExportFunction(name: string, code: string, comment: string): string {
  return `${comment}export function ${name}() {
  try {
    const __result = ${code};
    return { success: true, value: __result };
  } catch (__error) {
    return { success: false, error: __error };
  }
}\n`;
}

/** Wrap async code in try/catch export function (auto-returns success) */
export function wrapInAsyncExportFunction(name: string, code: string, comment: string): string {
  return `${comment}export function ${name}() {
  return (async () => {
    try {
      ${code}
      return { success: true, value: undefined };
    } catch (__error) {
      return { success: false, error: __error };
    }
  })();
}\n`;
}

/** Transform expression-everywhere output to globalThis assignment for REPL persistence */
export function transformForGlobalThis(transpiled: string, name: string): string {
  // Expression-everywhere format: let name; (name = value);
  if (EXPR_EVERYWHERE_REGEX.test(transpiled)) {
    return transpiled
      .replace(EXPR_EVERYWHERE_LET_REGEX, '')
      .replace(EXPR_EVERYWHERE_ASSIGN_REGEX, `(globalThis["${name}"] = `);
  }
  // Legacy format: function/class declarations
  return transpiled.replace(FUNCTION_CLASS_DECL_REGEX, `globalThis["${name}"] = $1`);
}

/**
 * HQL Plugin Implementation
 */
export const hlvmPlugin: REPLPlugin = {
  name: "HQL",
  description: "Lisp-like language for modern JavaScript",

  async init(context: REPLContext) {
    const { initializeRuntime } = await import("../../common/runtime-initializer.ts");
    await initializeRuntime();
    context.setState("declaredNames", new Set<string>());
  },

  detect: (code: string) => "(;#".includes(code.trim()[0]) ? 100 : false,

  async evaluate(code: string, context: REPLContext): Promise<EvalResult> {
    const declaredNames = context.getState<Set<string>>("declaredNames") || new Set<string>();
    const ast = parse(code, "<repl>");
    if (ast.length === 0) return { suppressOutput: true };

    const exprType = analyzeExpression(ast[0] as SList);
    const comment = makeComment(context.lineNumber, code);
    const exportName = `__repl_line_${context.lineNumber}`;

    const transpileSource = async (source: string): Promise<string> => {
      const result = await transpile(source, {
        baseDir: getPlatform().process.cwd(),
        currentFile: `<repl>:${context.lineNumber}`,
      });
      return typeof result === "string" ? result : result.code;
    };

    let jsCode: string;

    if (exprType.kind === "import") {
      jsCode = await handleImport(ast[0] as SList, exportName, comment, transpileSource, declaredNames);

    } else if (exprType.kind === "binding" && exprType.name) {
      const valueExpr = (ast[0] as SList).elements[2];
      const jsValue = cleanJs(await transpileSource(sexpToString(valueExpr)), true);
      const initFlag = `__init_${context.lineNumber}`;
      const name = exprType.name;

      jsCode = `${comment}let ${initFlag} = false;
export function ${exportName}() {
  if (${initFlag}) return { success: true, value: globalThis["${name}"] };
  ${initFlag} = true;
  try {
    const __value = ${jsValue};
    globalThis["${name}"] = __value;
    return { success: true, value: __value };
  } catch (__error) {
    return { success: false, error: __error };
  }
}\n`;
      declaredNames.add(name);

    } else if (exprType.kind === "declaration") {
      let transpiled = cleanJs(await transpileSource(code));
      if (exprType.name) {
        transpiled = transformForGlobalThis(transpiled, exprType.name);
        declaredNames.add(exprType.name);
      }
      jsCode = wrapInExportFunction(exportName, transpiled.replace(/;\s*$/, ''), comment);

    } else {
      jsCode = wrapInExportFunction(exportName, cleanJs(await transpileSource(code), true), comment);
    }

    context.setState("declaredNames", declaredNames);
    await context.appendToModule(jsCode);
    const module = await context.reimportModule();
    const exported = module[exportName];

    if (typeof exported === 'function') {
      const result = await exported();
      if (result.success) return { value: result.value };
      throw result.error;
    }
    return { suppressOutput: true };
  },

  commands: {
    ".hql": {
      description: "Force HLVM HQL mode (input next line as HQL)",
      handler(_context: REPLContext) {
        console.log("HLVM HQL mode active - enter HQL expression:");
      }
    }
  }
};

/** Handle import expressions */
async function handleImport(
  list: SList,
  exportName: string,
  comment: string,
  transpileSource: (source: string) => Promise<string>,
  declaredNames: Set<string>
): Promise<string> {
  let dynamicImportCode = "";

  if (isVectorImport(list as unknown as ListNode)) {
    // (import [names] from "path")
    const path = String((list.elements[3] as SLiteral).value);
    const elements = (list.elements[1] as SList).elements;
    const assignments: string[] = [];

    for (let i = 0; i < elements.length; i++) {
      const elem = elements[i] as SSymbol;
      if (elem.name === ",") continue;

      let localName = elem.name;
      // Check for alias: name as alias
      if (i + 2 < elements.length && isSymbol(elements[i + 1]) &&
          (elements[i + 1] as SSymbol).name === "as" && isSymbol(elements[i + 2])) {
        localName = (elements[i + 2] as SSymbol).name;
        i += 2;
      }

      const sanitized = sanitizeIdentifier(localName);
      assertSafeGlobalName(sanitized);  // Security: block prototype pollution
      assignments.push(`globalThis[${JSON.stringify(sanitized)}] = __mod[${JSON.stringify(elem.name)}];`);
      declaredNames.add(sanitized);
    }

    // Security: Use JSON.stringify to prevent code injection via malicious paths
    dynamicImportCode = `const __mod = await import(${JSON.stringify(path)});
      ${assignments.join("\n      ")}`;

  } else if (isNamespaceImport(list as unknown as ListNode)) {
    // (import name from "path")
    const localName = sanitizeIdentifier((list.elements[1] as SSymbol).name);
    assertSafeGlobalName(localName);  // Security: block prototype pollution
    const path = String((list.elements[3] as SLiteral).value);
    // Security: Use JSON.stringify to prevent code injection
    dynamicImportCode = `const __mod = await import(${JSON.stringify(path)}); globalThis[${JSON.stringify(localName)}] = __mod;`;
    declaredNames.add(localName);

  } else if (list.elements.length === 2 && list.elements[1].type === "literal") {
    // (import "path") - side effect only
    const importPath = String((list.elements[1] as SLiteral).value);
    // Security: Use JSON.stringify to prevent code injection
    dynamicImportCode = `await import(${JSON.stringify(importPath)});`;

  } else {
    // Fallback for complex imports
    const match = cleanJs(await transpileSource(sexpToString(list)), true).match(/import\s+['"]([^'"]+)['"]/);
    if (!match) throw new Error("Unsupported import syntax in REPL");
    // Security: Use JSON.stringify to prevent code injection
    dynamicImportCode = `await import(${JSON.stringify(match[1])});`;
  }

  return wrapInAsyncExportFunction(exportName, dynamicImportCode, comment);
}