// core/src/common/syntax-error-handler.ts
// A comprehensive system for handling syntax errors with accurate source locations

import { exists, readTextFile } from "../platform/platform.ts";
import {
  HQLError,
  RuntimeError,
  type SourceLocation,
  ValidationError,
} from "./error.ts";
import { globalLogger as logger } from "../logger.ts";
import {
  createWordBoundaryRegex,
  escapeRegExp,
  getErrorMessage,
  isObjectValue,
  isNullish,
} from "./utils.ts";
import { enrichErrorWithContext } from "./error-system.ts";
import { resolveSourceLocation } from "../transpiler/utils/source_location_utils.ts";
import { extractContextLinesFromFile } from "./context-helpers.ts";
import type { SExpMeta } from "../s-exp/types.ts";

type NodeWithMeta = { _meta?: SExpMeta };

type LocationResolver = () => Promise<Partial<SourceLocation> | undefined>;

interface PatternDescriptor {
  regex: RegExp;
  columnResolver?: (
    match: RegExpMatchArray,
    lineText: string,
  ) => number | undefined;
}

interface ErrorWithSourceLocationOptions<T extends HQLError> {
  filePath: string;
  position?: { line?: number; column?: number };
  locators?: LocationResolver[];
  createError: (location: SourceLocation) => T;
  afterCreate?: (error: T, location: SourceLocation) => void | Promise<void>;
}

async function findLocationByPatterns(
  filePath: string,
  patterns: PatternDescriptor[],
): Promise<Partial<SourceLocation> | undefined> {
  try {
    if (!await exists(filePath)) {
      logger.debug(`Cannot search patterns: File does not exist: ${filePath}`);
      return undefined;
    }

    const content = await readTextFile(filePath);
    const lines = content.split(/\r?\n/);

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      for (const descriptor of patterns) {
        const regex = new RegExp(
          descriptor.regex.source,
          descriptor.regex.flags,
        );
        const match = regex.exec(line);
        if (match) {
          const column = descriptor.columnResolver?.(match, line) ??
            ((match.index ?? 0) + 1);
          return {
            line: lineIndex + 1,
            column,
          };
        }
      }
    }
  } catch (error) {
    logger.debug(
      `Failed to search for patterns in ${filePath}: ${
        getErrorMessage(error)
      }`,
    );
  }

  return undefined;
}

async function handleErrorWithSourceLocation<T extends HQLError>(
  options: ErrorWithSourceLocationOptions<T>,
): Promise<T> {
  const location: SourceLocation = {
    filePath: options.filePath,
    ...(options.position ?? {}),
  };

  if ((!location.line || !location.column) && options.locators) {
    for (const resolver of options.locators) {
      const result = await resolver();
      if (result) {
        if (result.line !== undefined) location.line = result.line;
        if (result.column !== undefined) location.column = result.column;
        if (location.line && location.column) break;
      }
    }
  }

  const error = options.createError(location);
  if (options.afterCreate) {
    await options.afterCreate(error, location);
  }

  return await enrichErrorWithContext(error, options.filePath) as T;
}

/**
 * Attach source location information to an S-expression or other node
 */
export function attachSourceLocation(
  node: NodeWithMeta | null | undefined,
  filePath: string,
  line?: number,
  column?: number,
  endLine?: number,
  endColumn?: number,
): void {
  if (!node) return;

  // Create metadata object if it doesn't exist
  const meta = node._meta ?? (node._meta = {} as SExpMeta);

  // Set file path (only if provided)
  if (filePath) {
    meta.filePath = filePath;
  }

  // Set line and column if provided
  if (line !== undefined) {
    meta.line = line;
  }
  if (column !== undefined) {
    meta.column = column;
  }
  if (endLine !== undefined) {
    meta.endLine = endLine;
  }
  if (endColumn !== undefined) {
    meta.endColumn = endColumn;
  }
}

/**
 * Get source location information from a node
 */
export function getSourceLocation(node: unknown): SourceLocation {
  return resolveSourceLocation(node);
}

/**
 * Load context lines from a source file
 */
export async function loadContextLines(
  filePath: string,
  errorLine: number,
  contextSize: number = 2,
): Promise<
  { line: number; content: string; isError: boolean; column?: number }[] | null
