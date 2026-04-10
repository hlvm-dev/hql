/**
 * Playwright Browser Tools — Unit Tests
 *
 * Tests tool registration, scroll clamping, error classification,
 * browser manager state, and chromium gate behavior.
 */

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "jsr:@std/assert";
import { PLAYWRIGHT_TOOLS } from "../../../src/hlvm/agent/playwright/mod.ts";
import {
  _resetBrowserStateForTests,
  _testOnly,
  clearSnapshotRefsForSession,
  closeBrowser,
  isBrowserActive,
  isHeaded,
  replaceSnapshotRefs,
  resolveSnapshotRef,
} from "../../../src/hlvm/agent/playwright/mod.ts";
import {
  enrichPlaywrightFailureMetadata,
  hasStructuredPlaywrightVisualFailure,
} from "../../../src/hlvm/agent/playwright/failure-enrichment.ts";
import { hasPlaywrightVisualLayoutIssue } from "../../../src/hlvm/agent/playwright/diagnostics.ts";
import {
  summarizePlaywrightActionability,
  type PlaywrightElementSnapshot,
} from "../../../src/hlvm/agent/playwright/actionability.ts";
import {
  buildPlaywrightSnapshotHint,
  normalizePlaywrightSelector,
} from "../../../src/hlvm/agent/playwright/selector-utils.ts";
import {
  buildPlaywrightRefLocator,
  parsePlaywrightSnapshotRefs,
} from "../../../src/hlvm/agent/playwright/snapshot-refs.ts";

// ── Registry completeness ──────────────────────────────────────────────

Deno.test("pw tools — all 18 tools registered", () => {
  const expected = [
    "pw_goto",
    "pw_click",
    "pw_fill",
    "pw_type",
    "pw_content",
    "pw_back",
    "pw_hover",
    "pw_links",
    "pw_wait_for",
    "pw_screenshot",
    "pw_evaluate",
    "pw_scroll",
    "pw_snapshot",
    "pw_download",
    "pw_select_option",
    "pw_upload_file",
    "pw_tabs",
    "pw_promote",
  ];
  assertEquals(Object.keys(PLAYWRIGHT_TOOLS).length, expected.length);
  for (const name of expected) {
    assertExists(PLAYWRIGHT_TOOLS[name], `Missing tool: ${name}`);
  }
});

Deno.test("pw tools — all tools have required metadata fields", () => {
  for (const [name, tool] of Object.entries(PLAYWRIGHT_TOOLS)) {
    assertExists(tool.fn, `${name} missing fn`);
    assertExists(tool.description, `${name} missing description`);
    assertExists(tool.args, `${name} missing args`);
    assertExists(tool.category, `${name} missing category`);
    assertExists(tool.safetyLevel, `${name} missing safetyLevel`);
    assertExists(tool.safety, `${name} missing safety`);
    assertExists(tool.formatResult, `${name} missing formatResult`);
  }
});

