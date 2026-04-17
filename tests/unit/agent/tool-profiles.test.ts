import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  clearToolProfileLayer,
  createToolProfileState,
  declareToolProfiles,
  ensureToolProfileState,
  getDeclaredToolProfiles,
  resolveEffectiveToolFilter,
  resolveEffectiveToolFilterCached,
  resolvePersistentToolFilter,
  setToolProfileLayer,
  syncEffectiveToolFilterToConfig,
  type ToolProfileCarrier,
  updateToolProfileLayer,
  widenBaselineForDomainProfile,
} from "../../../src/hlvm/agent/tool-profiles.ts";
import { STANDARD_EAGER_TOOLS } from "../../../src/hlvm/agent/constants.ts";
import { PLAYWRIGHT_TOOLS } from "../../../src/hlvm/agent/playwright/mod.ts";
import { COMPUTER_USE_TOOLS } from "../../../src/hlvm/agent/computer-use/mod.ts";

Deno.test("ToolProfile merges baseline-only filters", () => {
  const state = createToolProfileState();
  setToolProfileLayer(state, "baseline", {
    allowlist: ["read_file", "tool_search"],
    denylist: ["complete_task"],
  });

  assertEquals(resolveEffectiveToolFilter(state), {
    allowlist: ["read_file", "tool_search"],
    denylist: ["complete_task"],
  });
});

Deno.test("ToolProfile intersects allowlists and unions denylists across layers", () => {
  const state = createToolProfileState();
  setToolProfileLayer(state, "baseline", {
    allowlist: ["read_file", "write_file", "tool_search"],
    denylist: ["complete_task"],
  });
  setToolProfileLayer(state, "plan", {
    allowlist: ["read_file", "write_file"],
    denylist: ["shell_exec"],
  });
  setToolProfileLayer(state, "runtime", {
    denylist: ["write_file"],
  });

  assertEquals(resolveEffectiveToolFilter(state), {
    allowlist: ["read_file", "write_file"],
    denylist: ["complete_task", "shell_exec", "write_file"],
  });
  assertEquals(resolvePersistentToolFilter(state), {
    allowlist: ["read_file", "write_file"],
    denylist: ["complete_task", "shell_exec"],
  });
});

Deno.test("ToolProfile preserves explicit empty allowlist as restrictive", () => {
  const state = createToolProfileState();
  setToolProfileLayer(state, "baseline", {
    allowlist: ["read_file", "tool_search"],
  });
  setToolProfileLayer(state, "runtime", {
    allowlist: [],
  });

  assertEquals(resolveEffectiveToolFilter(state).allowlist, []);
});

Deno.test("ToolProfile discovery narrowing is excluded from persistent baseline", () => {
  const state = createToolProfileState();
  setToolProfileLayer(state, "baseline", {
    allowlist: ["read_file", "write_file", "tool_search"],
  });
  setToolProfileLayer(state, "discovery", {
    allowlist: ["read_file", "tool_search"],
  });

  assertEquals(resolveEffectiveToolFilter(state).allowlist, [
    "read_file",
    "tool_search",
  ]);
  assertEquals(resolvePersistentToolFilter(state).allowlist, [
    "read_file",
    "write_file",
    "tool_search",
  ]);
});

Deno.test("ToolProfile CRUD replaces and clears layers", () => {
  const state = createToolProfileState();
  setToolProfileLayer(state, "runtime", {
    denylist: ["search_web"],
  });
  assertEquals(resolveEffectiveToolFilter(state).denylist, ["search_web"]);

  setToolProfileLayer(state, "runtime", {
    denylist: ["fetch_url"],
  });
  assertEquals(resolveEffectiveToolFilter(state).denylist, ["fetch_url"]);

  clearToolProfileLayer(state, "runtime");
  assertEquals(resolveEffectiveToolFilter(state), {
    allowlist: undefined,
    denylist: undefined,
  });
});

