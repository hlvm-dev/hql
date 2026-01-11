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
import { extractTypeFromSymbol } from "../../transpiler/tokenizer/type-tokenizer.ts";
import type { ReplState } from "./state.ts";
import { appendToMemory } from "./memory.ts";
import { evaluateJS, extractJSBindings } from "./js-eval.ts";
import { addPaste, addAttachment, addConversationTurn } from "./context.ts";
import type { AnyAttachment } from "./attachment-protocol.ts";
import type { TextAttachment, Attachment } from "./attachment.ts";
import { extractDocstrings } from "./docstring.ts";

// Pre-compiled pattern for extracting generic base type
const GENERIC_BASE_TYPE_REGEX = /^([^<]+)/;

// Constants
const DECLARATION_OPS: Set<string> = new Set(DECLARATION_KEYWORDS);
const BINDING_OPS: Set<string> = new Set(BINDING_KEYWORDS);
const REPL_RUN_OPTIONS = {
  baseDir: Deno.cwd(),
  currentFile: "<repl>",
  suppressUnknownNameErrors: true,  // REPL bindings are on globalThis, not known to TypeScript
} as const;

export interface EvalResult {
  success: boolean;
  value?: unknown;
  error?: Error;
  suppressOutput?: boolean;
  /** When true, value is command output text (display as-is, not as quoted string) */
  isCommandOutput?: boolean;
}

type ExpressionKind = "declaration" | "binding" | "expression" | "import";

interface ExpressionType {
  readonly kind: ExpressionKind;
  readonly name?: string;
  readonly operator?: string;
}

/**
 * Extract just the identifier name from a symbol that may include type annotations and/or generics.
 * Examples:
 *   "greet" -> "greet"
 *   "greet:string" -> "greet"
 *   "identity<T>" -> "identity"
 *   "identity<T>:T" -> "identity"
 */
function extractIdentifierName(symbolName: string): string {
  // First remove type annotation (e.g., "greet:string" -> "greet")
  const { name: withoutType } = extractTypeFromSymbol(symbolName);

  // Then remove generic parameters (e.g., "identity<T>" -> "identity")
  const genericMatch = withoutType.match(GENERIC_BASE_TYPE_REGEX);
  return genericMatch ? genericMatch[1] : withoutType;
}

/**
 * Extract function parameters from a fn/defn/async fn declaration
 */
function extractFnParams(expr: SList, operator: string): string[] | undefined {
  const isAsyncFn = operator.startsWith("async ");
  const isFnLike = operator === "fn" || operator === "defn" || operator === "async fn" || operator === "async fn*";

  if (!isFnLike) return undefined;

  const paramsIndex = isAsyncFn ? 3 : 2;
  const minLength = isAsyncFn ? 4 : 3;

  if (expr.elements.length < minLength) return undefined;

  const paramsNode = expr.elements[paramsIndex];
  if (!isList(paramsNode)) return undefined;

  return paramsNode.elements
    .filter((el): el is SSymbol => isSymbol(el) && el.name !== "vector" && el.name !== "empty-array")
    .map(el => el.name);
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
        // Extract just the identifier name, stripping type annotations and generics
        const name = nameEl && isSymbol(nameEl) ? extractIdentifierName(nameEl.name) : undefined;
        return { kind: "declaration", name, operator: "async " + targetName };
      }
    }
  }

  const el = ast.elements[1];
  // Extract just the identifier name, stripping type annotations and generics
  const name = el && isSymbol(el) ? extractIdentifierName(el.name) : undefined;

  if (DECLARATION_OPS.has(op)) return { kind: "declaration", name, operator: op };
  if (BINDING_OPS.has(op) && ast.elements.length >= 3) return { kind: "binding", name, operator: op };
  return { kind: "expression" };
}

/**
 * Evaluate code in REPL context.
 * In jsMode, input not starting with '(' is evaluated as JavaScript.
 * Uses run() from mod.ts which properly handles EMBEDDED_PACKAGES.
 *
 * @param hqlCode - The code to evaluate
 * @param state - REPL state for tracking bindings
 * @param jsMode - Whether to evaluate as JavaScript
 * @param attachments - Optional attachments (pasted text, images, etc.)
 */