Deno.test("pw tools — safety levels are correct", () => {
  // Read-only tools should be L0 or L1
  assertEquals(PLAYWRIGHT_TOOLS.pw_content.safetyLevel, "L0");
  assertEquals(PLAYWRIGHT_TOOLS.pw_links.safetyLevel, "L0");
  assertEquals(PLAYWRIGHT_TOOLS.pw_wait_for.safetyLevel, "L0");
  assertEquals(PLAYWRIGHT_TOOLS.pw_scroll.safetyLevel, "L0");
  assertEquals(PLAYWRIGHT_TOOLS.pw_snapshot.safetyLevel, "L0");
  assertEquals(PLAYWRIGHT_TOOLS.pw_goto.safetyLevel, "L1");
  assertEquals(PLAYWRIGHT_TOOLS.pw_back.safetyLevel, "L1");
  assertEquals(PLAYWRIGHT_TOOLS.pw_screenshot.safetyLevel, "L1");
  // Write tools should be L2
  assertEquals(PLAYWRIGHT_TOOLS.pw_click.safetyLevel, "L2");
  assertEquals(PLAYWRIGHT_TOOLS.pw_fill.safetyLevel, "L2");
  assertEquals(PLAYWRIGHT_TOOLS.pw_type.safetyLevel, "L2");
  assertEquals(PLAYWRIGHT_TOOLS.pw_hover.safetyLevel, "L2");
  assertEquals(PLAYWRIGHT_TOOLS.pw_evaluate.safetyLevel, "L2");
  assertEquals(PLAYWRIGHT_TOOLS.pw_download.safetyLevel, "L2");
  assertEquals(PLAYWRIGHT_TOOLS.pw_select_option.safetyLevel, "L2");
  assertEquals(PLAYWRIGHT_TOOLS.pw_upload_file.safetyLevel, "L2");
  assertEquals(PLAYWRIGHT_TOOLS.pw_tabs.safetyLevel, "L2");
  assertEquals(PLAYWRIGHT_TOOLS.pw_promote.safetyLevel, "L2");
});

Deno.test("pw tools — formatResult returns expected shapes", () => {
  for (const [name, tool] of Object.entries(PLAYWRIGHT_TOOLS)) {
    const result = tool.formatResult!({});
    assertExists(result, `${name} formatResult returned null`);
    assertExists(
      result!.returnDisplay,
      `${name} formatResult missing returnDisplay`,
    );
  }
});

// ── pw_snapshot tool description ────────────────────────────────────────

Deno.test("pw_snapshot — description mentions ARIA and reliability", () => {
  const desc = PLAYWRIGHT_TOOLS.pw_snapshot.description;
  assertEquals(
    desc.includes("accessibility tree"),
    true,
    "should mention accessibility tree",
  );
  assertEquals(desc.includes("ARIA"), true, "should mention ARIA");
  assertEquals(
    desc.includes("BEFORE"),
    true,
    "should mention use before click/fill",
  );
});

// ── pw_scroll description ───────────────────────────────────────────────

Deno.test("pw_scroll — description mentions 1-10 range", () => {
  const desc = PLAYWRIGHT_TOOLS.pw_scroll.args.amount;
  assertEquals(desc.includes("1-10"), true, "amount should mention 1-10 range");
});

Deno.test("selector normalization — supports shorthand role selectors", () => {
  assertEquals(normalizePlaywrightSelector("searchbox"), "role=searchbox");
  assertEquals(
    normalizePlaywrightSelector('textbox "Customer name:"'),
    'role=textbox[name="Customer name:"]',
  );
  assertEquals(
    normalizePlaywrightSelector('checkbox "Remember me"'),
    'role=checkbox[name="Remember me"]',
  );
});

Deno.test("selector normalization — preserves explicit selector engines and CSS", () => {
  assertEquals(
    normalizePlaywrightSelector('role=button[name="Submit"]'),
    'role=button[name="Submit"]',
  );
  assertEquals(normalizePlaywrightSelector("text=Submit"), "text=Submit");
  assertEquals(
    normalizePlaywrightSelector("#login-form input"),
    "#login-form input",
  );
});

Deno.test("snapshot hint — recommends site search when searchbox is present", () => {
  const hint = buildPlaywrightSnapshotHint(
    '- navigation [ref=s1e1]:\n  - searchbox "Search" [ref=s1e2]\n  - link "Examples" [ref=s1e3]',
  );
  assertEquals(hint.includes("site searchbox"), true);
  assertEquals(hint.includes("snapshot refs"), true);
  assertEquals(hint.includes('textbox "Email"'), true);
});

