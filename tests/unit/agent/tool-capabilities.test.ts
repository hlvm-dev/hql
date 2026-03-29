import { assertEquals } from "jsr:@std/assert";
import type { ToolMetadata } from "../../../src/hlvm/agent/registry.ts";
import {
  getProviderExecutedToolNames,
  isCitationBackedWebToolName,
  isRawPayloadCitationWebToolName,
  isWebCapabilityToolName,
  normalizeWebCapabilitySelectors,
  projectPromptToolsForWebCapabilities,
  projectToolSearchResultsForWebCapabilities,
  REMOTE_CODE_EXECUTE_TOOL_NAME,
  resolveProviderExecutionPlan,
  resolveWebCapabilityPlan,
} from "../../../src/hlvm/agent/tool-capabilities.ts";

const SEARCH_WEB_META: ToolMetadata = {
  fn: async () => "ok",
  description: "Search DuckDuckGo for live web results.",
  args: { query: "Search query" },
  safetyLevel: "L0",
  category: "web",
  replaces: "curl/wget",
};

Deno.test("tool capabilities: native-search providers resolve web_search natively while fetch/read stay custom by default", () => {
  const plan = resolveWebCapabilityPlan({
    providerName: "openai",
    nativeCapabilities: {
      webSearch: true,
      webPageRead: true,
      remoteCodeExecution: false,
    },
  });

  assertEquals(plan.capabilities.web_search.implementation, "native");
  assertEquals(plan.capabilities.web_search.activeToolName, "web_search");
  assertEquals(plan.capabilities.web_page_read.implementation, "custom");
  assertEquals(plan.capabilities.web_page_read.activeToolName, "web_fetch");
  assertEquals(plan.capabilities.raw_url_fetch.implementation, "custom");
  assertEquals(plan.capabilities.raw_url_fetch.activeToolName, "fetch_url");
});

Deno.test("tool capabilities: Google now resolves native web_search while Ollama stays custom", () => {
  const googlePlan = resolveWebCapabilityPlan({
    providerName: "google",
    nativeCapabilities: {
      webSearch: true,
      webPageRead: false,
      remoteCodeExecution: false,
    },
  });
  const ollamaPlan = resolveWebCapabilityPlan({
    providerName: "ollama",
    nativeCapabilities: {
      webSearch: true,
      webPageRead: true,
      remoteCodeExecution: true,
    },
  });

  assertEquals(googlePlan.capabilities.web_search.implementation, "native");
  assertEquals(ollamaPlan.capabilities.web_search.implementation, "custom");
});

Deno.test("tool capabilities: search_web and web_search selectors share the same capability", () => {
  const nativePlan = resolveWebCapabilityPlan({
    providerName: "anthropic",
    allowlist: ["web_search"],
    nativeCapabilities: {
      webSearch: true,
      webPageRead: false,
      remoteCodeExecution: false,
    },
  });
  const customPlan = resolveWebCapabilityPlan({
    providerName: "google",
    allowlist: ["search_web"],
    nativeCapabilities: {
      webSearch: false,
      webPageRead: false,
      remoteCodeExecution: false,
    },
  });

  assertEquals(nativePlan.capabilities.web_search.implementation, "native");
  assertEquals(customPlan.capabilities.web_search.implementation, "custom");
  assertEquals(
    normalizeWebCapabilitySelectors(["web_search", "read_file"]),
    ["web_search", "read_file", "search_web"],
  );
  assertEquals(
    normalizeWebCapabilitySelectors(["search_web", "read_file"]),
    ["search_web", "read_file", "web_search"],
  );
});

Deno.test("tool capabilities: web_fetch and fetch_url remain independent capabilities", () => {
  const plan = resolveWebCapabilityPlan({
    providerName: "openai",
    allowlist: ["web_fetch"],
    nativeCapabilities: {
      webSearch: true,
      webPageRead: false,
      remoteCodeExecution: false,
    },
  });

  assertEquals(plan.capabilities.web_search.implementation, "disabled");
  assertEquals(plan.capabilities.web_page_read.implementation, "custom");
  assertEquals(plan.capabilities.raw_url_fetch.implementation, "disabled");
});

