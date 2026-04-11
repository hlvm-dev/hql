/**
 * Memory Store - Shared utilities for the canonical memory DB.
 *
 * Concerns:
 * 1. Whitespace normalization — shared by facts.ts, pipeline.ts, extract.ts
 * 2. PII sanitization — used by facts.ts before DB insert
 * 3. Date helper — used by facts.ts, entities.ts
 * 4. Logger helper — used by facts.ts, manager.ts
 */

// ============================================================
// Whitespace Normalization — SSOT for collapsing whitespace
// ============================================================

/** Collapse all whitespace runs to a single space and trim. */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// ============================================================
// Logger Helper — DRY wrapper for optional agent logger
// ============================================================

export async function warnMemory(msg: string): Promise<void> {
  try {
    const { getAgentLogger } = await import("../agent/logger.ts");
    getAgentLogger().warn(msg);
  } catch { /* Logger not available */ }
}

// ============================================================
// Date
// ============================================================

export function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

// ============================================================
// Sensitive Content Filter
// ============================================================

const SENSITIVE_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g, label: "SSN" },
  { pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, label: "credit card" },
  { pattern: /\b(sk|pk|api[_-]?key|secret)[_-]?\w{20,}/gi, label: "API key" },
  { pattern: /(password|passwd|pwd)\s*[:=]\s*\S+/gi, label: "password" },
];

/**
 * Strip sensitive content from text before writing to memory.
 * Returns sanitized text and a list of what was stripped.
 */
export function sanitizeSensitiveContent(
  text: string,
): { sanitized: string; stripped: string[] } {
  const stripped: string[] = [];
  let sanitized = text;
  for (const { pattern, label } of SENSITIVE_PATTERNS) {
    const before = sanitized;
    sanitized = sanitized.replace(pattern, `[REDACTED:${label}]`);
    if (sanitized !== before) stripped.push(label);
  }
  return { sanitized, stripped };
}