export async function evaluate(
  hqlCode: string,
  state: ReplState,
  jsMode: boolean = false,
  attachments?: AnyAttachment[]
): Promise<EvalResult> {
  const trimmed = hqlCode.trim();
  if (!trimmed) {
    return { success: true, suppressOutput: true };
  }

  // Register attachments to context vectors
  if (attachments && attachments.length > 0) {
    for (const att of attachments) {
      if (att.type === "text" && "content" in att) {
        const textAtt = att as TextAttachment;
        addPaste(textAtt.content);
      } else if ("base64Data" in att) {
        const mediaAtt = att as Attachment;
        addAttachment(
          mediaAtt.type,
          mediaAtt.displayName,
          mediaAtt.path,
          mediaAtt.mimeType,
          mediaAtt.size
        );
      }
    }
  }

  // Record user input to conversation
  addConversationTurn("user", trimmed);

  // JavaScript mode: if input doesn't start with '(', evaluate as JavaScript
  if (jsMode && !trimmed.startsWith("(")) {
    try {
      // Extract bindings for state tracking
      const bindings = extractJSBindings(trimmed);

      // Evaluate JavaScript (transforms to persist to globalThis)
      const result = evaluateJS(trimmed);

      // Track bindings in REPL state for autocompletion
      for (const name of bindings) {
        state.addBinding(name);
      }

      return { success: true, value: result };
    } catch (error) {
      return { success: false, error: ensureError(error) };
    }
  }

  // HQL evaluation
  try {
    const ast = parse(trimmed, "<repl>");
    if (ast.length === 0) {
      return { success: true, suppressOutput: true };
    }

    // Extract docstrings from comments and store in state
    const docstrings = extractDocstrings(trimmed);
    if (docstrings.size > 0) {
      state.addDocstrings(docstrings);
    }

    // Handle multiple expressions: build code that evaluates all and returns last
    if (ast.length > 1) {
      // Collect metadata and build transformed code
      const codeParts: string[] = [];
      const bindingNames: Array<{ name: string; operator: string }> = [];
      const declarationNames: Array<{ name: string; operator: string; params?: string[]; source: string }> = [];

      for (const expr of ast as SList[]) {
        const exprType = analyzeExpression(expr);
        const exprCode = sexpToString(expr);

        if (exprType.kind === "import") {
          // Handle imports separately first - they must run before other code
          const importResult = await handleImport(expr, state);
          if (!importResult.success) return importResult;
        } else if (exprType.kind === "binding" && exprType.name) {
          // Convert def/let/var to let and persist to globalThis
          const valueExpr = expr.elements.length >= 3 ? sexpToString(expr.elements[2]) : "nil";
          const jsName = sanitizeIdentifier(exprType.name);
          codeParts.push(`(let ${jsName} ${valueExpr})`);
          codeParts.push(`(js-set globalThis "${jsName}" ${jsName})`);
          bindingNames.push({ name: exprType.name, operator: exprType.operator || "let" });
        } else if (exprType.kind === "declaration" && exprType.name) {
          const op = exprType.operator || "fn";
          const params = extractFnParams(expr, op);
          const jsName = sanitizeIdentifier(exprType.name);
          codeParts.push(exprCode);
          codeParts.push(`(js-set globalThis "${jsName}" ${jsName})`);
          declarationNames.push({ name: exprType.name, operator: op, params, source: exprCode });
        } else {
          // Regular expression - just add it
          codeParts.push(exprCode);
        }
      }

      const wrappedCode = codeParts.join("\n");

      try {
        const result = await run(wrappedCode, REPL_RUN_OPTIONS);

        // Register all bindings with the state
        for (const { name, operator } of bindingNames) {
          state.addBinding(name);
          // Persist def bindings to memory
          if (operator === "def" && !state.isLoadingMemory) {
            try {
              // Get the actual value from globalThis for memory persistence
              const value = (globalThis as Record<string, unknown>)[sanitizeIdentifier(name)];
              await appendToMemory(name, "def", value, state.getDocstring(name));
            } catch { /* ignore persistence errors */ }
          }
        }
        for (const { name, operator, params, source } of declarationNames) {
          if (params) {
            state.addFunction(name, params);
          } else {
            state.addBinding(name);
          }
          // Persist defn declarations to memory
          if (operator === "defn" && !state.isLoadingMemory) {
            try {
              await appendToMemory(name, "defn", source, state.getDocstring(name));
            } catch { /* ignore */ }
          }
        }

        return { success: true, value: result };
      } catch (error) {
        return { success: false, error: ensureError(error) };
      }
    }

    // Single expression handling (unchanged)
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
      const op = exprType.operator || "fn";
      const params = extractFnParams(firstExpr, op);
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
async function handleBinding(_hqlCode: string, ast: SList, name: string, operator: string, state: ReplState): Promise<EvalResult> {
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
        await appendToMemory(name, "def", result, state.getDocstring(name));
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
        // state.getDocstring() is the single source of truth - appendToMemory strips any inline comments
        await appendToMemory(name, "defn", hqlCode, state.getDocstring(name));
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
