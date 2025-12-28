/**
 * LSP Completion Feature
 *
 * Provides autocomplete suggestions for HQL code.
 * Uses single source of truth from known-identifiers.ts and primitives.ts.
 */

import {
  CompletionItemKind,
  InsertTextFormat,
  MarkupKind,
} from "npm:vscode-languageserver@9.0.1";
import type { CompletionItem } from "npm:vscode-languageserver@9.0.1";
import type { SymbolTable, SymbolInfo } from "../../src/transpiler/symbol_table.ts";
import type { ModuleExport } from "../workspace/mod.ts";

// Import from single source of truth
import { getAllKnownIdentifiers } from "../../src/common/known-identifiers.ts";
import {
  KERNEL_PRIMITIVES,
  ALL_OPERATOR_NAMES,
  JS_LITERAL_KEYWORDS,
} from "../../src/transpiler/keyword/primitives.ts";

/**
 * HQL snippet templates with tab stops
 * Uses VSCode snippet syntax: ${1:placeholder}, $0 for final cursor
 */
const SNIPPETS: CompletionItem[] = [
  // Bindings
  {
    label: "let",
    kind: CompletionItemKind.Snippet,
    detail: "(let name value) - block-scoped mutable binding",
    insertText: "(let ${1:name} ${2:value})$0",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    label: "const",
    kind: CompletionItemKind.Snippet,
    detail: "(const name value) - immutable binding (frozen)",
    insertText: "(const ${1:name} ${2:value})$0",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    label: "var",
    kind: CompletionItemKind.Snippet,
    detail: "(var name value) - function-scoped mutable binding",
    insertText: "(var ${1:name} ${2:value})$0",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  // Assignment
  {
    label: "=",
    kind: CompletionItemKind.Snippet,
    detail: "(= name value) - assignment",
    insertText: "(= ${1:name} ${2:value})$0",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  // Functions
  {
    label: "fn",
    kind: CompletionItemKind.Snippet,
    detail: "(fn name [args] body) - function definition",
    insertText: "(fn ${1:name} [${2:args}]\n  ${3:body})$0",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    label: "fn-arrow",
    kind: CompletionItemKind.Snippet,
    detail: "(fn [args] => expr) - arrow function",
    insertText: "(fn [${1:args}] => ${2:expr})$0",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  // Standalone arrow lambda
  {
    label: "=>",
    kind: CompletionItemKind.Snippet,
    detail: "(=> expr) - arrow lambda with $0, $1 params",
    insertText: "(=> ${1:expr})$0",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    label: "=>-params",
    kind: CompletionItemKind.Snippet,
    detail: "(=> [params] expr) - arrow lambda with explicit params",
    insertText: "(=> [${1:x}] ${2:expr})$0",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    label: "macro",
    kind: CompletionItemKind.Snippet,
    detail: "(macro name [args] body) - macro definition",
    insertText: "(macro ${1:name} [${2:args}]\n  ${3:body})$0",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  // Control flow
  {
    label: "if",
    kind: CompletionItemKind.Snippet,
    detail: "(if condition then else) - conditional",
    insertText: "(if ${1:condition}\n  ${2:then}\n  ${3:else})$0",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    label: "cond",
    kind: CompletionItemKind.Snippet,
    detail: "(cond clause...) - multi-way conditional",
    insertText: "(cond\n  ${1:condition} ${2:result}\n  else ${3:default})$0",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    label: "when",
    kind: CompletionItemKind.Snippet,
    detail: "(when condition body) - when true",
    insertText: "(when ${1:condition}\n  ${2:body})$0",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    label: "unless",
    kind: CompletionItemKind.Snippet,
    detail: "(unless condition body) - when false",
    insertText: "(unless ${1:condition}\n  ${2:body})$0",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    label: "match",
    kind: CompletionItemKind.Snippet,
    detail: "(match expr pattern=>result...) - pattern matching",
    insertText: "(match ${1:expr}\n  ${2:pattern} ${3:result}\n  _ ${4:default})$0",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    label: "do",
    kind: CompletionItemKind.Snippet,
    detail: "(do expr...) - sequential execution",
    insertText: "(do\n  ${1:expr1}\n  ${2:expr2})$0",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  // Loops
  {
    label: "for",
    kind: CompletionItemKind.Snippet,
    detail: "(for [binding iterable] body) - for loop",
    insertText: "(for [${1:item} ${2:collection}]\n  ${3:body})$0",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    label: "while",
    kind: CompletionItemKind.Snippet,
    detail: "(while condition body) - while loop",
    insertText: "(while ${1:condition}\n  ${2:body})$0",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    label: "loop",
    kind: CompletionItemKind.Snippet,
    detail: "(loop [bindings] body) - loop with recur",
    insertText: "(loop [${1:i} ${2:0}]\n  ${3:body}\n  (recur ${4:(inc i)}))$0",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  // Data structures
  {
    label: "class",
    kind: CompletionItemKind.Snippet,
    detail: "(class Name fields methods) - class definition",
    insertText: "(class ${1:Name}\n  (field ${2:field1})\n  (fn ${3:method} [self ${4:args}]\n    ${5:body}))$0",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    label: "enum",
    kind: CompletionItemKind.Snippet,
    detail: "(enum Name cases) - enum definition",
    insertText: "(enum ${1:Name}\n  (case ${2:Case1})\n  (case ${3:Case2}))$0",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    label: "case",
    kind: CompletionItemKind.Snippet,
    detail: "(case Name) - enum case",
    insertText: "(case ${1:Name})$0",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  // Modules
  {
    label: "import",
    kind: CompletionItemKind.Snippet,
    detail: "(import [symbols] from \"path\") - import",
    insertText: "(import [${1:symbols}] from \"${2:./module}\")$0",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    label: "export",
    kind: CompletionItemKind.Snippet,
    detail: "(export symbol) - export symbol",
    insertText: "(export ${1:symbol})$0",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  // Error handling
  {
    label: "try",
    kind: CompletionItemKind.Snippet,
    detail: "(try body (catch e handler)) - try/catch",
    insertText: "(try\n  ${1:body}\n  (catch ${2:e}\n    ${3:handler}))$0",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    label: "throw",
    kind: CompletionItemKind.Snippet,
    detail: "(throw expr) - throw error",
    insertText: "(throw ${1:error})$0",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  // Other
  {
    label: "new",
    kind: CompletionItemKind.Snippet,
    detail: "(new Class args) - instantiate",
    insertText: "(new ${1:Class} ${2:args})$0",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    label: "await",
    kind: CompletionItemKind.Snippet,
    detail: "(await promise) - await async",
    insertText: "(await ${1:promise})$0",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  // Common patterns
  {
    label: "fn-export",
    kind: CompletionItemKind.Snippet,
    detail: "Define and export function",
    insertText: "(fn ${1:name} [${2:args}]\n  ${3:body})\n(export ${1:name})$0",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    label: "lambda",
    kind: CompletionItemKind.Snippet,
    detail: "(fn [args] => expr) - anonymous function",
    insertText: "(fn [${1:x}] => ${2:x})$0",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    label: "print",
    kind: CompletionItemKind.Snippet,
    detail: "(print expr) - print to stdout",
    insertText: "(print ${1:expr})$0",
    insertTextFormat: InsertTextFormat.Snippet,
  },
];

/**
 * Build keywords from single source of truth (KERNEL_PRIMITIVES).
 * Snippets already provide templates for many of these, so keywords
 * are just for plain completion without templates.
 */
function buildKeywords(): CompletionItem[] {
  // Get kernel primitives that aren't already snippets
  const snippetLabels = new Set(SNIPPETS.map(s => s.label));

  return [...KERNEL_PRIMITIVES]
    .filter(kw => !snippetLabels.has(kw))
    .map(kw => ({
      label: kw,
      kind: CompletionItemKind.Keyword,
      detail: "keyword",
    }));
}

/**
 * Detailed descriptions for common HQL functions.
 * Only common functions that benefit from descriptions are listed.
 * Everything else gets auto-populated from getAllKnownIdentifiers().
 */
const BUILTIN_DESCRIPTIONS: Record<string, string> = {
  // I/O (NOTE: println does NOT exist in HQL - only print!)
  "print": "Print values to stdout",
  // Type conversion (NOTE: int and float do NOT exist in HQL!)
  "str": "Convert to string",
  // Collections
  "list": "Create a list",
  "vector": "Create a vector",
  "hash-map": "Create a hash map",
  "hash-set": "Create a hash set",
  // Sequence operations (these actually exist in HQL stdlib)
  "first": "Get first element",
  "rest": "Get all but first element",
  "last": "Get last element",
  "nth": "Get nth element",
  "cons": "Prepend element to sequence",
  "concat": "Concatenate sequences",
  "count": "Get length of collection",
  "isEmpty": "Check if collection is empty",
  // Higher-order functions
  "map": "Transform each element",
  "filter": "Keep matching elements",
  "reduce": "Fold over sequence",
  "apply": "Apply function to args",
  // Predicates - HQL uses camelCase, NOT Clojure's question-mark style!
  "isNil": "Check if nil",
  "isSome": "Check if not nil",
  "isFunction": "Check if function",
  "isArray": "Check if array",
  "isString": "Check if string",
  "isNumber": "Check if number",
  "isBoolean": "Check if boolean",
  "isEven": "Check if even number",
  "isOdd": "Check if odd number",
  "isPositive": "Check if positive number",
  "isNegative": "Check if negative number",
  "isZero": "Check if zero",
  // Math
  "inc": "Increment by 1",
  "dec": "Decrement by 1",
  "min": "Minimum value",
  "max": "Maximum value",
  "mod": "Modulo operation",
  // Logic (these are macros)
  "and": "Logical and",
  "or": "Logical or",
  "not": "Logical not",
  // JS interop
  "js-call": "Call JavaScript method",
  "js-get": "Get JavaScript property",
  "js-set": "Set JavaScript property",
  // Operators
  "+": "Addition",
  "-": "Subtraction",
  "*": "Multiplication",
  "/": "Division",
  "%": "Modulo",
  "**": "Exponentiation",
  "===": "Strict equality",
  "==": "Loose equality",
  "!==": "Strict inequality",
  "!=": "Loose inequality",
  "<": "Less than",
  ">": "Greater than",
  "<=": "Less than or equal",
  ">=": "Greater than or equal",
  "&&": "Logical AND",
  "||": "Logical OR",
  "!": "Logical NOT",
  "??": "Nullish coalescing",
  "&": "Bitwise AND",
  "|": "Bitwise OR",
  "^": "Bitwise XOR",
  "~": "Bitwise NOT",
  "<<": "Left shift",
  ">>": "Sign-propagating right shift",
  ">>>": "Zero-fill right shift",
  "typeof": "Get type of value",
  "instanceof": "Check instance type",
};

/**
 * Build builtins dynamically from getAllKnownIdentifiers().
 * Single source of truth - no more hardcoded duplicates!
 */
function buildBuiltins(): CompletionItem[] {
  const snippetLabels = new Set(SNIPPETS.map(s => s.label));
  const operatorSet = new Set(ALL_OPERATOR_NAMES);

  return getAllKnownIdentifiers()
    .filter(id => !snippetLabels.has(id))  // Don't duplicate snippets
    .filter(id => !KERNEL_PRIMITIVES.has(id))  // Don't duplicate keywords
    .filter(id => !id.startsWith("%"))  // Skip internal functions
    .filter(id => !id.startsWith("_"))  // Skip private functions
    .map(id => ({
      label: id,
      kind: operatorSet.has(id) ? CompletionItemKind.Operator : CompletionItemKind.Function,
      detail: BUILTIN_DESCRIPTIONS[id] ?? "function",
    }));
}

/**
 * Build constants from JS_LITERAL_KEYWORDS + HQL-specific constants.
 */
function buildConstants(): CompletionItem[] {
  const constantDescriptions: Record<string, string> = {
    "true": "Boolean true",
    "false": "Boolean false",
    "null": "Null value",
    "undefined": "Undefined value",
    "nil": "Nil value (alias for null)",
  };

  // JS literals from primitives.ts + HQL-specific nil
  const allConstants = [...JS_LITERAL_KEYWORDS, "nil"] as const;

  return allConstants.map(c => ({
    label: c,
    kind: CompletionItemKind.Constant,
    detail: constantDescriptions[c] ?? "constant",
  }));
}

/**
 * HQL Type Completions
 *
 * These types are used for type annotations in HQL:
 *   (fn add [a:number b:number] :number ...)
 *
 * HQL supports TypeScript-style types since it compiles to TypeScript/JavaScript.
 */
const TYPE_COMPLETIONS: CompletionItem[] = [
  // Primitive types
  {
    label: "number",
    kind: CompletionItemKind.TypeParameter,
    detail: "Number type (integer or float)",
    documentation: "JavaScript number type for numeric values",
  },
  {
    label: "string",
    kind: CompletionItemKind.TypeParameter,
    detail: "String type",
    documentation: "JavaScript string type for text values",
  },
  {
    label: "boolean",
    kind: CompletionItemKind.TypeParameter,
    detail: "Boolean type (true/false)",
    documentation: "JavaScript boolean type",
  },
  {
    label: "any",
    kind: CompletionItemKind.TypeParameter,
    detail: "Any type (disables type checking)",
    documentation: "TypeScript any type - allows any value",
  },
  {
    label: "void",
    kind: CompletionItemKind.TypeParameter,
    detail: "Void type (no return value)",
    documentation: "Used for functions that don't return a value",
  },
  {
    label: "null",
    kind: CompletionItemKind.TypeParameter,
    detail: "Null type",
    documentation: "The null value type",
  },
  {
    label: "undefined",
    kind: CompletionItemKind.TypeParameter,
    detail: "Undefined type",
    documentation: "The undefined value type",
  },
  // Object types
  {
    label: "object",
    kind: CompletionItemKind.TypeParameter,
    detail: "Object type",
    documentation: "JavaScript object type",
  },
  {
    label: "Array",
    kind: CompletionItemKind.TypeParameter,
    detail: "Array type",
    documentation: "JavaScript Array - use Array<T> for typed arrays",
  },
  {
    label: "Function",
    kind: CompletionItemKind.TypeParameter,
    detail: "Function type",
    documentation: "JavaScript function type",
  },
  {
    label: "Promise",
    kind: CompletionItemKind.TypeParameter,
    detail: "Promise type",
    documentation: "JavaScript Promise for async operations",
  },
  {
    label: "Map",
    kind: CompletionItemKind.TypeParameter,
    detail: "Map type",
    documentation: "JavaScript Map collection",
  },
  {
    label: "Set",
    kind: CompletionItemKind.TypeParameter,
    detail: "Set type",
    documentation: "JavaScript Set collection",
  },
  // Common DOM/Web types
  {
    label: "Element",
    kind: CompletionItemKind.TypeParameter,
    detail: "DOM Element type",
    documentation: "DOM Element for web development",
  },
  {
    label: "HTMLElement",
    kind: CompletionItemKind.TypeParameter,
    detail: "HTML Element type",
    documentation: "DOM HTMLElement for web development",
  },
  {
    label: "Event",
    kind: CompletionItemKind.TypeParameter,
    detail: "Event type",
    documentation: "DOM Event type",
  },
  // TypeScript utility types
  {
    label: "Record",
    kind: CompletionItemKind.TypeParameter,
    detail: "Record<K, V> - object with keys K and values V",
    documentation: "TypeScript Record utility type",
  },
  {
    label: "Partial",
    kind: CompletionItemKind.TypeParameter,
    detail: "Partial<T> - all properties optional",
    documentation: "TypeScript Partial utility type",
  },
  {
    label: "Required",
    kind: CompletionItemKind.TypeParameter,
    detail: "Required<T> - all properties required",
    documentation: "TypeScript Required utility type",
  },
  {
    label: "Readonly",
    kind: CompletionItemKind.TypeParameter,
    detail: "Readonly<T> - all properties readonly",
    documentation: "TypeScript Readonly utility type",
  },
];

// Cache for dynamically built completions (built once per session)
let _cachedCompletions: CompletionItem[] | null = null;

/**
 * Get base completion items (snippets, keywords, builtins, constants).
 * Cached for performance since these don't change during a session.
 */
function getBaseCompletions(): CompletionItem[] {
  if (!_cachedCompletions) {
    _cachedCompletions = [
      ...SNIPPETS,
      ...buildKeywords(),
      ...buildBuiltins(),
      ...buildConstants(),
    ];
  }
  return _cachedCompletions;
}

/**
 * Imported module context for completions
 */
export interface ImportedModuleContext {
  specifier: string;
  exports: ModuleExport[];
  importedNames?: string[]; // If specific names are imported
}

/**
 * Completion context for determining what kind of completions to provide
 */
export interface CompletionContext {
  isTypePosition: boolean; // True if cursor is after : in a type annotation position
}

/**
 * Get completion items for a document
 *
 * @param symbols - Local symbol table
 * @param importedModules - Exports from imported modules (npm:, jsr:, local .js/.ts)
 * @param context - Optional context for type position detection
 */
export function getCompletions(
  symbols: SymbolTable | null,
  importedModules?: ImportedModuleContext[],
  context?: CompletionContext
): CompletionItem[] {
  // If in type position, return type completions
  if (context?.isTypePosition) {
    return TYPE_COMPLETIONS;
  }

  const items: CompletionItem[] = [...getBaseCompletions()];

  // Add user-defined symbols
  if (symbols) {
    for (const symbol of symbols.getAllSymbols()) {
      items.push(symbolToCompletion(symbol));
    }
  }

  // Add exports from imported modules
  if (importedModules) {
    for (const mod of importedModules) {
      for (const exp of mod.exports) {
        // If specific names are imported, only include those
        if (mod.importedNames && !mod.importedNames.includes(exp.name)) {
          continue;
        }
        items.push(moduleExportToCompletion(exp, mod.specifier));
      }
    }
  }

  return items;
}

/**
 * Convert a module export to a completion item
 */
function moduleExportToCompletion(exp: ModuleExport, specifier: string): CompletionItem {
  const item: CompletionItem = {
    label: exp.name,
    kind: moduleKindToCompletionKind(exp.kind),
    detail: exp.signature ?? `from ${specifier}`,
  };

  // Add documentation if available
  if (exp.documentation) {
    item.documentation = {
      kind: MarkupKind.Markdown,
      value: `${exp.documentation}\n\n*from \`${specifier}\`*`,
    };
  }

  return item;
}

/**
 * Map module export kinds to LSP completion kinds
 */
function moduleKindToCompletionKind(kind: ModuleExport["kind"]): CompletionItemKind {
  switch (kind) {
    case "function": return CompletionItemKind.Function;
    case "class": return CompletionItemKind.Class;
    case "variable": return CompletionItemKind.Variable;
    case "interface": return CompletionItemKind.Interface;
    case "type": return CompletionItemKind.TypeParameter;
    case "enum": return CompletionItemKind.Enum;
    case "namespace": return CompletionItemKind.Module;
    default: return CompletionItemKind.Value;
  }
}

/**
 * Convert a symbol to a completion item
 */
function symbolToCompletion(symbol: SymbolInfo): CompletionItem {
  const item: CompletionItem = {
    label: symbol.name,
    kind: symbolKindToCompletionKind(symbol.kind),
    detail: symbol.type ?? symbol.kind,
  };

  // Add documentation if available
  if (symbol.documentation) {
    item.documentation = symbol.documentation;
  }

  // Add parameter info for functions
  if (symbol.params && symbol.params.length > 0) {
    const paramStr = symbol.params.map((p) => p.name).join(" ");
    item.detail = `(${symbol.name} ${paramStr})`;
  }

  return item;
}

/**
 * Map symbol kinds to LSP completion item kinds
 */
function symbolKindToCompletionKind(kind: string): CompletionItemKind {
  const map: Record<string, CompletionItemKind> = {
    function: CompletionItemKind.Function,
    fn: CompletionItemKind.Function,
    variable: CompletionItemKind.Variable,
    macro: CompletionItemKind.Snippet,
    class: CompletionItemKind.Class,
    enum: CompletionItemKind.Enum,
    "enum-case": CompletionItemKind.EnumMember,
    field: CompletionItemKind.Field,
    method: CompletionItemKind.Method,
    import: CompletionItemKind.Module,
    export: CompletionItemKind.Module,
    module: CompletionItemKind.Module,
    constant: CompletionItemKind.Constant,
    property: CompletionItemKind.Property,
    type: CompletionItemKind.TypeParameter,
    interface: CompletionItemKind.Interface,
  };
  return map[kind] ?? CompletionItemKind.Text;
}
