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
const CODE_CONTEXT_RE =
  /\b(?:repo|repository|codebase|code|source|src|tests?|function|class|symbol|module|import|export|refactor|compile|build|lint|path|file|files|directory|directories)\b/i;
const WEB_ACTION_RE =
  /\b(?:go to|visit|browse|open|look up|check|read|find|search)\b/i;
const WEB_CONTEXT_RE =
  /\b(?:website|web|site|page|pages|homepage|docs|documentation|release notes|changelog|announcement|news)\b/i;

function uniqueTools(tools?: readonly string[]): string[] | undefined {
  return tools?.length ? [...new Set(tools)] : undefined;
}

export function getQueryToolAllowlist(query: string): string[] | undefined {
  const trimmed = query.trim();
  if (!trimmed) return undefined;

  if (URL_RE.test(trimmed) || DOMAIN_RE.test(trimmed)) {
    return uniqueTools(WEB_RESEARCH_TOOL_ALLOWLIST);
  }

  const hasLocalContext = LOCAL_PATH_RE.test(trimmed) ||
    CODE_CONTEXT_RE.test(trimmed);
  if (hasLocalContext) {
    return undefined;
  }

  const intent = detectSearchQueryIntent(trimmed);
  const wantsWebResearch =
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
