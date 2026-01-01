/**
 * HQL REPL Evaluator
 * Uses mod.ts APIs which already handle EMBEDDED_PACKAGES resolution
 */

import { run } from "../../../mod.ts";
import { parse } from "../../transpiler/pipeline/parser.ts";
import type { ListNode } from "../../transpiler/type/hql_ast.ts";
import { isList, isSymbol, sexpToString, type SList, type SSymbol } from "../../s-exp/types.ts";
import { isVectorImport, isNamespaceImport } from "../../transpiler/syntax/import-export.ts";
import { sanitizeIdentifier, ensureError } from "../../common/utils.ts";
import { DECLARATION_KEYWORDS, BINDING_KEYWORDS } from "../../transpiler/keyword/primitives.ts";
import type { ReplState } from "./state.ts";

// Declaration and binding keyword sets
const DECLARATION_OPS: Set<string> = new Set(DECLARATION_KEYWORDS);
const BINDING_OPS: Set<string> = new Set(BINDING_KEYWORDS);

export interface EvalResult {
  success: boolean;
  value?: unknown;
  error?: Error;
  suppressOutput?: boolean;
}

type ExpressionKind = "declaration" | "binding" | "expression" | "import";

interface ExpressionType {
  readonly kind: ExpressionKind;
  readonly name?: string;
}

/** Analyze expression type from AST */
function analyzeExpression(ast: SList): ExpressionType {
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

/**
 * Evaluate HQL code in REPL context
 * Uses run() from mod.ts which properly handles EMBEDDED_PACKAGES
 */
export async function evaluate(hqlCode: string, state: ReplState): Promise<EvalResult> {
  const trimmed = hqlCode.trim();
  if (!trimmed) {
    return { success: true, suppressOutput: true };
  }

  try {
    const ast = parse(hqlCode, "<repl>");
    if (ast.length === 0) {
      return { success: true, suppressOutput: true };
    }

    const exprType = analyzeExpression(ast[0] as SList);

    // Handle imports using run() which handles EMBEDDED_PACKAGES
    if (exprType.kind === "import") {
      return await handleImport(ast[0] as SList, state);
    }

    // Handle bindings (let/var) - need to persist to globalThis
    if (exprType.kind === "binding" && exprType.name) {
      return await handleBinding(hqlCode, exprType.name, state);
    }

    // Handle declarations (fn/class) - persist to globalThis
    if (exprType.kind === "declaration" && exprType.name) {
      return await handleDeclaration(hqlCode, exprType.name, state);
    }

    // Regular expression - evaluate and return result
    return await handleExpression(hqlCode, state);
  } catch (error) {
    return {
      success: false,
      error: ensureError(error),
    };
  }
}

/**
 * Handle import statements
 * Uses run() which properly handles EMBEDDED_PACKAGES resolution
 */
async function handleImport(list: SList, state: ReplState): Promise<EvalResult> {
  try {
    const hqlCode = sexpToString(list);
    const names: string[] = [];

    // Extract names being imported for tracking
    if (isVectorImport(list as unknown as ListNode)) {
      // (import [names] from "path") - parsed as (import (vector names) from "path")
      const vectorList = list.elements[1] as SList;
      // Skip the "vector" or "empty-array" keyword at index 0
      const startIdx = (vectorList.elements.length > 0 &&
                       isSymbol(vectorList.elements[0]) &&
                       ["vector", "empty-array"].includes((vectorList.elements[0] as SSymbol).name))
                       ? 1 : 0;

      for (let i = startIdx; i < vectorList.elements.length; i++) {
        const elem = vectorList.elements[i] as SSymbol;
        if (!isSymbol(elem) || elem.name === ",") continue;

        let localName = elem.name;
        // Check for alias: name as alias
        if (i + 2 < vectorList.elements.length && isSymbol(vectorList.elements[i + 1]) &&
            (vectorList.elements[i + 1] as SSymbol).name === "as" && isSymbol(vectorList.elements[i + 2])) {
          localName = (vectorList.elements[i + 2] as SSymbol).name;
          i += 2;
        }
        names.push(sanitizeIdentifier(localName));
      }
    } else if (isNamespaceImport(list as unknown as ListNode)) {
      // (import name from "path")
      names.push(sanitizeIdentifier((list.elements[1] as SSymbol).name));
    }

    // Execute the import via run() - it handles EMBEDDED_PACKAGES
    // The run() function in mod.ts properly compiles @hql/* packages
    await run(hqlCode, {
      baseDir: Deno.cwd(),
      currentFile: "<repl>",
    });

    // Mark names as declared
    for (const name of names) {
      state.addBinding(name);
    }

    return {
      success: true,
      value: names.length > 0 ? `Imported: ${names.join(", ")}` : undefined,
      suppressOutput: names.length === 0,
    };
  } catch (error) {
    return {
      success: false,
      error: ensureError(error),
    };
  }
}

/**
 * Handle binding (let/var) statements
 */
async function handleBinding(hqlCode: string, name: string, state: ReplState): Promise<EvalResult> {
  try {
    // Parse to get the value expression
    const ast = parse(hqlCode, "<repl>");
    const list = ast[0] as SList;
    const valueExpr = sexpToString(list.elements[2]);

    // Wrap in code that assigns to globalThis using js-set
    const wrappedHql = `
      (let __result ${valueExpr})
      (js-set globalThis "${name}" __result)
      __result
    `;

    const result = await run(wrappedHql, {
      baseDir: Deno.cwd(),
      currentFile: "<repl>",
    });

    state.addBinding(name);
    return { success: true, value: result };
  } catch (error) {
    return {
      success: false,
      error: ensureError(error),
    };
  }
}

/**
 * Handle declaration (fn/class) statements
 * Uses run() with globalThis assignment for REPL persistence
 */
async function handleDeclaration(hqlCode: string, name: string, state: ReplState): Promise<EvalResult> {
  try {
    // Run the declaration, then assign to globalThis and return the value
    // Use js-set to assign to globalThis for REPL persistence
    const wrappedHql = `
      ${hqlCode}
      (js-set globalThis "${name}" ${name})
      ${name}
    `;

    const result = await run(wrappedHql, {
      baseDir: Deno.cwd(),
      currentFile: "<repl>",
    });

    state.addBinding(name);
    return { success: true, value: result };
  } catch (error) {
    return {
      success: false,
      error: ensureError(error),
    };
  }
}

/**
 * Handle regular expressions
 */
async function handleExpression(hqlCode: string, _state: ReplState): Promise<EvalResult> {
  try {
    // Use run() directly - it handles everything including EMBEDDED_PACKAGES
    const result = await run(hqlCode, {
      baseDir: Deno.cwd(),
      currentFile: "<repl>",
    });

    return { success: true, value: result };
  } catch (error) {
    return {
      success: false,
      error: ensureError(error),
    };
  }
}