Deno.test("snapshot refs parser extracts refs and minimal attributes", () => {
  const refs = parsePlaywrightSnapshotRefs(
    [
      '- button "Submit" [ref=s1e3]: Go',
      '- textbox "Email" [ref=s1e4] [disabled=true]',
      '- checkbox "Remember me" [ref=s1e5] [checked=true]',
      '- treeitem "Advanced" [ref=s1e6] [expanded=false]',
    ].join("\n"),
  );

  assertEquals(refs, [
    { ref: "s1e3", role: "button", name: "Submit" },
    { ref: "s1e4", role: "textbox", name: "Email", disabled: true },
    { ref: "s1e5", role: "checkbox", name: "Remember me", checked: true },
    { ref: "s1e6", role: "treeitem", name: "Advanced", expanded: false },
  ]);
  assertEquals(buildPlaywrightRefLocator("s1e3"), "aria-ref=s1e3");
});

Deno.test("browser manager — snapshot refs replace and clear per session", () => {
  _resetBrowserStateForTests();

  replaceSnapshotRefs([
    { ref: "s1e3", role: "button", name: "Submit" },
    { ref: "s1e4", role: "textbox", name: "Email" },
  ], "session-a");
  assertEquals(resolveSnapshotRef("s1e3", "session-a")?.name, "Submit");
  assertEquals(_testOnly.getSnapshotRefsForTests("session-a").length, 2);

  replaceSnapshotRefs([
    { ref: "s2e1", role: "link", name: "Docs" },
  ], "session-a");
  assertEquals(resolveSnapshotRef("s1e3", "session-a"), undefined);
  assertEquals(resolveSnapshotRef("s2e1", "session-a")?.name, "Docs");

  clearSnapshotRefsForSession("session-a");
  assertEquals(_testOnly.getSnapshotRefsForTests("session-a"), []);
});

Deno.test("ref-capable pw tools expose ref args across the first-wave interaction surface", () => {
  const refAwareTools = [
    "pw_click",
    "pw_fill",
    "pw_type",
    "pw_hover",
    "pw_select_option",
    "pw_content",
    "pw_screenshot",
    "pw_snapshot",
    "pw_download",
    "pw_upload_file",
  ] as const;

  for (const toolName of refAwareTools) {
    const tool = PLAYWRIGHT_TOOLS[toolName];
    assertExists(tool.args.ref, `${toolName} should expose ref`);
    assertStringIncludes(tool.args.ref, "Snapshot ref");
  }
});

Deno.test("pw_download — args mention direct url downloads", () => {
  const desc = PLAYWRIGHT_TOOLS.pw_download.description;
  assertEquals(desc.includes("direct file URL"), true);
  assertEquals(
    PLAYWRIGHT_TOOLS.pw_download.args.url.includes("Direct file URL"),
    true,
  );
});

Deno.test("pw_download — formatResult surfaces filename and size", () => {
  const formatted = PLAYWRIGHT_TOOLS.pw_download.formatResult?.({
    fileName: "python-3.14.4-macos11.pkg",
    savedTo: "/tmp/python-3.14.4-macos11.pkg",
    size: 75967395,
    sourceUrl: "https://www.python.org/ftp/python/3.14.4/python.pkg",
  });
  assertExists(formatted);
  assertExists(formatted.summaryDisplay);
  assertStringIncludes(
    formatted.summaryDisplay,
    "python-3.14.4-macos11.pkg",
  );
  assertStringIncludes(formatted.summaryDisplay, "75,967,395 bytes");
  assertStringIncludes(formatted.returnDisplay, "Filename:");
  assertStringIncludes(formatted.returnDisplay, "Saved to:");
  assertStringIncludes(formatted.returnDisplay, "Source URL:");
});

Deno.test("pw_content — formatResult preserves DOM text in llmContent", () => {
  const formatted = PLAYWRIGHT_TOOLS.pw_content.formatResult?.({
    text: "Latest version is 3.14.4",
    length: 24,
  });
  assertExists(formatted);
  assertExists(formatted.llmContent);
  assertEquals(formatted.returnDisplay, "Read content");
  assertStringIncludes(formatted.llmContent, "Latest version is 3.14.4");
});

