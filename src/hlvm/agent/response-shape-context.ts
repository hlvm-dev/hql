import { fnv1aHex } from "../../common/hash.ts";
import { canonicalizeForSignature } from "./orchestrator-tool-formatting.ts";

export interface ExecutionResponseShapeContext {
  requested: boolean;
  source: "none" | "request" | "task-text";
  schemaSignature?: string;
  topLevelKeys: string[];
}

export const EMPTY_EXECUTION_RESPONSE_SHAPE_CONTEXT:
  ExecutionResponseShapeContext = {
    requested: false,
    source: "none",
    topLevelKeys: [],
  };

function uniqueSortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export function deriveExecutionResponseShapeContextFromSchema(
  schema: Record<string, unknown> | undefined,
): ExecutionResponseShapeContext {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { ...EMPTY_EXECUTION_RESPONSE_SHAPE_CONTEXT };
  }

  const canonical = canonicalizeForSignature(schema);
  const schemaSignature = fnv1aHex(JSON.stringify(canonical) ?? "null");
  const topLevelKeys = uniqueSortedStrings(Object.keys(schema));

  return {
    requested: true,
    source: "request",
    schemaSignature,
    topLevelKeys,
  };
}

export function normalizeExecutionResponseShapeContext(
  value: unknown,
): ExecutionResponseShapeContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...EMPTY_EXECUTION_RESPONSE_SHAPE_CONTEXT };
  }

  const record = value as Record<string, unknown>;
  const requested = record.requested === true;
  const source = record.source === "request"
    ? "request"
    : record.source === "task-text"
    ? "task-text"
    : "none";
  const schemaSignature = typeof record.schemaSignature === "string" &&
      record.schemaSignature.trim().length > 0
    ? record.schemaSignature
    : undefined;
  const topLevelKeys = Array.isArray(record.topLevelKeys)
    ? uniqueSortedStrings(
      record.topLevelKeys.filter((entry): entry is string =>
        typeof entry === "string" && entry.trim().length > 0
      ),
    )
    : [];

  if (!requested && !schemaSignature && topLevelKeys.length === 0) {
    return { ...EMPTY_EXECUTION_RESPONSE_SHAPE_CONTEXT };
  }

  return {
    requested,
    source,
    ...(schemaSignature ? { schemaSignature } : {}),
    topLevelKeys,
  };
}

export function summarizeExecutionResponseShapeContext(
  context: ExecutionResponseShapeContext | undefined,
): string {
  if (!context?.requested) {
    return "no structured response schema on the last auto turn";
  }

  const keySummary = context.topLevelKeys.length > 0
    ? context.topLevelKeys.join(", ")
    : "no top-level keys";
  return `requested · keys=${keySummary}${
    context.schemaSignature ? ` · sig=${context.schemaSignature}` : ""
  }`;
}
