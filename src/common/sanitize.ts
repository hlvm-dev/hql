/**
 * PII / sensitive-content sanitization.
 *
 * Strips well-known patterns (API keys, SSN, credit cards, passwords,
 * private keys, etc.) from arbitrary text and returns a redacted version
 * plus a list of what was stripped.
 *
 * Used by:
 * - companion/redact.ts (chat redaction)
 * - memory/* (when serializing user-facing memory writes — kept as
 *   defensive HLVM hardening on top of CC parity behavior)
 */

const SENSITIVE_PATTERNS: { pattern: RegExp; label: string }[] = [
  // SSN: 3-2-4 with mandatory separators, OR exactly 9 consecutive digits
  { pattern: /(?<!\d)(?:\d{3}[-\.]\d{2}[-\.]\d{4}|\d{9})(?!\d)/g, label: "SSN" },
  // Credit card: 4 groups of 4 digits
  { pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, label: "credit card" },
  // API keys: common prefixes (sk_, pk_, ghp_, AKIA, glpat-, xoxb-, etc.)
  { pattern: /\b(sk|pk|api[_-]?key|secret)[_-]?\w{20,}/gi, label: "API key" },
  { pattern: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, label: "API key" },
  { pattern: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/g, label: "API key" },
  { pattern: /\bglpat-[A-Za-z0-9\-]{20,}\b/g, label: "API key" },
  // Bearer / JWT tokens
  { pattern: /\bBearer\s+[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_.+\/=]+/g, label: "auth token" },
  // Password assignments
  { pattern: /(password|passwd|pwd)\s*[:=]\s*\S+/gi, label: "password" },
  // Email addresses
  { pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g, label: "email" },
  // Phone numbers (US-style with separators)
  { pattern: /(?<!\d)(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?!\d)/g, label: "phone" },
  // Private keys
  { pattern: /-----BEGIN\s(?:RSA\s|EC\s|DSA\s|OPENSSH\s)?PRIVATE\sKEY-----[\s\S]*?-----END\s(?:RSA\s|EC\s|DSA\s|OPENSSH\s)?PRIVATE\sKEY-----/g, label: "private key" },
];

/**
 * Strip sensitive content from text. Returns sanitized text and a list of
 * pattern labels that matched (for logging / user warnings).
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
