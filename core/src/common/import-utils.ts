// src/utils/import-utils.ts - Centralized import utilities to improve code organization
import { HQLNode, isImportNode } from "../transpiler/type/hql_ast.ts";
import { Environment } from "../environment.ts";
import { globalLogger, Logger } from "../logger.ts";

export const importSourceRegistry = new Map<string, string>();

/**
 * Check if a path is a remote URL
 */
export function isRemoteUrl(path: string): boolean {
  return path.startsWith("http://") || path.startsWith("https://");
}

/**
 * Check if a module path represents a remote module (npm:, jsr:, http:, https:)
 */
export function isRemoteModule(modulePath: string): boolean {
  return modulePath.startsWith("npm:") ||
    modulePath.startsWith("jsr:") ||
    modulePath.startsWith("http:") ||
    modulePath.startsWith("https:");
}

/**
 * Check if a file path is an HQL file
 */
export function isHqlFile(filePath: string): boolean {
  return filePath.endsWith(".hql");
}

/**
 * Check if a file path is a TypeScript file
 */
export function isTypeScriptFile(filePath: string): boolean {
  return filePath.endsWith(".ts") || filePath.endsWith(".tsx");
}

/**
 * Check if a file path is a JavaScript file
 */
export function isJsFile(filePath: string): boolean {
  return filePath.endsWith(".js") || filePath.endsWith(".mjs") ||
    filePath.endsWith(".cjs");
}

/**
 * Extract import information from an import node
 * Returns [moduleName, importPath] or [null, null] if not an import
 */
export function extractImportInfo(
  node: HQLNode,
): [string | null, string | null] {
  try {
    if (node.type === "list" && node.elements[0].type === "symbol") {
      // Handle namespace imports: (import name from "path")
      if (
        node.elements[0].name === "import" &&
        node.elements.length === 4 &&
        node.elements[1].type === "symbol" &&
        node.elements[2].type === "symbol" &&
        node.elements[2].name === "from" &&
        node.elements[3].type === "literal"
      ) {
        return [node.elements[1].name, node.elements[3].value as string];
      }
    }
  } catch {
    // If anything fails, return null values
  }

  return [null, null];
}

/**
 * Determine if a module is external and needs to be imported
 */
function isModuleExternal(
  moduleName: string,
  env: Environment,
  logger: Logger,
): boolean {
  // Check if this module is already registered as an import
  if (importSourceRegistry.has(moduleName)) {
    return true;
  }

  try {
    // Try to determine if it's a JavaScript global
    if (typeof globalThis !== "undefined" && moduleName in globalThis) {
      logger.debug(`Module ${moduleName} identified as global, not external`);
      return false;
    }

    // Check if it's defined in the environment
    try {
      env.lookup(moduleName);
      logger.debug(`Module ${moduleName} found in environment, not external`);
      return false;
    } catch {
      // Not defined in env, continue checking
    }

    // Check if it's a macro
    if (env.hasMacro(moduleName)) {
      logger.debug(`Module ${moduleName} identified as macro, not external`);
      return false;
    }

    // If we got here, it's likely an external module
    logger.debug(`Module ${moduleName} identified as external module`);
    return true;
  } catch {
    // If anything fails, assume it could be external just to be safe
    logger.debug(`Error checking module ${moduleName}, assuming external`);
    return true;
  }
}

/**
 * Register a module path in the import registry
 */
export function registerModulePath(
  moduleName: string,
  modulePath: string,
): void {
  importSourceRegistry.set(moduleName, modulePath);
}

/**
 * Find all existing imports in the AST
 */
export function findExistingImports(nodes: HQLNode[]): Map<string, string> {
  const imports = new Map<string, string>();

  for (const node of nodes) {
    if (isImportNode(node)) {
      const [moduleName, importPath] = extractImportInfo(node);
      if (moduleName && importPath) {
        imports.set(moduleName, importPath);
      }
    }
  }

  return imports;
}

/**
 * Find which modules are external and require imports
 */
export function findExternalModuleReferences(
  nodes: HQLNode[],
  env: Environment,
): Set<string> {
  const externalModules = new Set<string>();

  function traverse(node: HQLNode) {
    if (node.type === "list") {
      const elements = node.elements;

      // Check for js-call pattern
      if (
        elements.length >= 3 &&
        elements[0].type === "symbol" &&
        elements[0].name === "js-call" &&
        elements[1].type === "symbol"
      ) {
        const moduleName = elements[1].name;
        if (isModuleExternal(moduleName, env, globalLogger)) {
          externalModules.add(moduleName);
        }
      }

      // Check for js-get pattern
      if (
        elements.length >= 3 &&
        elements[0].type === "symbol" &&
        elements[0].name === "js-get" &&
        elements[1].type === "symbol"
      ) {
        const moduleName = elements[1].name;
        if (isModuleExternal(moduleName, env, globalLogger)) {
          externalModules.add(moduleName);
        }
      }

      // Nested js-call patterns
      if (
        elements.length >= 3 &&
        elements[0].type === "symbol" &&
        elements[0].name === "js-call" &&
        elements[1].type === "list" &&
        elements[1].elements.length >= 3 &&
        elements[1].elements[0].type === "symbol" &&
        elements[1].elements[0].name === "js-get" &&
        elements[1].elements[1].type === "symbol"
      ) {
        const moduleName = elements[1].elements[1].name;
        if (isModuleExternal(moduleName, env, globalLogger)) {
          externalModules.add(moduleName);
        }
      }

      // Recursively check all elements
      elements.forEach(traverse);
    }
  }

  nodes.forEach(traverse);
  return externalModules;
}
