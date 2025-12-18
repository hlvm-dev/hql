/**
 * LSP Go to Definition Feature
 *
 * Provides navigation to symbol definitions.
 */

import type { Location } from "npm:vscode-languageserver@9.0.1";
import type { SymbolInfo } from "../../src/transpiler/symbol_table.ts";
import { toLSPPosition } from "../utils/position.ts";
import { filePathToUri } from "../documents.ts";

/**
 * Get the definition location for a symbol
 */
export function getDefinition(symbol: SymbolInfo | undefined): Location | null {
  if (!symbol?.location) return null;

  const { filePath, line, column } = symbol.location;

  // Convert file path to URI
  const uri = filePathToUri(filePath);

  // Create LSP location
  return {
    uri,
    range: {
      start: toLSPPosition({ line, column }),
      end: toLSPPosition({ line, column: column + symbol.name.length }),
    },
  };
}
