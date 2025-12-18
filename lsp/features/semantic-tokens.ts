/**
 * LSP Semantic Tokens Feature
 *
 * Provides semantic highlighting for HQL code.
 * This enables richer syntax highlighting based on semantic analysis.
 *
 * Token Types:
 * - namespace: Module namespaces
 * - type: Type names (classes)
 * - class: Class definitions
 * - enum: Enum definitions
 * - interface: Interface definitions (future)
 * - struct: Struct definitions (future)
 * - parameter: Function/macro parameters
 * - variable: Variables (let/var/const bindings)
 * - property: Object properties
 * - enumMember: Enum cases
 * - function: Function definitions and calls
 * - macro: Macro definitions and invocations
 * - keyword: Language keywords (fn, let, if, etc.)
 * - comment: Comments
 * - string: String literals
 * - number: Numeric literals
 * - operator: Operators
 */

import {
  SemanticTokensBuilder,
  SemanticTokenTypes,
  SemanticTokenModifiers,
} from "npm:vscode-languageserver@9.0.1";
import type { SemanticTokensLegend } from "npm:vscode-languageserver@9.0.1";
import type { TextDocument } from "npm:vscode-languageserver-textdocument@1.0.11";
import type { SymbolTable } from "../../src/transpiler/symbol_table.ts";
import { KERNEL_PRIMITIVES } from "../../src/transpiler/keyword/primitives.ts";
import {
  ADDITIONAL_SPECIAL_FORMS,
  CONTROL_FLOW_KEYWORDS,
  BUILTIN_FUNCTION_NAMES,
} from "../../src/common/known-identifiers.ts";

/**
 * Token types we support (indexes into tokenTypes array)
 */
const TOKEN_TYPES = [
  SemanticTokenTypes.namespace,
  SemanticTokenTypes.type,
  SemanticTokenTypes.class,
  SemanticTokenTypes.enum,
  SemanticTokenTypes.parameter,
  SemanticTokenTypes.variable,
  SemanticTokenTypes.property,
  SemanticTokenTypes.enumMember,
  SemanticTokenTypes.function,
  SemanticTokenTypes.macro,
  SemanticTokenTypes.keyword,
  SemanticTokenTypes.comment,
  SemanticTokenTypes.string,
  SemanticTokenTypes.number,
  SemanticTokenTypes.operator,
];

/**
 * Token modifiers we support (bit flags)
 */
const TOKEN_MODIFIERS = [
  SemanticTokenModifiers.declaration,
  SemanticTokenModifiers.definition,
  SemanticTokenModifiers.readonly,
  SemanticTokenModifiers.defaultLibrary,
];

/**
 * Get the semantic tokens legend (token types and modifiers)
 */
export function getSemanticTokensLegend(): SemanticTokensLegend {
  return {
    tokenTypes: TOKEN_TYPES,
    tokenModifiers: TOKEN_MODIFIERS,
  };
}

/**
 * Get token type index
 */
function getTokenTypeIndex(type: string): number {
  const index = TOKEN_TYPES.indexOf(type as (typeof TOKEN_TYPES)[number]);
  return index >= 0 ? index : 0;
}

/**
 * Get token modifier bit flags
 */
function getModifierFlags(modifiers: string[]): number {
  let flags = 0;
  for (const mod of modifiers) {
    const index = TOKEN_MODIFIERS.indexOf(mod as (typeof TOKEN_MODIFIERS)[number]);
    if (index >= 0) {
      flags |= (1 << index);
    }
  }
  return flags;
}

/**
 * Build semantic tokens for a document
 */
