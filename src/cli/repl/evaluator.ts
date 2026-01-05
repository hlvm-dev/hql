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
import { appendToMemory } from "./memory.ts";

// Constants
const DECLARATION_OPS: Set<string> = new Set(DECLARATION_KEYWORDS);
const BINDING_OPS: Set<string> = new Set(BINDING_KEYWORDS);
const REPL_RUN_OPTIONS = { baseDir: Deno.cwd(), currentFile: "<repl>" } as const;

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
  readonly operator?: string;
}

/** Analyze expression type from AST */
function analyzeExpression(ast: SList): ExpressionType {
  if (!isList(ast) || ast.elements.length === 0 || !isSymbol(ast.elements[0])) {
    return { kind: "expression" };
  }

  const op = ast.elements[0].name;
  if (op === "import") return { kind: "import" };

  // Handle async declarations: (async fn name ...) or (async fn* name ...)
  if (op === "async" && ast.elements.length >= 3) {
    const asyncTarget = ast.elements[1];
    if (asyncTarget && isSymbol(asyncTarget)) {
      const targetName = asyncTarget.name;
      if (targetName === "fn" || targetName === "fn*") {
        // For (async fn name ...) or (async fn* name ...), name is at elements[2]
        const nameEl = ast.elements[2];
        const name = nameEl && isSymbol(nameEl) ? nameEl.name : undefined;
        return { kind: "declaration", name, operator: "async " + targetName };
      }
    }
  }

  const el = ast.elements[1];
  const name = el && isSymbol(el) ? el.name : undefined;

  if (DECLARATION_OPS.has(op)) return { kind: "declaration", name, operator: op };
  if (BINDING_OPS.has(op) && ast.elements.length >= 3) return { kind: "binding", name, operator: op };
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

    const firstExpr = ast[0] as SList;
    const exprType = analyzeExpression(firstExpr);

    // Handle imports using run() which handles EMBEDDED_PACKAGES
    if (exprType.kind === "import") {
      return await handleImport(firstExpr, state);
    }

    // Handle bindings (let/var/def) - need to persist to globalThis
    // Pass AST to avoid re-parsing
    if (exprType.kind === "binding" && exprType.name) {
      return await handleBinding(hqlCode, firstExpr, exprType.name, exprType.operator || "let", state);
    }

    // Handle declarations (fn/defn/class) - persist to globalThis
    if (exprType.kind === "declaration" && exprType.name) {
      // Extract function params for fn/defn/async fn/async fn*
      let params: string[] | undefined;
      const op = exprType.operator || "fn";
      const isAsyncFn = op.startsWith("async ");
      const isFnLike = op === "fn" || op === "defn" || op === "async fn" || op === "async fn*";

      if (isFnLike) {
        // For async declarations: (async fn name [params] ...) - params at index 3
        // For regular: (fn name [params] ...) - params at index 2
        const paramsIndex = isAsyncFn ? 3 : 2;
        const minLength = isAsyncFn ? 4 : 3;

        if (firstExpr.elements.length >= minLength) {
          const paramsNode = firstExpr.elements[paramsIndex];
          if (isList(paramsNode)) {
            params = paramsNode.elements
              .filter((el): el is SSymbol => isSymbol(el) && el.name !== "vector" && el.name !== "empty-array")
              .map(el => el.name);
          }
        }
      }
      return await handleDeclaration(hqlCode, exprType.name, op, state, params);
    }

    // Regular expression - evaluate and return result
    return await handleExpression(hqlCode);
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

    // Execute the import AND persist imported values to globalThis
    // This ensures imported symbols are available in subsequent REPL evaluations
    // Each run() creates an isolated module scope, so we must explicitly persist
    const persistStatements = names.map(name => `(js-set globalThis "${name}" ${name})`).join("\n");
    const wrappedHql = persistStatements
      ? `${hqlCode}\n${persistStatements}`
      : hqlCode;

    await run(wrappedHql, REPL_RUN_OPTIONS);

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
 * Handle binding (let/var/def) statements
 * For "def" operator: also persist evaluated value to memory.hql
 */
async function handleBinding(hqlCode: string, ast: SList, name: string, operator: string, state: ReplState): Promise<EvalResult> {
  try {
    // Extract value expression from already-parsed AST (no re-parsing!)
    const valueExpr = sexpToString(ast.elements[2]);

    // Wrap in code that assigns to globalThis using js-set
    // IMPORTANT: Use sanitized identifier for globalThis key
    const jsName = sanitizeIdentifier(name);
    const wrappedHql = `
      (let __result ${valueExpr})
      (js-set globalThis "${jsName}" __result)
      __result
    `;

    const result = await run(wrappedHql, REPL_RUN_OPTIONS);
    state.addBinding(name);

    // Persist to memory.hql for "def" (not let/var/const)
    // Only if not currently loading from memory (prevents loop)
    if (operator === "def" && !state.isLoadingMemory) {
      try {
        await appendToMemory(name, "def", result);
      } catch {
        // Silently ignore persistence errors - REPL should continue working
      }
    }

    return { success: true, value: result };
  } catch (error) {
    return {
      success: false,
      error: ensureError(error),
    };
  }
}

/**
 * Handle declaration (fn/defn/class) statements
 * Uses run() with globalThis assignment for REPL persistence
 * For "defn" operator: also persist source code to memory.hql
 */
async function handleDeclaration(hqlCode: string, name: string, operator: string, state: ReplState, params?: string[]): Promise<EvalResult> {
  try {
    // Run the declaration, then assign to globalThis and return the value
    // Use js-set to assign to globalThis for REPL persistence
    // IMPORTANT: Use sanitized identifier for globalThis key so that
    // (my-gen) -> my_gen -> globalThis.my_gen works correctly
    const jsName = sanitizeIdentifier(name);
    const wrappedHql = `
      ${hqlCode}
      (js-set globalThis "${jsName}" ${name})
      ${name}
    `;

    const result = await run(wrappedHql, REPL_RUN_OPTIONS);

    // Register binding with params if it's a function
    if (params && params.length > 0) {
      state.addFunction(name, params);
    } else {
      state.addBinding(name);
    }

    // Persist to memory.hql for "defn" ONLY (not fn/function)
    // Only if not currently loading from memory (prevents loop)
    if (operator === "defn" && !state.isLoadingMemory) {
      try {
        // For defn, store the original source code (not the evaluated function)
        await appendToMemory(name, "defn", hqlCode);
      } catch {
        // Silently ignore persistence errors - REPL should continue working
      }
    }

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
async function handleExpression(hqlCode: string): Promise<EvalResult> {
  try {
    const result = await run(hqlCode, REPL_RUN_OPTIONS);
    return { success: true, value: result };
  } catch (error) {
    return { success: false, error: ensureError(error) };
  }
}
