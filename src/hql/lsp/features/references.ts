/**
 * LSP Find References Feature
 *
 * Provides project-wide find references functionality.
 * Scans all HQL files in the workspace to find symbol usages.
 */

import type { Location } from "npm:vscode-languageserver@9.0.1";
import { walk } from "https://deno.land/std@0.208.0/fs/walk.ts";
import { filePathToUri } from "../documents.ts";
import { getPlatform } from "../../../platform/platform.ts";

/**
 * Reference location with additional context
 */
interface ReferenceResult {
  location: Location;
  isDefinition: boolean;
  context?: string; // Line of code containing the reference
}

/**
 * Find all references to a symbol across the workspace
 *
 * @param symbolName - The symbol to find references for
 * @param workspaceRoots - Workspace root directories to search
 * @param definitionFile - File where symbol is defined (to mark as definition)
 * @param definitionLine - Line where symbol is defined (1-based)
 * @param includeDeclaration - Whether to include the declaration
 */
export async function findReferencesInWorkspace(
  symbolName: string,
  workspaceRoots: string[],
  definitionFile?: string,
  definitionLine?: number,
  includeDeclaration = true
): Promise<ReferenceResult[]> {
  const results: ReferenceResult[] = [];

  // Escape regex special characters in symbol name
  const escapedName = symbolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Pattern to match the symbol as a whole word (not part of another identifier)
  // HQL identifiers can contain: letters, digits, -, _, ?, !
  const pattern = new RegExp(
    `(?<![a-zA-Z0-9_\\-?!])${escapedName}(?![a-zA-Z0-9_\\-?!])`,
    "g"
  );

  for (const root of workspaceRoots) {
    try {
      // Walk the directory tree
      for await (const entry of walk(root, {
        exts: [".hql"],
        includeDirs: false,
        followSymlinks: false,
        // Skip common directories that shouldn't be searched
        skip: [
          /node_modules/,
          /\.git/,
          /dist/,
          /build/,
          /target/,
          /\.hlvm-cache/,
        ],
      })) {
        try {
          const content = await getPlatform().fs.readTextFile(entry.path);
          const lines = content.split("\n");

          for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            const line = lines[lineIdx];
            let match;

            // Reset regex state for each line
            pattern.lastIndex = 0;

            while ((match = pattern.exec(line)) !== null) {
              const column = match.index;

              // Skip if this match is inside a string or comment
              if (isInsideStringOrComment(line, column)) {
                continue;
              }

              const lineNumber = lineIdx + 1; // 1-based
              const isDefinition =
                entry.path === definitionFile && lineNumber === definitionLine;

              // Skip declaration if not including it
              if (isDefinition && !includeDeclaration) {
                continue;
              }

              results.push({
                location: {
                  uri: filePathToUri(entry.path),
                  range: {
                    start: { line: lineIdx, character: column },
                    end: { line: lineIdx, character: column + symbolName.length },
                  },
                },
                isDefinition,
                context: line.trim(),
              });
            }
          }
        } catch {
          // Skip files that can't be read (permissions, etc.)
        }
      }
    } catch {
      // Skip roots that don't exist or can't be accessed
    }
  }

  return results;
}

/**
 * Check if a position in a line is inside a string or comment
 *
 * This is a simplified check that handles:
 * - Single-line comments starting with ;
 * - Double-quoted strings "..."
 */
function isInsideStringOrComment(line: string, position: number): boolean {
  let inString = false;
  let escaped = false;

  for (let i = 0; i < position && i < line.length; i++) {
    const char = line[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    // Comment starts here - everything after is comment
    if (char === ";" && !inString) {
      return true;
    }

    // Toggle string state
    if (char === '"') {
      inString = !inString;
    }
  }

  return inString;
}

/**
 * Find references in a single file's content (for open documents)
 *
 * @param content - The file content
 * @param symbolName - The symbol to find
 * @param filePath - The file path (for URI conversion)
 */
export function findReferencesInContent(
  content: string,
  symbolName: string,
  filePath: string
): Location[] {
  const results: Location[] = [];

  // Escape regex special characters
  const escapedName = symbolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const pattern = new RegExp(
    `(?<![a-zA-Z0-9_\\-?!])${escapedName}(?![a-zA-Z0-9_\\-?!])`,
    "g"
  );

  const lines = content.split("\n");

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    let match;

    pattern.lastIndex = 0;

    while ((match = pattern.exec(line)) !== null) {
      const column = match.index;

      if (isInsideStringOrComment(line, column)) {
        continue;
      }

      results.push({
        uri: filePathToUri(filePath),
        range: {
          start: { line: lineIdx, character: column },
          end: { line: lineIdx, character: column + symbolName.length },
        },
      });
    }
  }

  return results;
}