Deno.test("ToolProfile resolves declared profile inheritance", () => {
  const registry = declareToolProfiles([
    {
      id: "base",
      allowlist: ["read_file", "tool_search"],
      denylist: ["complete_task"],
    },
    {
      id: "child",
      extends: "base",
      allowlist: ["write_file"],
      denylist: ["shell_exec"],
    },
  ]);
  const state = createToolProfileState();
  setToolProfileLayer(state, "domain", { profileId: "child" });

  assertEquals(resolveEffectiveToolFilter(state, { registry }), {
    allowlist: ["read_file", "tool_search", "write_file"],
    denylist: ["complete_task", "shell_exec"],
  });
});

Deno.test("ToolProfile sync updates flat compatibility filters from profile state", () => {
  const state = createToolProfileState();
  setToolProfileLayer(state, "baseline", {
    allowlist: ["read_file", "write_file", "tool_search"],
    denylist: ["complete_task"],
  });
  setToolProfileLayer(state, "discovery", {
    allowlist: ["read_file", "tool_search"],
  });

  const target: ToolProfileCarrier & {
    toolAllowlist?: string[];
    toolDenylist?: string[];
  } = {
    toolAllowlist: undefined,
    toolDenylist: undefined,
  };
  const synced = syncEffectiveToolFilterToConfig(target, state);

  assertEquals(synced.effective.allowlist, ["read_file", "tool_search"]);
  assertEquals(synced.persistent.allowlist, [
    "read_file",
    "write_file",
    "tool_search",
  ]);
  assertEquals(target.toolAllowlist, ["read_file", "tool_search"]);
  assertEquals(target.toolDenylist, ["complete_task"]);
});

Deno.test("ToolProfile bootstraps profile state from flat compatibility filters only", () => {
  const target: ToolProfileCarrier & {
    toolAllowlist?: string[];
    toolDenylist?: string[];
  } = {
    toolAllowlist: ["read_file", "tool_search"],
    toolDenylist: ["complete_task"],
  };

  const state = ensureToolProfileState(target);
  assertExists(state.layers.baseline);
  assertEquals(state.layers.baseline?.allowlist, ["read_file", "tool_search"]);
  assertEquals(state.layers.runtime, undefined);

  updateToolProfileLayer(target, "runtime", {
    allowlist: ["read_file"],
  });
  assertEquals(target.toolAllowlist, ["read_file"]);
  assertEquals(target.toolDenylist, ["complete_task"]);
  assertEquals(
    resolvePersistentToolFilter(target.toolProfileState!).allowlist,
    [
      "read_file",
      "tool_search",
    ],
  );
});

Deno.test("browser profiles are declared for future domain routing", () => {
  const profiles = getDeclaredToolProfiles();
  assertExists(profiles.browser_safe);
  assertExists(profiles.browser_hybrid);
});

Deno.test("hybrid promotion exposes pw_promote and cu_* after widenBaselineForDomainProfile", () => {
  const pwToolNames = Object.keys(PLAYWRIGHT_TOOLS).filter((n) =>
    n !== "pw_promote"
  );
  const cuToolNames = Object.keys(COMPUTER_USE_TOOLS);
  const baselineAllowlist = [...STANDARD_EAGER_TOOLS, ...pwToolNames];

  const target: ToolProfileCarrier = {
    toolProfileState: createToolProfileState({
      baseline: {
        slot: "baseline",
        allowlist: baselineAllowlist,
      },
      domain: { slot: "domain", profileId: "browser_safe" },
    }),
  };

  // Before widening: effective allowlist should NOT include pw_promote or cu_*
  const beforeEffective = resolveEffectiveToolFilter(target.toolProfileState!);
  assertEquals(beforeEffective.allowlist?.includes("pw_promote"), false);
  assertEquals(beforeEffective.allowlist?.includes("cu_screenshot"), false);

  // Widen baseline and set domain to browser_hybrid
  widenBaselineForDomainProfile(target, "browser_hybrid");
  updateToolProfileLayer(target, "domain", { profileId: "browser_hybrid" });

  const afterEffective = resolveEffectiveToolFilter(target.toolProfileState!);
  assertEquals(afterEffective.allowlist?.includes("pw_promote"), true);
  for (const cuTool of cuToolNames) {
    assertEquals(
      afterEffective.allowlist?.includes(cuTool),
      true,
      `Expected ${cuTool} in effective allowlist after hybrid promotion`,
    );
  }
});

