import { detectSearchQueryIntent } from "./tools/web/query-strategy.ts";

export const WEB_RESEARCH_TOOL_ALLOWLIST = [
  "search_web",
  "web_fetch",
  "fetch_url",
  "render_url",
  "mcp_playwright_render_url",
  "memory_search",
  "memory_write",
  "memory_edit",
  "ask_user",
  "complete_task",
] as const;

const URL_RE = /\bhttps?:\/\/\S+/i;
const DOMAIN_RE =
  /\b(?:www\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.(?:com|org|net|io|ai|dev|app|co|edu|gov|me|news|blog|tv|gg|ly|fm|sh|us|uk|ca|de|fr|jp|kr|au|in)\b/i;
const LOCAL_PATH_RE = /(?:^|[\s("'`])(?:\.{1,2}\/|~\/|\/[^\s]+)/;
const STRONG_LOCAL_CONTEXT_RE =
  /\b(?:repo|repository|codebase|src|tests?|path|file|files|directory|directories|search code|read file|open file|inspect code)\b/i;
const AMBIGUOUS_CODE_CONTEXT_RE =
  /\b(?:code|source|function|class|symbol|module|import|export|refactor|compile|build|lint)\b/i;
const EXPLICIT_WEB_ONLY_RE =
  /\b(?:public web only|web only|from the web|citations from the web|do not inspect local files|don't inspect local files|do not inspect repository code|don't inspect repository code|do not inspect local files or repository code|don't inspect local files or repository code|ignore local files|ignore repository code)\b/i;
const WEB_ACTION_RE =
  /\b(?:go to|visit|browse|open|look up|check|read|find|search)\b/i;
const WEB_CONTEXT_RE =
  /\b(?:website|web|site|page|pages|homepage|docs|documentation|release notes|changelog|announcement|news)\b/i;
const WEB_INSTRUCTION_SEGMENT_RE =
  /\b(?:search the public web|public web only|use web search|answer with citations|cite sources|citations from the web|from the web|do not inspect|don't inspect|local files|repository code|repo code)\b/i;
const QUESTION_SEGMENT_RE =
  /^(?:what|how|why|when|where|which|who|compare|explain|find|latest|current)\b/i;

function uniqueTools(tools?: readonly string[]): string[] | undefined {
  return tools?.length ? [...new Set(tools)] : undefined;
}

function normalizeQueryText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function scoreWebQuerySegment(segment: string): number {
  const normalized = normalizeQueryText(segment);
  if (!normalized) return Number.NEGATIVE_INFINITY;

  let score = 0;
  if (QUESTION_SEGMENT_RE.test(normalized)) score += 4;
  if (normalized.endsWith("?")) score += 3;
  if (normalized.split(/\s+/).length >= 4) score += 1;
  if (normalized.length >= 16 && normalized.length <= 180) score += 1;
  if (WEB_INSTRUCTION_SEGMENT_RE.test(normalized)) score -= 6;
  return score;
}

function shouldPreserveSearchIntentQualifier(segment: string): boolean {
  const normalized = normalizeQueryText(segment);
  if (!normalized || WEB_INSTRUCTION_SEGMENT_RE.test(normalized)) return false;
  const intent = detectSearchQueryIntent(normalized);
  return intent.wantsOfficialDocs ||
    intent.wantsReference ||
    intent.wantsReleaseNotes ||
    intent.wantsRecency ||
    intent.wantsVersionSpecific;
}

export function extractWebSearchQueryCandidate(request: string): string {
  const normalized = normalizeQueryText(request);
  if (!normalized) return normalized;

  const segments = normalized
    .split(/\s*(?:\n+|(?<=[.!?])\s+|:\s+)\s*/)
    .map(normalizeQueryText)
    .filter((segment) => segment.length > 0);

  let bestSegment = "";
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestSegmentIndex = -1;
  for (const [index, segment] of segments.entries()) {
    const score = scoreWebQuerySegment(segment);
    if (score > bestScore) {
      bestSegment = segment;
      bestScore = score;
      bestSegmentIndex = index;
    }
  }

  if (bestSegment && bestScore > 0) {
    const preservedQualifiers = segments
      .slice(0, Math.max(0, bestSegmentIndex))
      .filter(shouldPreserveSearchIntentQualifier);
    if (preservedQualifiers.length > 0) {
      return normalizeQueryText([...preservedQualifiers, bestSegment].join(" "));
    }
    return bestSegment;
  }

  return normalized;
}

export function getQueryToolAllowlist(query: string): string[] | undefined {
  const trimmed = query.trim();
  if (!trimmed) return undefined;

  if (URL_RE.test(trimmed) || DOMAIN_RE.test(trimmed)) {
    return uniqueTools(WEB_RESEARCH_TOOL_ALLOWLIST);
  }

  const explicitWebOnly = EXPLICIT_WEB_ONLY_RE.test(trimmed);
  const intent = detectSearchQueryIntent(trimmed);
  const hasStrongLocalContext = LOCAL_PATH_RE.test(trimmed) ||
    STRONG_LOCAL_CONTEXT_RE.test(trimmed);
  if (hasStrongLocalContext && !explicitWebOnly) {
    return undefined;
  }

  const hasAmbiguousCodeContext = AMBIGUOUS_CODE_CONTEXT_RE.test(trimmed);
  if (
    hasAmbiguousCodeContext &&
    !explicitWebOnly &&
    !(intent.wantsOfficialDocs || intent.wantsReference) &&
    !(WEB_ACTION_RE.test(trimmed) && WEB_CONTEXT_RE.test(trimmed))
  ) {
    return undefined;
  }

  const wantsWebResearch = explicitWebOnly ||
    (WEB_ACTION_RE.test(trimmed) && WEB_CONTEXT_RE.test(trimmed)) ||
    intent.wantsOfficialDocs ||
    intent.wantsReference ||
    intent.wantsReleaseNotes ||
    intent.wantsRecency;

  return wantsWebResearch
    ? uniqueTools(WEB_RESEARCH_TOOL_ALLOWLIST)
    : undefined;
}

export function resolveQueryToolAllowlist(
  query: string,
  userAllowlist?: string[],
): string[] | undefined {
  return uniqueTools(userAllowlist) ?? getQueryToolAllowlist(query);
}

export function isWebResearchOnlyAllowlist(
  allowlist?: readonly string[],
): boolean {
  if (!allowlist?.length) return false;
  if (!allowlist.includes("search_web")) return false;
  const allowedTools = new Set<string>(WEB_RESEARCH_TOOL_ALLOWLIST);
  return allowlist.every((toolName) => allowedTools.has(toolName));
}

export function shouldShortCircuitWeakTierWebQuery(
  query: string,
  allowlist?: readonly string[],
): boolean {
  if (isWebResearchOnlyAllowlist(allowlist)) return true;
  return isWebResearchOnlyAllowlist(getQueryToolAllowlist(query));
}