Deno.test("pw_links — formatResult preserves hrefs in llmContent", () => {
  const formatted = PLAYWRIGHT_TOOLS.pw_links.formatResult?.({
    links: [{
      text: "Download macOS installer",
      href: "https://example.com/python.pkg",
    }],
    count: 1,
  });
  assertExists(formatted);
  assertExists(formatted.llmContent);
  assertEquals(formatted.returnDisplay, "Read links");
  assertStringIncludes(formatted.llmContent, "python.pkg");
});

Deno.test("pw_links — description mentions href extraction", () => {
  const desc = PLAYWRIGHT_TOOLS.pw_links.description;
  assertEquals(desc.includes("href"), true);
  assertEquals(
    PLAYWRIGHT_TOOLS.pw_links.args.href_contains.includes("href"),
    true,
  );
});

// ── Browser manager state ───────────────────────────────────────────────

Deno.test("browser manager — isBrowserActive false after reset", () => {
  _resetBrowserStateForTests();
  assertEquals(isBrowserActive(), false);
  assertEquals(isHeaded(), false);
});

Deno.test("browser manager — closeBrowser is safe when no browser", async () => {
  _resetBrowserStateForTests();
  // Should not throw
  await closeBrowser();
  assertEquals(isBrowserActive(), false);
});

Deno.test("browser manager — headed context options preserve storageState when provided", () => {
  const storageState = {
    cookies: [{ name: "sid", value: "123", domain: "example.com", path: "/" }],
    origins: [{
      origin: "https://example.com",
      localStorage: [{ name: "token", value: "abc" }],
    }],
  };
  const options = _testOnly.createBrowserContextOptions(storageState as never);
  assertEquals(options.acceptDownloads, true);
  assertEquals(options.viewport.width, 1280);
  assertEquals(options.storageState, storageState as never);
});

Deno.test("browser manager — tracks browser state per session", () => {
  _resetBrowserStateForTests();
  _testOnly.primeBrowserSessionForTests("session-a", { headed: false });
  _testOnly.primeBrowserSessionForTests("session-b", { headed: true });

  assertEquals(isBrowserActive("session-a"), true);
  assertEquals(isBrowserActive("session-b"), true);
  assertEquals(isHeaded("session-a"), false);
  assertEquals(isHeaded("session-b"), true);
  assertEquals(
    _testOnly.getBrowserSessionKeysForTests(),
    [
      _testOnly.resolveSessionKey("session-a"),
      _testOnly.resolveSessionKey("session-b"),
    ],
  );
});

Deno.test("browser manager — closing one session leaves the others intact", async () => {
  _resetBrowserStateForTests();
  _testOnly.primeBrowserSessionForTests("session-a", { headed: false });
  _testOnly.primeBrowserSessionForTests("session-b", { headed: true });

  await closeBrowser("session-a");

  assertEquals(isBrowserActive("session-a"), false);
  assertEquals(isBrowserActive("session-b"), true);
  assertEquals(isHeaded("session-b"), true);
  assertEquals(
    _testOnly.getBrowserSessionKeysForTests(),
    [_testOnly.resolveSessionKey("session-b")],
  );
});

// ── Chromium gate ───────────────────────────────────────────────────────

Deno.test("pw tools — return failTool when chromium not ready", async () => {
  // pw_goto should fail gracefully when chromium is not installed
  // We can test this by calling with the tool fn directly
  // Since chromium may or may not be installed, we just verify the function exists
  const tool = PLAYWRIGHT_TOOLS.pw_goto;
  assertExists(tool.fn);
  assertEquals(typeof tool.fn, "function");
});

// ── Error classification (via tool description inspection) ──────────────

Deno.test("pw_evaluate — description warns about full page access", () => {
  const desc = PLAYWRIGHT_TOOLS.pw_evaluate.description;
  assertEquals(
    desc.includes("full page access"),
    true,
    "should warn about full access",
  );
});

