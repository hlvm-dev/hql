// modules/bundler.ts

import { join, resolve, dirname } from "../platform/platform.ts";
import { readTextFile } from "../platform/platform.ts";
import { parse } from "./parser.ts";

/**
 * Cache for module contents: maps absolute file paths to their filtered source.
 */
type ModuleCache = Map<string, string>;

/**
 * Dependency graph mapping a module (absolute path) to a set of its dependencies.
 */
type DependencyGraph = Map<string, Set<string>>;

/**
 * Recursively processes a HQL module:
 *   - Reads its source,
 *   - Removes import forms,
 *   - And records dependencies.
 *
 * @param filePath The HQL file path to process.
 * @param cache A map to cache module source code.
 * @param graph A dependency graph mapping file paths to their dependencies.
 * @param visited A set to track visited modules (to avoid cycles).
 */
async function bundleModule(
  filePath: string,
  cache: ModuleCache,
  graph: DependencyGraph,
  visited: Set<string>
): Promise<void> {
  const absPath = resolve(filePath);
  if (visited.has(absPath)) return;
  visited.add(absPath);

  let source: string;
  try {
    source = await readTextFile(absPath);
  } catch (err) {
    throw new Error(`Error reading file "${absPath}": ${err.message}`);
  }

  let forms;
  try {
    forms = parse(source);
  } catch (err) {
    throw new Error(`Error parsing file "${absPath}": ${err.message}`);
  }

  if (!graph.has(absPath)) {
    graph.set(absPath, new Set<string>());
  }

  // Look for top-level import forms.
  for (const form of forms) {
    if (form.type === "list" && form.value.length > 0) {
      const first = form.value[0];
      if (first.type === "symbol" && first.name === "import") {
        const impAst = form.value[1];
        if (impAst && impAst.type === "string") {
          const depPath = resolve(join(dirname(absPath), impAst.value));
          graph.get(absPath)?.add(depPath);
          await bundleModule(depPath, cache, graph, visited);
        }
      }
    }
  }

  // Remove all import forms from the source.
  const filteredSource = source.replace(/\(import\s+["'][^"']+["']\)/g, "").trim();
  cache.set(absPath, filteredSource);
}

/**
 * Bundles an entry HQL file (and all its dependencies) into one single string.
 *
 * @param entryPath The entry HQL file.
 * @returns A Promise that resolves to the bundled HQL code.
 */
export async function bundleHql(entryPath: string): Promise<string> {
  const cache: ModuleCache = new Map();
  const graph: DependencyGraph = new Map();
  const visited: Set<string> = new Set();

  await bundleModule(entryPath, cache, graph, visited);

  // Topologically sort the modules using Kahn’s algorithm.
  const inDegree = new Map<string, number>();
  for (const [node, deps] of graph) {
    if (!inDegree.has(node)) inDegree.set(node, 0);
    for (const dep of deps) {
      inDegree.set(dep, (inDegree.get(dep) || 0) + 1);
    }
  }
  const queue: string[] = [];
  for (const [node, degree] of inDegree) {
    if (degree === 0) queue.push(node);
  }
  const sorted: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);
    for (const dep of graph.get(node) || []) {
      inDegree.set(dep, inDegree.get(dep)! - 1);
      if (inDegree.get(dep)! === 0) {
        queue.push(dep);
      }
    }
  }

  if (sorted.length !== inDegree.size) {
    throw new Error("Cyclic dependency detected in HQL modules");
  }

  // Concatenate module contents in sorted order.
  let bundled = "";
  for (const modulePath of sorted) {
    const content = cache.get(modulePath);
    if (content) {
      // Use semicolon-based comments.
      bundled += `\n; Module: ${modulePath}\n${content}\n`;
    }
  }

  return bundled.trim();
}
