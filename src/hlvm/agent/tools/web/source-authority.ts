import {
  isAllowedByDomainFilters,
  type SearchResult,
  type SearchResultSourceClass,
} from "./search-provider.ts";
import { analyzeResultUrl } from "./web-utils.ts";

export interface SearchSourceAuthority {
  sourceClass: SearchResultSourceClass;
  authorityScore: number;
  isAuthoritative: boolean;
  isCommunity: boolean;
}

const DOC_SUBDOMAIN_LABELS = new Set([
  "api",
  "developer",
  "developers",
  "dev",
  "doc",
  "docs",
  "help",
  "learn",
  "manual",
  "reference",
  "support",
]);
const DOC_PATH_SEGMENTS = new Set([
  "api",
  "doc",
  "docs",
  "guide",
  "guides",
  "learn",
  "manual",
  "reference",
  "references",
]);
const ARTICLE_PATH_SEGMENTS = new Set([
  "article",
  "articles",
  "blog",
  "blogs",
  "news",
  "post",
  "posts",
  "tutorial",
  "tutorials",
]);
const FORUM_PATH_SEGMENTS = new Set([
  "community",
  "discussion",
  "discussions",
  "forum",
  "forums",
  "q",
  "question",
  "questions",
  "thread",
  "threads",
]);
const FORUM_HOST_SUFFIXES = [
  "reddit.com",
  "stackoverflow.com",
  "stackexchange.com",
  "superuser.com",
];
const REPO_DOC_HOST_SUFFIXES = [
  "bitbucket.org",
  "github.com",
  "github.io",
  "gitlab.com",
  "readthedocs.io",
];
const TECHNICAL_ARTICLE_HOST_SUFFIXES = [
  "dev.to",
  "freecodecamp.org",
  "hashnode.dev",
  "hashnode.com",
  "logrocket.com",
  "medium.com",
  "smashingmagazine.com",
  "substack.com",
];
const ARTICLE_STYLE_SIGNAL_RE =
  /\b(?:complete guide|definitive guide|ultimate guide|best practices?|common mistakes?|pitfalls?|solutions?|how to use|how-to)\b/;

function hostMatchesSuffix(host: string, suffixes: readonly string[]): boolean {
  return suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function normalizeSearchText(value?: string): string {
  return value?.toLowerCase().replace(/\s+/g, " ").trim() ?? "";
}

function hasAnySegment(segments: readonly string[], candidates: ReadonlySet<string>): boolean {
  return segments.some((segment) => candidates.has(segment));
}

function hasDocLikeLocation(result: SearchResult): boolean {
  const analysis = analyzeResultUrl(result.url);
  if (!analysis) return false;
  const signalText = normalizeSearchText(
    [result.title, result.snippet, result.pageDescription].filter(Boolean).join(" "),
  );
  return hasAnySegment(analysis.subdomainLabels, DOC_SUBDOMAIN_LABELS) ||
    hasAnySegment(analysis.pathSegments, DOC_PATH_SEGMENTS) ||
    /\b(?:api|docs|documentation|manual|reference)\b/.test(signalText);
}

function hasForumLikeLocation(result: SearchResult): boolean {
  const analysis = analyzeResultUrl(result.url);
  if (!analysis) return false;
  return hostMatchesSuffix(analysis.hostWithoutWww, FORUM_HOST_SUFFIXES) ||
    hasAnySegment(analysis.subdomainLabels, new Set(["community", "discuss", "forum"])) ||
    hasAnySegment(analysis.pathSegments, FORUM_PATH_SEGMENTS);
}

function hasRepoDocLocation(result: SearchResult): boolean {
  const analysis = analyzeResultUrl(result.url);
  if (!analysis) return false;
  if (!hostMatchesSuffix(analysis.hostWithoutWww, REPO_DOC_HOST_SUFFIXES)) return false;
  return analysis.hostWithoutWww.endsWith(".github.io") ||
    hasAnySegment(analysis.pathSegments, new Set(["blob", "docs", "readme", "tree", "wiki"])) ||
    analysis.pathSegments.length > 0;
}

function hasTechnicalArticleLocation(result: SearchResult): boolean {
  const analysis = analyzeResultUrl(result.url);
  if (!analysis) return false;
  const signalText = normalizeSearchText(
    [result.title, result.snippet, result.pageDescription].filter(Boolean).join(" "),
  );
  return hostMatchesSuffix(analysis.hostWithoutWww, TECHNICAL_ARTICLE_HOST_SUFFIXES) ||
    hasAnySegment(analysis.pathSegments, ARTICLE_PATH_SEGMENTS) ||
    ARTICLE_STYLE_SIGNAL_RE.test(signalText);
}

function scoreForSourceClass(sourceClass: SearchResultSourceClass): number {
  switch (sourceClass) {
    case "official_docs":
      return 5;
    case "vendor_docs":
      return 4;
    case "repo_docs":
      return 3;
    case "technical_article":
      return 1.5;
    case "other":
      return 1;
    case "forum":
      return 0.25;
  }
}

export function classifySearchResultSource(
  result: SearchResult,
  allowedDomains?: string[],
): SearchSourceAuthority {
  if (result.sourceClass) {
    return {
      sourceClass: result.sourceClass,
      authorityScore: scoreForSourceClass(result.sourceClass),
      isAuthoritative: result.sourceClass === "official_docs" ||
        result.sourceClass === "vendor_docs" ||
        result.sourceClass === "repo_docs",
      isCommunity: result.sourceClass === "technical_article" ||
        result.sourceClass === "forum",
    };
  }

  const analysis = analyzeResultUrl(result.url);
  const host = analysis?.hostWithoutWww;
  const onAllowedDomain = host && allowedDomains?.length
    ? isAllowedByDomainFilters(host, allowedDomains, undefined)
    : false;
  const forumLike = hasForumLikeLocation(result);
  const repoDocLike = hasRepoDocLocation(result);
  const technicalArticleLike = hasTechnicalArticleLocation(result);
  const docLike = hasDocLikeLocation(result);

  const sourceClass: SearchResultSourceClass = onAllowedDomain
    ? "official_docs"
    : forumLike
    ? "forum"
    : repoDocLike
    ? "repo_docs"
    : docLike && !technicalArticleLike
    ? "vendor_docs"
    : technicalArticleLike
    ? "technical_article"
    : "other";

  return {
    sourceClass,
    authorityScore: scoreForSourceClass(sourceClass),
    isAuthoritative: sourceClass === "official_docs" ||
      sourceClass === "vendor_docs" ||
      sourceClass === "repo_docs",
    isCommunity: sourceClass === "technical_article" || sourceClass === "forum",
  };
}

export function annotateSearchResultSource(
  result: SearchResult,
  allowedDomains?: string[],
): SearchResult {
  const authority = classifySearchResultSource(result, allowedDomains);
  return result.sourceClass === authority.sourceClass
    ? result
    : { ...result, sourceClass: authority.sourceClass };
}

export function annotateSearchResultSources(
  results: SearchResult[],
  allowedDomains?: string[],
): SearchResult[] {
  return results.map((result) => annotateSearchResultSource(result, allowedDomains));
}