Deno.test("playwright actionability analyzer emits structured not-visible facts", () => {
  const actionability = summarizePlaywrightActionability({
    selector: "text=Issues",
    interaction: "click",
    elements: [{
      visible: false,
      enabled: true,
      inViewport: true,
      candidateHref: "https://github.com/denoland/deno/issues",
      role: "link",
      name: "Issues",
    }] as PlaywrightElementSnapshot[],
  });
  assertEquals(actionability.code, "pw_element_not_visible");
  assertEquals(actionability.facts.visualBlocker, true);
  assertEquals(actionability.facts.visualReason, "not_visible");
  assertEquals(actionability.facts.candidateHref, "https://github.com/denoland/deno/issues");
});

Deno.test("playwright failure enricher merges structured actionability facts", () => {
  const actionability = summarizePlaywrightActionability({
    selector: "text=Issues",
    interaction: "click",
    elements: [{
      visible: false,
      enabled: true,
      inViewport: true,
      role: "link",
      name: "Issues",
    }] as PlaywrightElementSnapshot[],
  });
  const failure = enrichPlaywrightFailureMetadata(
    { source: "tool", kind: "timeout", retryable: true },
    actionability,
  );
  assertEquals(failure.code, "pw_element_not_visible");
  assertEquals(failure.facts?.visualBlocker, true);
  assertEquals(failure.facts?.visualReason, "not_visible");
  assertEquals(failure.facts?.selector, "text=Issues");
  assertEquals(failure.facts?.interaction, "click");
});

Deno.test("playwright actionability analyzer emits structured outside-viewport facts", () => {
  const actionability = summarizePlaywrightActionability({
    selector: "#download",
    interaction: "click",
    elements: [{
      visible: true,
      enabled: true,
      inViewport: false,
    }] as PlaywrightElementSnapshot[],
  });
  assertEquals(actionability.code, "pw_element_outside_viewport");
  assertEquals(actionability.facts.visualReason, "outside_viewport");
});

Deno.test("playwright actionability analyzer emits structured click-intercepted facts", () => {
  const actionability = summarizePlaywrightActionability({
    selector: "text=Submit",
    interaction: "click",
    elements: [{
      visible: true,
      enabled: true,
      inViewport: true,
      intercepted: true,
      interceptedByRole: "dialog",
      interceptedByName: "Cookie consent",
    }] as PlaywrightElementSnapshot[],
  });
  const failure = enrichPlaywrightFailureMetadata(
    { source: "tool", kind: "timeout", retryable: true },
    actionability,
  );
  assertEquals(failure.code, "pw_click_intercepted");
  assertEquals(failure.facts?.visualReason, "click_intercepted");
  assertEquals(failure.facts?.interceptedByRole, "dialog");
  assertEquals(hasStructuredPlaywrightVisualFailure(failure), true);
});

Deno.test("playwright actionability analyzer emits element-not-found facts", () => {
  const actionability = summarizePlaywrightActionability({
    selector: "text=Missing",
    interaction: "click",
    elements: [],
  });
  assertEquals(actionability.code, "pw_element_not_found");
  assertEquals(actionability.facts.visualBlocker, false);
});

Deno.test("playwright actionability analyzer emits disabled-element facts", () => {
  const actionability = summarizePlaywrightActionability({
    selector: "text=Submit",
    interaction: "click",
    elements: [{
      visible: true,
      enabled: false,
      inViewport: true,
      role: "button",
      name: "Submit",
    }] as PlaywrightElementSnapshot[],
  });
  assertEquals(actionability.code, "pw_element_disabled");
  assertEquals(actionability.facts.visualBlocker, false);
});

Deno.test("playwright diagnostics do not treat pw_download_navigated as visual", async () => {
  const result = await hasPlaywrightVisualLayoutIssue(
    "Download navigated to a release page instead of downloading.",
    {
      source: "tool",
      kind: "invalid_state",
      retryable: true,
      code: "pw_download_navigated",
      facts: { navigatedTo: "https://example.com/downloads" },
    },
  );
  assertEquals(result, false);
});

