/**
 * LSP Signature Help Feature
 *
 * Provides parameter hints when typing function calls.
 * Shows function signature and highlights the current parameter.
 *
 * HQL Syntax Examples:
 *   (fn add [a b] ...)     - function with 2 params
 *   (map (fn [x] ...) arr) - nested function call
 *   (=> (x y) (* x y))     - arrow function
 */

import type {
  SignatureHelp,
  SignatureInformation,
  ParameterInformation,
} from "npm:vscode-languageserver@9.0.1";
import type { TextDocument, Position } from "npm:vscode-languageserver-textdocument@1.0.11";
import type { SymbolTable, SymbolInfo } from "../../src/transpiler/symbol_table.ts";
import { KERNEL_PRIMITIVES } from "../../src/transpiler/keyword/primitives.ts";
import { ADDITIONAL_SPECIAL_FORMS, CONTROL_FLOW_KEYWORDS } from "../../src/common/known-identifiers.ts";

/**
 * Special forms that don't need signature help (derived from single source of truth).
 * These are language constructs, not user-defined functions.
 */
const NO_SIGNATURE_HELP_FORMS = new Set([
  ...KERNEL_PRIMITIVES,
  ...ADDITIONAL_SPECIAL_FORMS,
  ...CONTROL_FLOW_KEYWORDS,
]);

/**
 * Context about the current function call being typed
 */
interface CallContext {
  functionName: string;
  argumentIndex: number;  // 0-based index of current argument
  argumentCount: number;  // Total arguments typed so far
}

/**
 * Get signature help for the current cursor position
 */
export function getSignatureHelp(
  doc: TextDocument,
  position: Position,
  symbols: SymbolTable | null
): SignatureHelp | null {
  if (!symbols) return null;

  const text = doc.getText();
  const offset = doc.offsetAt(position);

  // Find the function call context at cursor
  const callContext = findCallContext(text, offset);
  if (!callContext) return null;

  // Look up the function in symbol table
  const symbol = symbols.get(callContext.functionName);
  if (!symbol) return null;

  // Only show signature help for functions and macros
  if (!["function", "fn", "macro"].includes(symbol.kind)) return null;

  // Build signature information
  const signature = buildSignature(symbol);
  if (!signature) return null;

  return {
    signatures: [signature],
    activeSignature: 0,
    activeParameter: Math.min(
      callContext.argumentIndex,
      (symbol.params?.length ?? 1) - 1
    ),
  };
}

/**
 * Find the function call context at the given offset
 *
 * Scans backwards from cursor to find:
 * 1. The opening paren of the current call
 * 2. The function name after the paren
 * 3. How many arguments have been typed
 */
function findCallContext(text: string, offset: number): CallContext | null {
  let depth = 0;
  let argCount = 0;
  let inString = false;
  let stringChar = "";

  // Scan backwards from cursor
  for (let i = offset - 1; i >= 0; i--) {
    const char = text[i];
    const prevChar = i > 0 ? text[i - 1] : "";

    // Handle string literals
    if ((char === '"' || char === "'") && prevChar !== "\\") {
      if (inString && char === stringChar) {
        inString = false;
      } else if (!inString) {
        inString = true;
        stringChar = char;
      }
      continue;
    }

    if (inString) continue;

    // Track parentheses depth
    if (char === ")") {
      depth++;
    } else if (char === "(") {
      if (depth === 0) {
        // Found the opening paren of current call
        // Now extract the function name
        const funcName = extractFunctionName(text, i + 1);
        if (funcName) {
          return {
            functionName: funcName,
            argumentIndex: argCount,
            argumentCount: argCount + 1,
          };
        }
        return null;
      }
      depth--;
    } else if (depth === 0 && isArgumentSeparator(text, i)) {
      // Count arguments at depth 0 (current call level)
      argCount++;
    }
  }

  return null;
}

/**
 * Check if position is an argument separator (whitespace between args)
 */
function isArgumentSeparator(text: string, pos: number): boolean {
  const char = text[pos];

  // Whitespace is a separator in s-expressions
  if (/\s/.test(char)) {
    // But only if preceded by a non-whitespace (end of an argument)
    // and followed by non-whitespace (start of next argument)
    let hasPrev = false;
    let hasNext = false;

    // Check for previous non-whitespace
    for (let i = pos - 1; i >= 0; i--) {
      if (text[i] === "(") break;
      if (!/\s/.test(text[i])) {
        hasPrev = true;
        break;
      }
    }

    // Check for next non-whitespace (before closing paren or end)
    for (let i = pos + 1; i < text.length; i++) {
      if (text[i] === ")" || text[i] === "(") break;
      if (!/\s/.test(text[i])) {
        hasNext = true;
        break;
      }
    }

    return hasPrev && hasNext;
  }

  return false;
}

/**
 * Extract function name after opening paren
 */
function extractFunctionName(text: string, startPos: number): string | null {
  let name = "";
  let started = false;

  for (let i = startPos; i < text.length; i++) {
    const char = text[i];

    if (/\s/.test(char)) {
      if (started) break;  // End of function name
      continue;  // Skip leading whitespace
    }

    if (char === "(" || char === ")" || char === "[" || char === "]") {
      break;  // End of function name
    }

    started = true;
    name += char;
  }

  // Filter out special forms that don't need signature help
  // Uses single source of truth from primitives.ts and known-identifiers.ts
  if (NO_SIGNATURE_HELP_FORMS.has(name)) {
    return null;
  }

  return name || null;
}

/**
 * Build SignatureInformation from symbol
 */
function buildSignature(symbol: SymbolInfo): SignatureInformation | null {
  if (!symbol.params || symbol.params.length === 0) {
    // No parameters
    return {
      label: `(${symbol.name})`,
      documentation: symbol.documentation,
      parameters: [],
    };
  }

  // Build parameter list
  const paramLabels = symbol.params.map((p) => {
    if (p.type) {
      return `${p.name}: ${p.type}`;
    }
    return p.name;
  });

  const signatureLabel = `(${symbol.name} [${paramLabels.join(" ")}])`;

  const parameters: ParameterInformation[] = symbol.params.map((p) => {
    const label = p.type ? `${p.name}: ${p.type}` : p.name;
    return {
      label,
      documentation: undefined,  // Could add param docs here
    };
  });

  return {
    label: signatureLabel,
    documentation: symbol.documentation,
    parameters,
  };
}