> {
  // Use unified context extraction helper
  return await extractContextLinesFromFile(
    filePath,
    errorLine,
    undefined,
    contextSize,
  );
}

/**
 * Add context lines to an error
 */
export async function addContextLinesToError(
  error: HQLError,
  contextSize: number = 2,
): Promise<HQLError> {
  // Skip if error already has context or no source location
  if (
    error.contextLines?.length > 0 || !error.sourceLocation?.filePath ||
    !error.sourceLocation.line
  ) {
    return error;
  }

  try {
    const filePath = error.sourceLocation.filePath;
    const errorLine = error.sourceLocation.line;
    const errorColumn = error.sourceLocation.column;

    const contextLines = await loadContextLines(
      filePath,
      errorLine,
      contextSize,
    );
    if (contextLines) {
      error.contextLines = contextLines;

      // Add column to the error line if it exists
      if (errorColumn) {
        const errorLineObj = error.contextLines.find((line) =>
          line.line === errorLine && line.isError
        );
        if (errorLineObj) {
          errorLineObj.column = errorColumn;
        }
      }
    }
  } catch (e) {
    logger.debug(
      `Failed to add context lines to error: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  return error;
}

/**
 * Extract line and column information from an error message
 */
function extractLineColumnFromError(
  error: string,
): { line?: number; column?: number } {
  // Patterns to match:
  // - line X, column Y
  // - line X:Y
  // - file:X:Y
  // - at position X:Y

  const patterns = [
    /(?:at\s+)?line\s+(\d+),\s*column\s+(\d+)/i,
    /(?:at\s+)?line\s+(\d+):(\d+)/i,
    /(?:at\s+position\s+)(\d+):(\d+)/i,
    /:(\d+):(\d+)(?!\d)/,
  ];

  for (const pattern of patterns) {
    const match = error.match(pattern);
    if (match && match.length >= 3) {
      return {
        line: parseInt(match[1], 10),
        column: parseInt(match[2], 10),
      };
    }
  }

  // If only line number is available
  const lineOnlyMatch = error.match(/(?:at\s+)?line\s+(\d+)/i);
  if (lineOnlyMatch && lineOnlyMatch.length >= 2) {
    return {
      line: parseInt(lineOnlyMatch[1], 10),
    };
  }

  return {};
}

/**
 * Find the source location for a symbol in a file
 */
export async function findSymbolLocation(
  symbolName: string,
  filePath: string,
): Promise<SourceLocation> {
  const location: SourceLocation = {
    filePath,
  };

  try {
    if (!await exists(filePath)) {
      logger.debug(
        `Cannot find symbol location: File does not exist: ${filePath}`,
      );
      return location;
    }

    const content = await readTextFile(filePath);
    const lines = content.split("\n");

    // Compile regex once before loop for better performance
    const regex = createWordBoundaryRegex(symbolName);

    for (let i = 0; i < lines.length; i++) {
      // Look for the symbol as a whole word
      const match = lines[i].match(regex);

      if (match) {
        location.line = i + 1; // 1-based line numbers
        location.column = match.index ? match.index + 1 : 1; // 1-based column numbers
        break;
      }
    }
  } catch (error) {
    logger.debug(
      `Error finding symbol location for ${symbolName}: ${
        getErrorMessage(error)
      }`,
    );
  }

  return location;
}

/**
 * Handle a property access error with detailed source information
 */
export async function handlePropertyAccessError(
  objName: string,
  propName: string,
  filePath: string,
  position?: { line?: number; column?: number },
): Promise<Error> {
  const message = `Property '${propName}' not found in object '${objName}'`;

  const propertyPatterns: PatternDescriptor[] = [
    {
      regex: new RegExp(
        `\\b${escapeRegExp(objName)}\\.${escapeRegExp(propName)}\\b`,
      ),
      columnResolver: (match, lineText) => {
        const startIndex = match.index ?? 0;
        const propertyIndex = lineText.indexOf(propName, startIndex);
        if (propertyIndex >= 0) return propertyIndex + 1;
        const dotIndex = lineText.indexOf(".", startIndex);
        return dotIndex >= 0 ? dotIndex + 1 : startIndex + 1;
      },
    },
    {
      regex: new RegExp(
        `\\(\\s*${escapeRegExp(objName)}\\.${escapeRegExp(propName)}`,
      ),
    },
    {
      regex: new RegExp(
        `\\(\\s*${escapeRegExp(objName)}\\s+"${escapeRegExp(propName)}"`,
      ),
    },
    {
      regex: new RegExp(
        `\\(\\s*get\\s+${escapeRegExp(objName)}\\s+"${escapeRegExp(propName)}"`,
      ),
    },
    {
      regex: new RegExp(
        `\\(\\s*${escapeRegExp(objName)}\\s+\\.${escapeRegExp(propName)}`,
      ),
    },
  ];

  const fallbackPatterns: PatternDescriptor[] = [
    { regex: createWordBoundaryRegex(objName) },
  ];

  const error = await handleErrorWithSourceLocation<ValidationError>({
    filePath,
    position,
    locators: [
      async () =>
        await findLocationByPatterns(filePath, propertyPatterns) ??
          await findLocationByPatterns(filePath, fallbackPatterns),
    ],
    createError: (location) =>
      new ValidationError(
        message,
        "property access",
        {
          expectedType: "defined property",
          actualType: "undefined property",
          filePath: location.filePath,
          line: location.line,
          column: location.column,
        },
      ),
  });

  return error;
}

/**
 * Handle a variable not found error with detailed source information
 */
export async function handleVariableNotFoundError(
  varName: string,
  filePath: string,
  position?: { line?: number; column?: number },
): Promise<Error> {
  const message = `Variable '${varName}' is not defined`;

  const variablePatterns: PatternDescriptor[] = [
    new RegExp(`\\(\\s*${escapeRegExp(varName)}\\s`),
    new RegExp(`\\(\\s*${escapeRegExp(varName)}\\.`),
    new RegExp(`\\(\\s*(let|var|=)\\s+${escapeRegExp(varName)}\\b`),
    new RegExp(`[\\s\\(\\[{]${escapeRegExp(varName)}[\\s\\)\\]}]`),
  ].map((regex) => ({ regex }));

  const fallbackPatterns: PatternDescriptor[] = [
    { regex: new RegExp(`${escapeRegExp(varName)}`) },
  ];

  const error = await handleErrorWithSourceLocation<ValidationError>({
    filePath,
    position,
    locators: [
      async () =>
        await findLocationByPatterns(filePath, variablePatterns) ??
          await findLocationByPatterns(filePath, fallbackPatterns),
    ],
    createError: (location) =>
      new ValidationError(
        message,
        "variable reference",
        {
          expectedType: "defined variable",
          actualType: "undefined variable",
          filePath: location.filePath,
          line: location.line,
          column: location.column,
        },
      ),
  });

  return error;
}

/**
 * Find the accurate source location for a syntax error
 */
export async function findSyntaxErrorLocation(
  errorMessage: string,
  filePath: string,
  approximateLine?: number,
): Promise<SourceLocation> {
  const location: SourceLocation = {
    filePath,
  };

  // First try extracting line/column from the error message
  const { line, column } = extractLineColumnFromError(errorMessage);
  if (line) {
    location.line = line;
    location.column = column;

    // If we have that, we're done
    return location;
  }

  // Otherwise, try to find syntax elements mentioned in the error
  try {
    if (!await exists(filePath)) {
      logger.debug(
        `Cannot find syntax error location: File does not exist: ${filePath}`,
      );
      return location;
    }

    const content = await readTextFile(filePath);
    const lines = content.split("\n");

    // Extract common error patterns
    const unclosedMatch = errorMessage.match(/Unclosed\s+([a-z]+)/i);
    const unexpectedMatch = errorMessage.match(/Unexpected\s+([^\s]+)/i);
    const expectedMatch = errorMessage.match(/Expected\s+([^\s]+)/i);
    const missingMatch = errorMessage.match(/Missing\s+([^\s]+)/i);

    // Unexpected token/symbol errors
    if (unexpectedMatch) {
      const unexpected = unexpectedMatch[1].replace(/['"(),.:;]/g, "");

      let searchStartLine = 0;
      let searchEndLine = lines.length;

      // If we have an approximate line, search nearby
      if (approximateLine !== undefined) {
        searchStartLine = Math.max(0, approximateLine - 5);
        searchEndLine = Math.min(lines.length, approximateLine + 5);
      }

      // Search in the vicinity of the approximate line
      for (let i = searchStartLine; i < searchEndLine; i++) {
        const line = lines[i];
        const pos = line.indexOf(unexpected);

        if (pos >= 0) {
          location.line = i + 1;
          location.column = pos + 1;
          return location;
        }
      }
    } // Missing token errors
    else if (missingMatch || expectedMatch) {
      const token = (missingMatch?.[1] || expectedMatch?.[1] || "").replace(
        /['"(),.:;]/g,
        "",
      );

      // Common missing tokens
      const tokens = {
        "closing": [")", "]", "}", '"'],
        "opening": ["(", "[", "{", '"'],
        "parenthesis": ["(", ")"],
        "bracket": ["[", "]"],
        "brace": ["{", "}"],
        "quote": ['"'],
        "identifier": ["identifier", "name", "symbol"],
        "expression": ["expression", "value"],
      };

      // Determine what kind of token is missing
      const tokenType = token.toLowerCase();
      let searchTokens: string[] = [];

      if (tokens[tokenType as keyof typeof tokens]) {
        searchTokens = tokens[tokenType as keyof typeof tokens];
      } else if (tokenType.includes("paren")) {
        searchTokens = tokens["parenthesis"];
      } else if (tokenType.includes("bracket")) {
        searchTokens = tokens["bracket"];
      } else if (tokenType.includes("brace")) {
        searchTokens = tokens["brace"];
      } else if (tokenType.includes("quote")) {
        searchTokens = tokens["quote"];
      }

      // Search for imbalanced delimiters
      if (
        searchTokens.length > 0 && (
          searchTokens.includes("(") ||
          searchTokens.includes("[") ||
          searchTokens.includes("{") ||
          searchTokens.includes('"')
        )
      ) {
        // Track delimiter balancing
        const stacks: Record<string, number[][]> = {
          "(": [],
          ")": [],
          "[": [],
          "]": [],
          "{": [],
          "}": [],
          '"': [],
        };

        // Scan the file for imbalanced delimiters
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          let inString = false;

          for (let j = 0; j < line.length; j++) {
            const char = line[j];

            // Handle strings specially
            if (char === '"' && (j === 0 || line[j - 1] !== "\\")) {
              inString = !inString;

              if (inString) {
                stacks['"'].push([i, j]);
              } else if (stacks['"'].length > 0) {
                stacks['"'].pop();
              }
              continue;
            }

            // Skip chars inside strings except quotes
            if (inString && char !== '"') continue;

            // Track opening delimiters
            if (char === "(" || char === "[" || char === "{") {
              stacks[char].push([i, j]);
            } // Track closing delimiters
            else if (char === ")" || char === "]" || char === "}") {
              const matchingOpen = char === ")"
                ? "("
                : (char === "]" ? "[" : "{");
              if (stacks[matchingOpen].length > 0) {
                stacks[matchingOpen].pop();
              } else {
                // Unmatched closing delimiter
                location.line = i + 1;
                location.column = j + 1;
                return location;
              }
            }
          }
        }

        // Check for unclosed delimiters
        for (const token of searchTokens) {
          if (stacks[token] && stacks[token].length > 0) {
            // Use the position of the last unclosed delimiter
            const [lineIdx, colIdx] = stacks[token][stacks[token].length - 1];
            location.line = lineIdx + 1;
            location.column = colIdx + 1;
            return location;
          }
        }
      }

      // If we have an approximate line, use it
      if (approximateLine !== undefined) {
        location.line = approximateLine;

        // Try to find syntax elements near the line
        const lineContent = lines[approximateLine - 1] || "";
        for (
          const token of ["(", ")", "[", "]", "{", "}", '"', "let", "if", "fn"]
        ) {
          const pos = lineContent.indexOf(token);
          if (pos >= 0) {
            location.column = pos + 1;
            return location;
          }
        }

        // If no syntax elements found, use first non-whitespace
        const firstNonWs = lineContent.search(/\S/);
        location.column = firstNonWs >= 0 ? firstNonWs + 1 : 1;
      }
    } // Unclosed delimiter errors
    else if (unclosedMatch) {
      const type = unclosedMatch[1].toLowerCase();
      let openChar = "(";

      switch (type) {
        case "list":
          openChar = "(";
          break;
        case "vector":
          openChar = "[";
          break;
        case "map":
        case "object":
          openChar = "{";
          break;
        case "string":
          openChar = '"';
          break;
      }

      // Track nesting levels to find unbalanced delimiters
      const openPositions: [number, number][] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let inString = false;

        for (let j = 0; j < line.length; j++) {
          const char = line[j];

          // Handle strings specially
          if (char === '"' && (j === 0 || line[j - 1] !== "\\")) {
            inString = !inString;
          }

          // Skip chars inside strings except for string errors
          if (inString && openChar !== '"') continue;

          if (char === openChar) {
            openPositions.push([i, j]);
          } else if (
            (openChar === "(" && char === ")") ||
            (openChar === "[" && char === "]") ||
            (openChar === "{" && char === "}") ||
            (openChar === '"' && char === '"' &&
              (j === 0 || line[j - 1] !== "\\"))
          ) {
            if (openPositions.length > 0) {
              openPositions.pop();
            }
          }
        }
      }

      // If we have unclosed delimiters, use the last one's position
      if (openPositions.length > 0) {
        const [lineIdx, colIdx] = openPositions[openPositions.length - 1];
        location.line = lineIdx + 1;
        location.column = colIdx + 1;
        return location;
      }
    }

    // If nothing else worked and we have an approximate line, use it
    if (approximateLine !== undefined) {
      location.line = approximateLine;

      // Try to find a non-whitespace character on that line
      const lineContent = lines[approximateLine - 1] || "";
      const firstNonWs = lineContent.search(/\S/);
      location.column = firstNonWs >= 0 ? firstNonWs + 1 : 1;

      return location;
    }
  } catch (e) {
    logger.debug(
      `Error finding syntax error location: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  // If all else fails, default to first line
  location.line = 1;
  location.column = 1;

  return location;
}

/**
 * Create an error with appropriate context from a node
 */
export async function createErrorFromNode(
  node: NodeWithMeta | null | undefined,
  message: string,
  errorType: string,
  filePath: string,
): Promise<HQLError> {
  const location = getSourceLocation(node);

  // Use provided filePath if location doesn't have one
  if (!location.filePath) {
    location.filePath = filePath;
  }

  const error = new HQLError(
    message,
    {
      errorType,
      sourceLocation: {
        filePath: location.filePath,
        line: location.line,
        column: location.column,
      },
    },
  );

  // Add context lines if possible
  if (location.line && location.filePath) {
    const contextLines = await loadContextLines(
      location.filePath,
      location.line,
    );
    if (contextLines) {
      error.contextLines = contextLines;

      // Update column in error line if available
      if (location.column) {
        const errorLine = error.contextLines.find((line) =>
          line.line === location.line && line.isError
        );
        if (errorLine) {
          errorLine.column = location.column;
        }
      }
    }
  }

  return error;
}

// Helper to escape special regex characters

/**
 * Handle a function call error with detailed source information
 */
export async function handleFunctionCallError(
  fnName: string,
  error: Error,
  args: unknown[],
  filePath: string,
  position?: { line?: number; column?: number },
): Promise<Error> {
  let message = `Error calling function '${fnName}': ${error.message}`;

  if (args.length > 0) {
    const argStrings = args.map((arg) => {
      if (isNullish(arg)) return "null";
      if (typeof arg === "object") {
        const node = arg as { type?: string; name?: string; value?: unknown };
        if (node.type === "symbol" && typeof node.name === "string") {
          return `'${node.name}'`;
        }
        if (node.type === "literal") {
          const literalValue = node.value;
          if (typeof literalValue === "string") return `"${literalValue}"`;
          return String(literalValue);
        }
        return node.type ?? "object";
      }
      return String(arg);
    });

    message += `\nWith arguments: ${argStrings.join(", ")}`;
  }

  const tooManyArgs = error.message.includes("Too many") &&
    error.message.includes("arguments");
  if (tooManyArgs) {
    const expectedMatch = error.message.match(/(\d+) arguments?/);
    const expectedCount = expectedMatch ? Number(expectedMatch[1]) : null;

    if (expectedCount !== null) {
      message +=
        `\nExpected ${expectedCount} argument(s) for function '${fnName}'`;
      const extraArgs = args.slice(expectedCount);
      if (extraArgs.length > 0) {
        const extraArgStrs = extraArgs.map((arg) => {
          if (isObjectValue(arg)) {
            const node = arg as {
              type?: string;
              name?: string;
              value?: unknown;
            };
            if (node.type === "symbol" && typeof node.name === "string") {
              return `'${node.name}'`;
            }
            if (node.type === "literal") {
              const value = node.value;
              if (typeof value === "string") return `"${value}"`;
              return String(value);
            }
            return node.type ?? "object";
          }
          return String(arg);
        });
        message += `\nExtra arguments: ${extraArgStrs.join(", ")}`;
      }
    }
  }

  const missingArgs = error.message.includes("Missing") &&
    error.message.includes("argument");

  const runtimeError = await handleErrorWithSourceLocation<RuntimeError>({
    filePath,
    position,
    locators: [
      async () => {
        const symbolLocation = await findSymbolLocation(fnName, filePath);
        return symbolLocation.line || symbolLocation.column
          ? symbolLocation
          : undefined;
      },
    ],
    createError: (location) => new RuntimeError(message, location),
    afterCreate: (err) => {
      if (tooManyArgs) {
        err.getSuggestion = () =>
          `Check the number of arguments you're passing to function '${fnName}'. You might be passing more arguments than expected.`;
      } else if (missingArgs) {
        err.getSuggestion = () =>
          `Make sure you provide all required arguments to function '${fnName}'.`;
      } else {
        err.getSuggestion = () =>
          `Check the function call syntax and argument types for '${fnName}'.`;
      }
    },
  });

  return runtimeError;
}

/**
 * Find the location of a function call with too many arguments
 * This is an enhancement to findErrorLocation that specifically targets function calls
 */
export async function findFunctionCallLocation(
  functionName: string,
  filePath: string,
  expectedArgs: number,
  actualArgs: number,
): Promise<SourceLocation> {
  if (actualArgs <= expectedArgs) {
    return await findSymbolLocation(functionName, filePath);
  }

  const location: SourceLocation = {
    filePath,
  };

  try {
    if (!await exists(filePath)) {
      logger.debug(
        `Cannot find function call: File does not exist: ${filePath}`,
      );
      return location;
    }

    const content = await readTextFile(filePath);
    const lines = content.split("\n");

    // Construct a regex pattern to find the function call
    // This will look for patterns like (functionName arg1 arg2 ...)
    const funcCallPattern = new RegExp(
      `\\(\\s*${escapeRegExp(functionName)}\\s+`,
    );

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (funcCallPattern.test(line)) {
        // Found a function call, now check if it has the right number of arguments
        const openParenPos = line.indexOf("(");
        const functionPos = line.indexOf(functionName, openParenPos);

        if (functionPos >= 0) {
          let cursor = functionPos + functionName.length;
          let argCount = 0;
          let extraArgColumn: number | null = null;

          while (cursor < line.length) {
            while (cursor < line.length && /\s/.test(line[cursor])) {
              cursor++;
            }
            if (cursor >= line.length || line[cursor] === ")") {
              break;
            }

            argCount++;
            if (argCount === expectedArgs + 1) {
              extraArgColumn = cursor + 1;
            }

            if (line[cursor] === "(") {
              let depth = 1;
              cursor++;
              while (depth > 0 && cursor < line.length) {
                if (line[cursor] === "(") depth++;
                else if (line[cursor] === ")") depth--;
                cursor++;
              }
            } else if (line[cursor] === '"') {
              cursor++;
              while (cursor < line.length && line[cursor] !== '"') {
                if (line[cursor] === "\\") cursor += 2;
                else cursor++;
              }
              if (cursor < line.length) cursor++;
            } else {
              while (cursor < line.length && !/[\s)]/.test(line[cursor])) {
                cursor++;
              }
            }
          }

          // If this function call has too many arguments, it's likely the one we're looking for
          if (argCount >= actualArgs) {
            location.line = i + 1;
            location.column = extraArgColumn ??
              (functionPos + functionName.length + 1);
            return location;
          }
        }
      }
    }

    // Fallback to finding just the function name if we couldn't find the specific call
    return await findSymbolLocation(functionName, filePath);
  } catch (error) {
    logger.debug(
      `Error finding function call location: ${
        getErrorMessage(error)
      }`,
    );
    return location;
  }
}
