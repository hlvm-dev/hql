/**
 * HQL Plugin for Pure REPL
 * Implements the REPLPlugin interface for HQL language support
 */

import { transpile } from "../../mod.ts";
import { parse } from "../src/transpiler/pipeline/parser.ts";
import { isList, isSymbol, sexpToString } from "../src/s-exp/types.ts";
import type { SList } from "../src/s-exp/types.ts";
import type { REPLPlugin, REPLContext, EvalResult } from "@hlvm/repl";

// Special form operators
const DECLARATION_OPS = new Set(["fn", "function", "defn", "class"] as const);
const BINDING_OPS = new Set(["let", "var"] as const);

// Type definitions
type ExpressionKind = "declaration" | "binding" | "expression";

interface ExpressionType {
  readonly kind: ExpressionKind;
  readonly name?: string;
}

/**
 * Clean transpiled JavaScript
 */
function cleanJs(js: string, removeTrailingSemicolon = false): string {
  let cleaned = js.replace(/^'use strict';\s*/gm, "").trim();
  if (removeTrailingSemicolon) {
    cleaned = cleaned.replace(/;$/, "");
  }
  return cleaned;
}

/**
 * Generate source comment for generated code
 */
function makeComment(lineNumber: number, input: string): string {
  const truncated = input.length > 60 ? input.slice(0, 60) + "..." : input;
  return `\n// Line ${lineNumber}: ${truncated}\n`;
}

/**
 * Extract function or class name from AST
 */
function extractDeclarationName(ast: SList): string | undefined {
  if (ast.elements.length > 1 && isSymbol(ast.elements[1])) {
    return ast.elements[1].name;
  }
  return undefined;
}

/**
 * Convert declaration to var assignment using AST info
 */
function convertToVarDeclaration(transpiled: string, name: string, isRedefinition: boolean): string {
  const isFunctionDecl = transpiled.startsWith("function ");
  const isClassDecl = transpiled.startsWith("class ");

  if (!isFunctionDecl && !isClassDecl) {
    return transpiled;
  }

  if (isRedefinition) {
    if (isFunctionDecl) {
      return transpiled.replace(/^function\s+\w+/, `${name} = function`);
    } else {
      return transpiled.replace(/^class\s+\w+/, `${name} = class`);
    }
  } else {
    if (isFunctionDecl) {
      return transpiled.replace(/^function\s+\w+/, `var ${name} = function`);
    } else {
      return transpiled.replace(/^class\s+\w+/, `var ${name} = class`);
    }
  }
}

/**
 * Analyze expression type from AST
 */
function analyzeExpression(ast: SList): ExpressionType {
  if (!isList(ast) || ast.elements.length === 0 || !isSymbol(ast.elements[0])) {
    return { kind: "expression" };
  }

  const op = ast.elements[0].name;

  if (DECLARATION_OPS.has(op)) {
    return {
      kind: "declaration",
      name: extractDeclarationName(ast)
    };
  }

  if (BINDING_OPS.has(op) && ast.elements.length >= 3) {
    const name = isSymbol(ast.elements[1]) ? ast.elements[1].name : undefined;
    return { kind: "binding", name };
  }

  return { kind: "expression" };
}

/**
 * HQL Plugin Implementation
 */
export const hqlPlugin: REPLPlugin = {
  name: "HQL",
  description: "Lisp-like language for modern JavaScript",

  async init(context: REPLContext) {
    // Initialize runtime-specific state
    const { initializeRuntime } = await import("../src/common/runtime-initializer.ts");
    await initializeRuntime();
    context.setState("declaredNames", new Set<string>());
  },

  detect(code: string) {
    // HQL is detected if code starts with ( or contains HQL syntax
    const trimmed = code.trim();
    if (trimmed.startsWith("(") || trimmed.startsWith(";") || trimmed.startsWith("#")) {
      return 100; // High priority for HQL syntax
    }
    return false; // Let other plugins handle it
  },

  async evaluate(code: string, context: REPLContext): Promise<EvalResult> {
    const declaredNames = context.getState<Set<string>>("declaredNames") || new Set<string>();

    try {
      const ast = parse(code, "<repl>");
      if (ast.length === 0) {
        return { suppressOutput: true };
      }

      const exprType = analyzeExpression(ast[0] as SList);
      const comment = makeComment(context.lineNumber, code);

      // Transpile helper
      const transpileHql = (source: string) =>
        transpile(source, {
          baseDir: Deno.cwd(),
          currentFile: `<repl>:${context.lineNumber}`,
        });

      // Generate code based on expression type
      let jsCode: string;
      let exportName = `__repl_line_${context.lineNumber}`;
      let callExport = false;

      if (exprType.kind === "binding" && exprType.name) {
        // Variable binding: (let x 10) or (var y 20)
        const isRedefinition = declaredNames.has(exprType.name);
        const valueExpr = (ast[0] as SList).elements[2];
        const valueSource = sexpToString(valueExpr);
        const jsValue = cleanJs(await transpileHql(valueSource), true);

        const initFlagName = `__init_${context.lineNumber}`;
        jsCode = `${comment}${isRedefinition ? '' : 'var ' + exprType.name + ';\n'}let ${initFlagName} = false;
export function ${exportName}() {
  if (${initFlagName}) {
    return { success: true, value: ${exprType.name} };
  }
  ${initFlagName} = true;
  try {
    const __value = ${jsValue};
    ${exprType.name} = __value;
    return { success: true, value: __value };
  } catch (__error) {
    return { success: false, error: __error };
  }
}\n`;

        if (!isRedefinition) declaredNames.add(exprType.name);
        context.setState("declaredNames", declaredNames);
        callExport = true;
      } else if (exprType.kind === "declaration") {
        // Function/class declaration: (fn add [x y] ...) or (class Foo ...)
        const isRedefinition = exprType.name ? declaredNames.has(exprType.name) : false;
        let transpiled = cleanJs(await transpileHql(code));

        if (exprType.name) {
          transpiled = convertToVarDeclaration(transpiled, exprType.name, isRedefinition);
          if (!isRedefinition) {
            declaredNames.add(exprType.name);
            context.setState("declaredNames", declaredNames);
          }
        }

        jsCode = `${comment}${transpiled}\nexport const ${exportName} = undefined;\n`;
      } else {
        // Expression: (+ 1 2), (print "Hello"), etc.
        const transpiled = cleanJs(await transpileHql(code), true);
        jsCode = `${comment}export function ${exportName}() {
  try {
    const __result = ${transpiled};
    return { success: true, value: __result };
  } catch (__error) {
    return { success: false, error: __error };
  }
}\n`;
        callExport = true;
      }

      // Append code to module
      await context.appendToModule(jsCode);

      // Import and execute
      const module = await context.reimportModule();
      const exported = module[exportName];

      if (callExport && typeof exported === 'function') {
        const result = exported();
        if (result.success) {
          return { value: result.value };
        } else {
          throw result.error;
        }
      }

      return { suppressOutput: true };
    } catch (error) {
      throw error;
    }
  },

  commands: {
    ".hql": {
      description: "Force HQL evaluation",
      async handler(context, input) {
        await hqlPlugin.evaluate(input, context);
      }
    }
  }
};
