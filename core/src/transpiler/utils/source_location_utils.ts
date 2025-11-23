// Utility helpers to resolve source locations from HQL AST nodes
import { SourceLocation } from "../../common/error.ts";

export interface SourceLocationOptions {
  index?: number;
  /**
   * When source is an array and the requested index is out of bounds,
   * fall back to the first element (default: true).
   */
  fallbackToFirst?: boolean;
  /**
   * Whether to drill into list nodes and arrays to find a nested location (default: true).
   */
  traverseNested?: boolean;
}

function formatLocation(candidate: unknown): SourceLocation | undefined {
  if (!candidate || typeof candidate !== "object") return undefined;

  const {
    filePath,
    line,
    column,
    endLine,
    endColumn,
  } = candidate as Record<string, unknown>;

  const hasData = filePath !== undefined ||
    line !== undefined ||
    column !== undefined ||
    endLine !== undefined ||
    endColumn !== undefined;

  if (!hasData) return undefined;

  const location: SourceLocation = {
    filePath: typeof filePath === "string" ? filePath : "",
  };

  if (typeof line === "number") location.line = line;
  if (typeof column === "number") location.column = column;
  if (typeof endLine === "number") location.endLine = endLine;
  if (typeof endColumn === "number") location.endColumn = endColumn;

  return location;
}

function pickArrayNode(
  array: unknown[],
  options: SourceLocationOptions,
): unknown | undefined {
  if (array.length === 0) return undefined;
  const idx = options.index ?? 0;
  if (idx >= 0 && idx < array.length) {
    return array[idx];
  }
  return options.fallbackToFirst === false ? undefined : array[0];
}

function resolveFromNode(
  node: unknown,
  options: SourceLocationOptions,
  visited: Set<unknown>,
): SourceLocation | undefined {
  if (!node || typeof node !== "object") return undefined;
  if (visited.has(node)) return undefined;
  visited.add(node);

  const candidateOrder: unknown[] = [
    (node as Record<string, unknown>)._meta,
    (node as Record<string, unknown>).meta,
    (node as Record<string, unknown>).sourceLocation,
    (node as Record<string, unknown>).location,
    (node as Record<string, unknown>).position,
    node,
  ];

  for (const candidate of candidateOrder) {
    const location = formatLocation(candidate);
    if (location) return location;
  }

  if (options.traverseNested === false) return undefined;

  if (Array.isArray(node)) {
    for (const item of node) {
      const location = resolveFromNode(item, options, visited);
      if (location) return location;
    }
  }

  const elements = (node as { elements?: unknown[] }).elements;
  if (Array.isArray(elements)) {
    for (const item of elements) {
      const location = resolveFromNode(item, options, visited);
      if (location) return location;
    }
  }

  return undefined;
}

export function resolveSourceLocation(
  source: unknown,
  options: SourceLocationOptions = {},
): SourceLocation {
  const visited = new Set<unknown>();
  const normalizedOptions: SourceLocationOptions = {
    fallbackToFirst: options.fallbackToFirst ?? true,
    traverseNested: options.traverseNested ?? true,
    index: options.index,
  };

  let node = source;
  if (Array.isArray(source)) {
    node = pickArrayNode(source, normalizedOptions);
  }

  const directLocation = resolveFromNode(node, normalizedOptions, visited);
  if (directLocation) {
    return directLocation;
  }

  if (Array.isArray(source) && normalizedOptions.traverseNested !== false) {
    for (const item of source) {
      const loc = resolveFromNode(item, normalizedOptions, visited);
      if (loc) return loc;
    }
  }

  return { filePath: "" };
}

export function extractMetaSourceLocation(
  source: unknown,
  options?: SourceLocationOptions,
): SourceLocation {
  return resolveSourceLocation(source, options);
}

export function withSourceLocationOpts(
  opts: Record<string, unknown> | undefined,
  node: unknown,
): Record<string, unknown> {
  const location = resolveSourceLocation(node);
  if (
    !location.filePath && location.line === undefined &&
    location.column === undefined
  ) {
    return opts || {};
  }
  return { ...(opts || {}), ...location };
}
