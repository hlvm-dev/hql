/**
 * LSP Hover Feature
 *
 * Provides hover information for symbols in HQL documents.
 */

import { Hover, MarkupKind } from "npm:vscode-languageserver@9.0.1";
import type { SymbolInfo } from "../../src/transpiler/symbol_table.ts";
import type { ModuleExport } from "../workspace/mod.ts";

/**
 * Generate hover content for a symbol
 */
export function getHover(symbol: SymbolInfo | undefined): Hover | null {
  if (!symbol) return null;

  const content = formatSymbolInfo(symbol);

  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: content,
    },
  };
}

/**
 * Format symbol information as markdown
 */
function formatSymbolInfo(symbol: SymbolInfo): string {
  const lines: string[] = [];

  // Header with kind and name
  const kindLabel = getKindLabel(symbol.kind);
  lines.push(`**${kindLabel}** \`${symbol.name}\``);

  // Type annotation
  if (symbol.type) {
    lines.push(`\n*Type:* \`${symbol.type}\``);
  }

  // Parameters for functions/macros
  if (symbol.params && symbol.params.length > 0) {
    const paramStr = symbol.params
      .map((p) => (p.type ? `${p.name}: ${p.type}` : p.name))
      .join(", ");
    lines.push(`\n*Parameters:* \`[${paramStr}]\``);
  }

  // Return type
  if (symbol.returnType) {
    lines.push(`\n*Returns:* \`${symbol.returnType}\``);
  }

  // Fields for classes
  if (symbol.fields && symbol.fields.length > 0) {
    const fieldStr = symbol.fields
      .map((f) => (f.type ? `${f.name}: ${f.type}` : f.name))
      .join(", ");
    lines.push(`\n*Fields:* \`${fieldStr}\``);
  }

  // Methods for classes
  if (symbol.methods && symbol.methods.length > 0) {
    const methodStr = symbol.methods.map((m) => m.name).join(", ");
    lines.push(`\n*Methods:* \`${methodStr}\``);
  }

  // Cases for enums
  if (symbol.cases && symbol.cases.length > 0) {
    lines.push(`\n*Cases:* \`${symbol.cases.join(", ")}\``);
  }

  // Parent (for enum cases, methods, etc.)
  if (symbol.parent) {
    lines.push(`\n*Member of:* \`${symbol.parent}\``);
  }

  // Source module for imports
  if (symbol.sourceModule) {
    lines.push(`\n*From:* \`"${symbol.sourceModule}"\``);
  }

  // Documentation
  if (symbol.documentation) {
    lines.push(`\n---\n${symbol.documentation}`);
  }

  return lines.join("");
}

/**
 * Get a human-readable label for a symbol kind
 */
function getKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    variable: "Variable",
    function: "Function",
    fn: "Function",
    macro: "Macro",
    class: "Class",
    enum: "Enum",
    "enum-case": "Enum Case",
    field: "Field",
    method: "Method",
    import: "Import",
    export: "Export",
    module: "Module",
    type: "Type",
    interface: "Interface",
    constant: "Constant",
    property: "Property",
    builtin: "Built-in",
    "special-form": "Special Form",
    alias: "Alias",
    namespace: "Namespace",
    operator: "Operator",
  };
  return labels[kind] || kind;
}

/**
 * Generate hover content for an external module export
 */
export function getHoverFromExport(
  exp: ModuleExport,
  specifier: string
): Hover {
  const lines: string[] = [];

  // Header with kind and name
  const kindLabel = getKindLabel(exp.kind);
  lines.push(`**${kindLabel}** \`${exp.name}\``);

  // Signature for functions
  if (exp.signature) {
    lines.push(`\n\`\`\`\n${exp.signature}\n\`\`\``);
  }

  // Source module
  lines.push(`\n*from* \`${specifier}\``);

  // Documentation
  if (exp.documentation) {
    lines.push(`\n---\n${exp.documentation}`);
  }

  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: lines.join(""),
    },
  };
}