Deno.test("tool capabilities: conservative native page-read activates only on a dedicated web_fetch surface", () => {
  const dedicatedPlan = resolveWebCapabilityPlan({
    providerName: "google",
    allowlist: ["web_fetch"],
    nativeCapabilities: {
      webSearch: true,
      webPageRead: true,
      remoteCodeExecution: false,
    },
  });
  const mixedPlan = resolveWebCapabilityPlan({
    providerName: "google",
    allowlist: ["web_fetch", "web_search"],
    nativeCapabilities: {
      webSearch: true,
      webPageRead: true,
      remoteCodeExecution: false,
    },
  });

  assertEquals(
    dedicatedPlan.capabilities.web_page_read.implementation,
    "native",
  );
  assertEquals(mixedPlan.capabilities.web_page_read.implementation, "custom");
});

Deno.test("tool capabilities: deny wins over allow for both search selectors", () => {
  const plan = resolveWebCapabilityPlan({
    providerName: "openai",
    allowlist: ["search_web"],
    denylist: ["web_search"],
    nativeCapabilities: {
      webSearch: true,
      webPageRead: false,
      remoteCodeExecution: false,
    },
  });

  assertEquals(plan.capabilities.web_search.implementation, "disabled");
});

Deno.test("tool capabilities: provider execution plan keeps remote code explicit-only", () => {
  const disabledPlan = resolveProviderExecutionPlan({
    providerName: "google",
    nativeCapabilities: {
      webSearch: true,
      webPageRead: true,
      remoteCodeExecution: true,
    },
  });
  const enabledPlan = resolveProviderExecutionPlan({
    providerName: "google",
    allowlist: ["web_search", REMOTE_CODE_EXECUTE_TOOL_NAME],
    nativeCapabilities: {
      webSearch: true,
      webPageRead: true,
      remoteCodeExecution: true,
    },
  });

  assertEquals(disabledPlan.remoteCodeExecution.implementation, "disabled");
  assertEquals(enabledPlan.remoteCodeExecution.implementation, "native");
  assertEquals(
    enabledPlan.remoteCodeExecution.activeToolName,
    REMOTE_CODE_EXECUTE_TOOL_NAME,
  );
});

Deno.test("tool capabilities: auto-requested remote code activates native provider execution without an explicit allowlist", () => {
  const plan = resolveProviderExecutionPlan({
    providerName: "google",
    nativeCapabilities: {
      webSearch: true,
      webPageRead: true,
      remoteCodeExecution: true,
    },
    autoRequestedRemoteCodeExecution: true,
  });

  assertEquals(plan.remoteCodeExecution.implementation, "native");
  assertEquals(
    plan.remoteCodeExecution.activeToolName,
    REMOTE_CODE_EXECUTE_TOOL_NAME,
  );
});

Deno.test("tool capabilities: mixed conservative routing keeps native search and remote code but leaves page-read custom", () => {
  const plan = resolveProviderExecutionPlan({
    providerName: "google",
    allowlist: ["web_search", "web_fetch", REMOTE_CODE_EXECUTE_TOOL_NAME],
    nativeCapabilities: {
      webSearch: true,
      webPageRead: true,
      remoteCodeExecution: true,
    },
  });

  assertEquals(plan.web.capabilities.web_search.implementation, "native");
  assertEquals(plan.web.capabilities.web_page_read.implementation, "custom");
  assertEquals(plan.remoteCodeExecution.implementation, "native");
  assertEquals(getProviderExecutedToolNames(plan), [
    "web_search",
    "google_search",
    "remote_code_execute",
    "code_execution",
  ]);
});