export function buildSemanticTokens(
  doc: TextDocument,
  symbols: SymbolTable | null
): number[] {
  const builder = new SemanticTokensBuilder();
  const text = doc.getText();
  const lines = text.split("\n");

  // Build a set of known keywords
  const keywords = new Set([
    ...KERNEL_PRIMITIVES,
    ...ADDITIONAL_SPECIAL_FORMS,
    ...CONTROL_FLOW_KEYWORDS,
  ]);

  const builtins = new Set<string>(BUILTIN_FUNCTION_NAMES);

  // Track function/macro parameters from current scope
  const currentParams = new Set<string>();

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    let i = 0;

    while (i < line.length) {
      // Skip whitespace
      if (/\s/.test(line[i])) {
        i++;
        continue;
      }

      // Comment: ; to end of line
      if (line[i] === ";") {
        builder.push(
          lineIndex,
          i,
          line.length - i,
          getTokenTypeIndex(SemanticTokenTypes.comment),
          0
        );
        break; // Rest of line is comment
      }

      // String: "..." or `...`
      if (line[i] === '"' || line[i] === "`") {
        const quote = line[i];
        const start = i;
        i++; // Skip opening quote
        while (i < line.length) {
          if (line[i] === "\\") {
            i += 2; // Skip escape sequence
          } else if (line[i] === quote) {
            i++; // Skip closing quote
            break;
          } else {
            i++;
          }
        }
        builder.push(
          lineIndex,
          start,
          i - start,
          getTokenTypeIndex(SemanticTokenTypes.string),
          0
        );
        continue;
      }

      // Number: digits, optionally with . and e/E
      if (/\d/.test(line[i]) || (line[i] === "-" && /\d/.test(line[i + 1]))) {
        const start = i;
        if (line[i] === "-") i++;
        while (i < line.length && /[\d.eE\-+xXa-fA-F]/.test(line[i])) {
          i++;
        }
        // Make sure it's actually a number (not just a minus)
        if (i > start + (line[start] === "-" ? 1 : 0)) {
          builder.push(
            lineIndex,
            start,
            i - start,
            getTokenTypeIndex(SemanticTokenTypes.number),
            0
          );
          continue;
        }
      }

      // Keywords/special characters
      if (line[i] === "(" || line[i] === ")" || line[i] === "[" || line[i] === "]" ||
          line[i] === "{" || line[i] === "}") {
        i++;
        continue;
      }

      // Operator characters (single char operators)
      if ("+-*/%<>=!&|^~".includes(line[i]) && !isIdentifierChar(line[i + 1])) {
        builder.push(
          lineIndex,
          i,
          1,
          getTokenTypeIndex(SemanticTokenTypes.operator),
          0
        );
        i++;
        continue;
      }

      // Identifier or keyword
      if (isIdentifierStart(line[i])) {
        const start = i;
        while (i < line.length && isIdentifierChar(line[i])) {
          i++;
        }
        const word = line.slice(start, i);
        const tokenInfo = classifyToken(word, symbols, keywords, builtins, currentParams);

        if (tokenInfo) {
          builder.push(
            lineIndex,
            start,
            word.length,
            getTokenTypeIndex(tokenInfo.type),
            getModifierFlags(tokenInfo.modifiers)
          );
        }
        continue;
      }

      // Quote, unquote, etc.
      if (line[i] === "'" || line[i] === "~" || line[i] === "@") {
        builder.push(
          lineIndex,
          i,
          1,
          getTokenTypeIndex(SemanticTokenTypes.operator),
          0
        );
        i++;
        continue;
      }

      // Skip any other character
      i++;
    }
  }

  return builder.build().data;
}

/**
 * Check if character can start an identifier
 */
function isIdentifierStart(char: string): boolean {
  return /[a-zA-Z_\-?!<>=+*/%.]/.test(char);
}

/**
 * Check if character can be part of an identifier
 */
function isIdentifierChar(char: string): boolean {
  return /[a-zA-Z0-9_\-?!<>=+*/%.:>]/.test(char);
}

/**
 * Classify a token based on its context
 */
function classifyToken(
  word: string,
  symbols: SymbolTable | null,
  keywords: Set<string>,
  builtins: Set<string>,
  _currentParams: Set<string>
): { type: string; modifiers: string[] } | null {
  // Keywords first (highest priority)
  if (keywords.has(word)) {
    return { type: SemanticTokenTypes.keyword, modifiers: [] };
  }

  // Check symbol table
  if (symbols) {
    const sym = symbols.get(word);
    if (sym) {
      switch (sym.kind) {
        case "function":
        case "fn":
          return {
            type: SemanticTokenTypes.function,
            modifiers: sym.isExported ? [SemanticTokenModifiers.declaration] : [],
          };
        case "macro":
          return {
            type: SemanticTokenTypes.macro,
            modifiers: [SemanticTokenModifiers.declaration],
          };
        case "class":
          return {
            type: SemanticTokenTypes.class,
            modifiers: [SemanticTokenModifiers.declaration],
          };
        case "enum":
          return {
            type: SemanticTokenTypes.enum,
            modifiers: [SemanticTokenModifiers.declaration],
          };
        case "enum-case":
          return {
            type: SemanticTokenTypes.enumMember,
            modifiers: [],
          };
        case "variable":
          return {
            type: SemanticTokenTypes.variable,
            modifiers: [],
          };
        case "import":
        case "namespace":
          return {
            type: SemanticTokenTypes.namespace,
            modifiers: [],
          };
        case "field":
        case "property":
          return {
            type: SemanticTokenTypes.property,
            modifiers: [],
          };
        case "type":
          return {
            type: SemanticTokenTypes.type,
            modifiers: [],
          };
      }
    }
  }

  // Check builtins
  if (builtins.has(word)) {
    return {
      type: SemanticTokenTypes.function,
      modifiers: [SemanticTokenModifiers.defaultLibrary],
    };
  }

  // Check if it looks like a type (capitalized)
  if (/^[A-Z]/.test(word) && word !== "Math" && word !== "JSON") {
    return {
      type: SemanticTokenTypes.type,
      modifiers: [],
    };
  }

  // Boolean literals
  if (word === "true" || word === "false" || word === "nil") {
    return { type: SemanticTokenTypes.keyword, modifiers: [] };
  }

  // Default: no special highlighting
  return null;
}

/**
 * Get semantic tokens capabilities for server initialization
 */
export function getSemanticTokensCapability() {
  return {
    full: true,
    delta: false, // Could implement delta updates later for better performance
    range: false,
    legend: getSemanticTokensLegend(),
  };
}