Deno.test("hybrid promotion: domain layer correctly narrows to browser tools only", () => {
  const pwToolNames = Object.keys(PLAYWRIGHT_TOOLS).filter((n) =>
    n !== "pw_promote"
  );
  const cuToolNames = Object.keys(COMPUTER_USE_TOOLS);
  const baselineAllowlist = [...STANDARD_EAGER_TOOLS, ...pwToolNames];

  const target: ToolProfileCarrier = {
    toolProfileState: createToolProfileState({
      baseline: {
        slot: "baseline",
        allowlist: baselineAllowlist,
      },
      domain: { slot: "domain", profileId: "browser_safe" },
    }),
  };

  widenBaselineForDomainProfile(target, "browser_hybrid");
  updateToolProfileLayer(target, "domain", { profileId: "browser_hybrid" });

  const effective = resolveEffectiveToolFilter(target.toolProfileState!);
  // Domain intersection narrows to browser tools only (standard tools excluded)
  assertEquals(effective.allowlist?.includes("read_file"), false);
  // But all browser tools including promoted ones are present
  assertEquals(effective.allowlist?.includes("pw_goto"), true);
  assertEquals(effective.allowlist?.includes("pw_promote"), true);
  assertEquals(effective.allowlist?.includes(cuToolNames[0]), true);
});

Deno.test("widenBaselineForDomainProfile is idempotent", () => {
  const pwToolNames = Object.keys(PLAYWRIGHT_TOOLS).filter((n) =>
    n !== "pw_promote"
  );
  const baselineAllowlist = [...STANDARD_EAGER_TOOLS, ...pwToolNames];

  const target: ToolProfileCarrier = {
    toolProfileState: createToolProfileState({
      baseline: { slot: "baseline", allowlist: baselineAllowlist },
    }),
  };

  widenBaselineForDomainProfile(target, "browser_hybrid");
  const after1 = resolveEffectiveToolFilter(target.toolProfileState!);
  widenBaselineForDomainProfile(target, "browser_hybrid");
  const after2 = resolveEffectiveToolFilter(target.toolProfileState!);

  assertEquals(after1.allowlist, after2.allowlist);
});

Deno.test("resolveEffectiveToolFilterCached returns same result as uncached", () => {
  const state = createToolProfileState();
  setToolProfileLayer(state, "baseline", {
    allowlist: ["read_file", "write_file", "tool_search"],
    denylist: ["complete_task"],
  });
  setToolProfileLayer(state, "runtime", { denylist: ["write_file"] });

  const uncached = resolveEffectiveToolFilter(state);
  const cached = resolveEffectiveToolFilterCached(state);
  assertEquals(cached.allowlist, uncached.allowlist);
  assertEquals(cached.denylist, uncached.denylist);
});

Deno.test("resolveEffectiveToolFilterCached invalidates after layer mutation", () => {
  const state = createToolProfileState();
  setToolProfileLayer(state, "baseline", {
    allowlist: ["read_file", "write_file"],
  });

  const before = resolveEffectiveToolFilterCached(state);
  assertEquals(before.allowlist, ["read_file", "write_file"]);

  setToolProfileLayer(state, "runtime", { denylist: ["write_file"] });
  const after = resolveEffectiveToolFilterCached(state);
  assertEquals(after.denylist, ["write_file"]);
});