Deno.test("tool capabilities: prompt projection swaps search_web, can project native web_fetch, and hides disabled remote code", () => {
  const tools = projectPromptToolsForWebCapabilities(
    {
      search_web: SEARCH_WEB_META,
      web_fetch: {
        ...SEARCH_WEB_META,
        description: "Fetch a readable page.",
      },
      fetch_url: {
        ...SEARCH_WEB_META,
        description: "Fetch raw URL content.",
      },
      remote_code_execute: {
        ...SEARCH_WEB_META,
        description: "Remote code execution.",
        safetyLevel: "L2",
        category: "data",
      },
    },
    resolveProviderExecutionPlan({
      providerName: "google",
      allowlist: ["web_fetch"],
      nativeCapabilities: {
        webSearch: true,
        webPageRead: true,
        remoteCodeExecution: true,
      },
    }),
  );

  assertEquals("search_web" in tools, false);
  assertEquals("web_search" in tools, false);
  assertEquals("web_fetch" in tools, true);
  assertEquals("fetch_url" in tools, false);
  assertEquals("remote_code_execute" in tools, false);
  assertEquals(
    tools.web_fetch?.description.includes("provider-native"),
    true,
  );
});

Deno.test("tool capabilities: tool_search projection emits provider-native search and explicit remote code only when active", () => {
  const results = projectToolSearchResultsForWebCapabilities(
    [
      {
        name: "search_web",
        description: "Search DuckDuckGo for live web results.",
        category: "web",
        safetyLevel: "L0",
        source: "built-in",
      },
      {
        name: "web_fetch",
        description: "Fetch a readable web page.",
        category: "web",
        safetyLevel: "L0",
        source: "built-in",
      },
      {
        name: "fetch_url",
        description: "Fetch a raw URL.",
        category: "web",
        safetyLevel: "L0",
        source: "built-in",
      },
      {
        name: "remote_code_execute",
        description: "Remote code execution.",
        category: "data",
        safetyLevel: "L2",
        source: "built-in",
      },
    ],
    resolveProviderExecutionPlan({
      providerName: "google",
      allowlist: ["web_search", REMOTE_CODE_EXECUTE_TOOL_NAME],
      nativeCapabilities: {
        webSearch: true,
        webPageRead: true,
        remoteCodeExecution: true,
      },
    }),
  );

  assertEquals(results.map((result) => result.name), [
    "web_search",
    "remote_code_execute",
  ]);
  assertEquals(results[0]?.description.includes("provider-native"), true);
});

Deno.test("tool capabilities: web helper predicates track web, citation-backed, and raw-payload tools", () => {
  assertEquals(isWebCapabilityToolName("web_search"), true);
  assertEquals(isWebCapabilityToolName("google_search"), true);
  assertEquals(isWebCapabilityToolName("web_fetch"), true);
  assertEquals(isWebCapabilityToolName("url_context"), true);
  assertEquals(isWebCapabilityToolName("fetch_url"), true);
  assertEquals(isWebCapabilityToolName("read_file"), false);

  assertEquals(isCitationBackedWebToolName("web_search"), true);
  assertEquals(isCitationBackedWebToolName("google_search"), true);
  assertEquals(isCitationBackedWebToolName("search_web"), true);
  assertEquals(isCitationBackedWebToolName("web_fetch"), true);
  assertEquals(isCitationBackedWebToolName("url_context"), true);
  assertEquals(isCitationBackedWebToolName("fetch_url"), true);

  assertEquals(isRawPayloadCitationWebToolName("search_web"), true);
  assertEquals(isRawPayloadCitationWebToolName("web_fetch"), true);
  assertEquals(isRawPayloadCitationWebToolName("fetch_url"), true);
  assertEquals(isRawPayloadCitationWebToolName("web_search"), false);
  assertEquals(isRawPayloadCitationWebToolName("google_search"), false);
  assertEquals(isRawPayloadCitationWebToolName("url_context"), false);
});