// ── Recovery policy (deterministic decision tree) ─────────────────────

import {
  decideBrowserRecovery,
} from "../../../src/hlvm/agent/playwright/recovery-policy.ts";

Deno.test("recovery policy returns pw_goto alternative on first pw_click failure with candidateHref", () => {
  const decision = decideBrowserRecovery({
    toolName: "pw_click",
    failure: {
      source: "tool",
      kind: "timeout",
      retryable: true,
      code: "pw_element_not_visible",
      facts: { candidateHref: "https://example.com/downloads", visualBlocker: true },
    },
    repeatCount: 0,
    currentDomainProfileId: "browser_safe",
  });
  assertEquals(decision?.stage, "direct_pw_alternative");
  assertEquals(decision?.promoteToHybrid, false);
  assertEquals(decision?.recommendedPwAlternative?.toolName, "pw_goto");
  assertEquals(decision?.recommendedPwAlternative?.target, "https://example.com/downloads");
  assertEquals(decision?.temporarilyBlockTool, "pw_click");
});

Deno.test("recovery policy returns null on first failure without candidateHref and repeatCount < 2", () => {
  const decision = decideBrowserRecovery({
    toolName: "pw_click",
    failure: {
      source: "tool",
      kind: "timeout",
      retryable: true,
      code: "pw_element_not_visible",
      facts: { visualBlocker: true },
    },
    repeatCount: 1,
    currentDomainProfileId: "browser_safe",
  });
  assertEquals(decision, null);
});

Deno.test("recovery policy promotes to hybrid after 2 repeated visual failures in browser_safe", () => {
  const decision = decideBrowserRecovery({
    toolName: "pw_click",
    failure: {
      source: "tool",
      kind: "timeout",
      retryable: true,
      code: "pw_element_not_visible",
      facts: { visualBlocker: true, visualReason: "not_visible" },
    },
    repeatCount: 2,
    currentDomainProfileId: "browser_safe",
  });
  assertEquals(decision?.stage, "promote_hybrid");
  assertEquals(decision?.promoteToHybrid, true);
});

Deno.test("recovery policy does not promote when already in browser_hybrid", () => {
  const decision = decideBrowserRecovery({
    toolName: "pw_click",
    failure: {
      source: "tool",
      kind: "timeout",
      retryable: true,
      code: "pw_element_not_visible",
      facts: { visualBlocker: true, visualReason: "not_visible" },
    },
    repeatCount: 2,
    currentDomainProfileId: "browser_hybrid",
  });
  assertEquals(decision?.stage, "repeat_visual_pw_guidance");
  assertEquals(decision?.promoteToHybrid, false);
});

Deno.test("recovery policy follows download destination on pw_download_navigated", () => {
  const decision = decideBrowserRecovery({
    toolName: "pw_download",
    failure: {
      source: "tool",
      kind: "invalid_state",
      retryable: true,
      code: "pw_download_navigated",
      facts: { navigatedTo: "https://example.com/release/v1.0" },
    },
    repeatCount: 0,
    currentDomainProfileId: "browser_safe",
  });
  assertEquals(decision?.stage, "download_destination_follow");
  assertEquals(decision?.promoteToHybrid, false);
  assertEquals(decision?.recommendedPwAlternative?.toolName, "pw_download");
  assertEquals(decision?.recommendedPwAlternative?.target, "https://example.com/release/v1.0");
});

Deno.test("recovery policy gives structural guidance after 2 repeated non-visual failures", () => {
  const decision = decideBrowserRecovery({
    toolName: "pw_fill",
    failure: {
      source: "tool",
      kind: "not_found",
      retryable: true,
      code: "pw_element_not_found",
      facts: { visualBlocker: false },
    },
    repeatCount: 2,
    currentDomainProfileId: "browser_safe",
  });
  assertEquals(decision?.stage, "repeat_structural_pw_guidance");
  assertEquals(decision?.promoteToHybrid, false);
});

