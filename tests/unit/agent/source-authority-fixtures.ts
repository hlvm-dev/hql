import type {
  SearchResult,
  SearchResultSourceClass,
} from "../../../src/hlvm/agent/tools/web/search-provider.ts";

export interface SourceAuthorityFixture {
  name: string;
  result: SearchResult;
  expectedClass: SearchResultSourceClass;
}

export const SOURCE_AUTHORITY_FIXTURES: readonly SourceAuthorityFixture[] = [
  {
    name: "vendor docs via docs subdomain",
    result: {
      title: "Messages API",
      url: "https://docs.anthropic.com/en/api/messages",
      snippet: "Send a structured list of input messages to the model.",
    },
    expectedClass: "vendor_docs",
  },
  {
    name: "vendor docs via reference path",
    result: {
      title: "Web API reference",
      url: "https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API",
      snippet: "The Fetch API provides an interface for fetching resources.",
    },
    expectedClass: "vendor_docs",
  },
  {
    name: "repo docs via README blob",
    result: {
      title: "README.md",
      url: "https://github.com/denoland/deno/blob/main/README.md",
      snippet: "Deno is a modern runtime for JavaScript and TypeScript.",
    },
    expectedClass: "repo_docs",
  },
  {
    name: "repo docs via hosted docs",
    result: {
      title: "Project Wiki",
      url: "https://owner.github.io/project/getting-started",
      snippet: "Getting started with the project wiki and docs.",
    },
    expectedClass: "repo_docs",
  },
  {
    name: "technical article via known host",
    result: {
      title: "How to use React useEffect cleanup effectively",
      url: "https://blog.logrocket.com/react-useeffect-cleanup-guide/",
      snippet: "Best practices, common mistakes, and examples.",
    },
    expectedClass: "technical_article",
  },
  {
    name: "technical article via article path",
    result: {
      title: "Ultimate guide to Bun performance tuning",
      url: "https://engineering.example.dev/blog/bun-performance",
      snippet: "A complete guide with pitfalls and solutions.",
    },
    expectedClass: "technical_article",
  },
  {
    name: "forum via forum host suffix",
    result: {
      title: "How do I cancel sibling tasks in asyncio TaskGroup?",
      url: "https://stackoverflow.com/questions/12345678/cancel-sibling-taskgroup",
      snippet: "Discussion of structured concurrency behavior.",
    },
    expectedClass: "forum",
  },
  {
    name: "forum via discussion path",
    result: {
      title: "TaskGroup cancellation semantics",
      url: "https://discuss.python.org/t/taskgroup-cancellation-semantics/12345",
      snippet: "Community discussion about cancellation edge cases.",
    },
    expectedClass: "forum",
  },
  {
    name: "other marketing page",
    result: {
      title: "Pricing",
      url: "https://example.com/pricing",
      snippet: "Plans and pricing for teams and enterprises.",
    },
    expectedClass: "other",
  },
  {
    name: "other generic homepage",
    result: {
      title: "Acme Cloud",
      url: "https://acmecloud.example/",
      snippet: "Cloud hosting for modern teams.",
    },
    expectedClass: "other",
  },
] as const;
