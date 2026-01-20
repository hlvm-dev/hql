import { transpileToJavascript } from "./transpiler/hql-transpiler.ts";
import { transpile, type TranspileOptions } from "./transpiler/index.ts";
import { TranspilerError } from "../common/error.ts";
import { ERROR_REPORTED_SYMBOL } from "../common/error-codes.ts";
import {
  escapeRegExp,
  getErrorMessage,
  isObjectValue,
  sanitizeIdentifier,
} from "../common/utils.ts";
import { getPlatform } from "../platform/platform.ts";
import { globalLogger as logger } from "../logger.ts";

const p = () => getPlatform();
const pathUtil = () => p().path;
const fsUtil = () => p().fs;

const RUNTIME_GET_SNIPPET = `// Runtime get function for HQL
function get(obj, key) {
  // If obj is a function, call it with the key as argument
  if (typeof obj === 'function') {
    return obj(key);
  }
  // Otherwise, treat it as property access
  return obj[key];
}

`;

function propagateReportedFlag(source: unknown, target: object): void {
  if (isObjectValue(source)) {
    if (Reflect.get(source, ERROR_REPORTED_SYMBOL)) {
      Reflect.set(target, ERROR_REPORTED_SYMBOL, true);
    }
  }
}

function wrapError(error: unknown, message: string): TranspilerError {
  const newError = new TranspilerError(`${message}: ${getErrorMessage(error)}`);
  propagateReportedFlag(error, newError);
  return newError;
}

export async function transpileHqlFile(
  hqlFilePath: string,
  sourceDir: string = "",
  verbose: boolean = false,
): Promise<string> {
  try {
    const hqlContent = await fsUtil().readTextFile(hqlFilePath);

    if (verbose) {
      logger.debug(`Transpiling HQL file: ${hqlFilePath}`);
    }

    const options: TranspileOptions = {
      verbose,
      baseDir: pathUtil().dirname(hqlFilePath),
      currentFile: hqlFilePath,
    };

    if (sourceDir) {
      options.sourceDir = sourceDir;
    }

    const result = await transpile(hqlContent, options);

    return result.code;
  } catch (error) {
    throw wrapError(error, `Error transpiling HQL for JS import ${hqlFilePath}`);
  }
}

export async function transpileHqlInJs(
  hqlPath: string,
  basePath: string,
): Promise<string> {
  try {
    const hqlContent = await fsUtil().readTextFile(hqlPath);

    const { code: jsContent } = await transpileToJavascript(hqlContent, {
      baseDir: pathUtil().dirname(hqlPath),
      sourceDir: basePath,
      currentFile: hqlPath,
      sourceContent: hqlContent,
    });

    const identifiersToSanitize = new Map<string, string>();

    const exportMatches = jsContent.matchAll(
      /export\s+(const|let|var|function)\s+([a-zA-Z0-9_-]+)/g,
    );
    for (const match of exportMatches) {
      const exportName = match[2];
      if (exportName.includes("-")) {
        identifiersToSanitize.set(exportName, sanitizeIdentifier(exportName));
      }
    }

    const importMatches = jsContent.matchAll(
      /import\s+\*\s+as\s+([a-zA-Z0-9_-]+)\s+from/g,
    );
    for (const match of importMatches) {
      const importName = match[1];
      if (importName.includes("-")) {
        identifiersToSanitize.set(importName, sanitizeIdentifier(importName));
      }
    }

    let processedContent = jsContent;
    if (identifiersToSanitize.size > 0) {
      const sortedIdentifiers = Array.from(identifiersToSanitize.keys())
        .sort((a, b) => b.length - a.length);
      const escapedIdentifiers = sortedIdentifiers.map(escapeRegExp);

      const identifierPattern = new RegExp(
        `\\b(${escapedIdentifiers.join("|")})(\\b|\\.)`,
        "g",
      );

      processedContent = processedContent.replace(
        identifierPattern,
        (match, identifier, suffix) => {
          const sanitized = identifiersToSanitize.get(identifier);
          return sanitized ? sanitized + suffix : match;
        },
      );
    }

    return RUNTIME_GET_SNIPPET + processedContent;
  } catch (error) {
    throw new Error(
      `Error transpiling HQL for JS import ${hqlPath}: ${getErrorMessage(error)}`,
    );
  }
}
