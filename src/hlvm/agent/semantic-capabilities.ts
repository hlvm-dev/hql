export const SEMANTIC_CAPABILITY_IDS = [
  "web.search",
  "web.read",
  "vision.analyze",
  "code.exec",
  "structured.output",
] as const;

export type SemanticCapabilityId = (typeof SEMANTIC_CAPABILITY_IDS)[number];

const SEMANTIC_CAPABILITY_ID_SET = new Set<string>(SEMANTIC_CAPABILITY_IDS);
const MCP_SEMANTIC_CAPABILITY_METADATA_KEYS = [
  "hlvmSemanticCapabilities",
  "hlvm.semantic_capabilities",
] as const;

export function normalizeSemanticCapabilityId(
  value: unknown,
): SemanticCapabilityId | undefined {
  return typeof value === "string" && SEMANTIC_CAPABILITY_ID_SET.has(value)
    ? value as SemanticCapabilityId
    : undefined;
}

export function normalizeSemanticCapabilityIds(
  value: unknown,
): SemanticCapabilityId[] | undefined {
  const values = Array.isArray(value) ? value : [value];
  const normalized = values
    .map(normalizeSemanticCapabilityId)
    .filter((entry): entry is SemanticCapabilityId => !!entry);
  return normalized.length > 0 ? [...new Set(normalized)] : undefined;
}

export function readSemanticCapabilitiesFromMetadata(
  metadata?: Record<string, unknown>,
): SemanticCapabilityId[] | undefined {
  if (!metadata) return undefined;
  for (const key of MCP_SEMANTIC_CAPABILITY_METADATA_KEYS) {
    const normalized = normalizeSemanticCapabilityIds(metadata[key]);
    if (normalized) return normalized;
  }
  return undefined;
}