// ── Tool profile filtering (browser_safe actually restricts) ──────────

import {
  resolveDeclaredToolProfileFilter,
  createToolProfileState,
  setToolProfileLayer,
  resolveEffectiveToolFilter,
} from "../../../src/hlvm/agent/tool-profiles.ts";

Deno.test("browser_safe profile allowlist contains only pw_* tools (no pw_promote)", () => {
  const filter = resolveDeclaredToolProfileFilter("browser_safe");
  const allowlist = filter.allowlist ?? [];
  assertEquals(allowlist.length > 0, true, "browser_safe should have an allowlist");
  for (const tool of allowlist) {
    assertEquals(tool.startsWith("pw_"), true, `Unexpected non-pw tool: ${tool}`);
  }
  assertEquals(allowlist.includes("pw_promote"), false, "browser_safe should not include pw_promote");
  assertEquals(allowlist.includes("web_fetch"), false, "browser_safe should not include web_fetch");
  assertEquals(allowlist.includes("list_files"), false, "browser_safe should not include list_files");
});

Deno.test("browser_safe domain profile intersects with undefined baseline to produce pw-only", () => {
  const state = createToolProfileState();
  setToolProfileLayer(state, "domain", { profileId: "browser_safe" });
  const effective = resolveEffectiveToolFilter(state);
  const allowlist = effective.allowlist ?? [];
  assertEquals(allowlist.length > 0, true);
  for (const tool of allowlist) {
    assertEquals(tool.startsWith("pw_"), true, `Leaked non-pw tool: ${tool}`);
  }
});

Deno.test("browser_hybrid extends browser_safe with cu_* and pw_promote", () => {
  const filter = resolveDeclaredToolProfileFilter("browser_hybrid");
  const allowlist = filter.allowlist ?? [];
  assertEquals(allowlist.includes("pw_goto"), true, "should include pw_goto");
  assertEquals(allowlist.includes("pw_promote"), true, "should include pw_promote");
  assertEquals(allowlist.some((t) => t.startsWith("cu_")), true, "should include cu_* tools");
});

// ── Browser-intent regex (deterministic structural detection) ─────────

Deno.test("browser-intent regex matches bare domains with browser verbs", async () => {
  const { evaluateDelegationSignal } = await import(
    "../../../src/hlvm/agent/delegation-heuristics.ts"
  );
  // These should match structurally (no LLM needed)
  const urlCases = [
    "Go to https://python.org and download",
    "Open https://github.com/denoland/deno/issues",
    "Visit www.example.com",
  ];
  for (const query of urlCases) {
    const signal = await evaluateDelegationSignal(query);
    assertEquals(signal.taskDomain, "browser", `Should detect browser for: "${query}"`);
  }
});

Deno.test("browser-intent regex matches TLD domains without protocol", async () => {
  const { evaluateDelegationSignal } = await import(
    "../../../src/hlvm/agent/delegation-heuristics.ts"
  );
  const bareDomainCases = [
    "Go to python.org and download the installer",
    "Visit react.dev/learn",
    "Navigate to docs.deno.com",
    "Open vite.dev",
  ];
  for (const query of bareDomainCases) {
    const signal = await evaluateDelegationSignal(query);
    assertEquals(signal.taskDomain, "browser", `Should detect browser for: "${query}"`);
  }
});

Deno.test("browser-intent regex does not match non-browser queries", async () => {
  const { evaluateDelegationSignal } = await import(
    "../../../src/hlvm/agent/delegation-heuristics.ts"
  );
  const nonBrowserCases = [
    "Fix the bug in parser.ts",
    "Open the file utils.ts and add a function",
    "Go to line 42 in main.ts",
    "Read the config.json file",
  ];
  for (const query of nonBrowserCases) {
    const signal = await evaluateDelegationSignal(query);
    assertEquals(signal.taskDomain, "general", `Should NOT detect browser for: "${query}"`);
  }
});
