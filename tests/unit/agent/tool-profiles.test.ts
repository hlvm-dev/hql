import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  clearToolProfileLayer,
  createToolProfileState,
  declareToolProfiles,
  ensureToolProfileState,
  getDeclaredToolProfiles,
  resolveEffectiveToolFilter,
  resolvePersistentToolFilter,
  setToolProfileLayer,
  syncEffectiveToolFilterToConfig,
  updateToolProfileLayer,
} from "../../../src/hlvm/agent/tool-profiles.ts";

Deno.test("ToolProfile merges baseline-only filters", () => {
  const state = createToolProfileState();
  setToolProfileLayer(state, "baseline", {
    allowlist: ["read_file", "tool_search"],
    denylist: ["delegate_agent"],
  });

  assertEquals(resolveEffectiveToolFilter(state), {
    allowlist: ["read_file", "tool_search"],
    denylist: ["delegate_agent"],
  });
});

Deno.test("ToolProfile intersects allowlists and unions denylists across layers", () => {
  const state = createToolProfileState();
  setToolProfileLayer(state, "baseline", {
    allowlist: ["read_file", "write_file", "tool_search"],
    denylist: ["delegate_agent"],
  });
  setToolProfileLayer(state, "plan", {
    allowlist: ["read_file", "write_file"],
    denylist: ["complete_task"],
  });
  setToolProfileLayer(state, "runtime", {
    denylist: ["write_file"],
  });

  assertEquals(resolveEffectiveToolFilter(state), {
    allowlist: ["read_file", "write_file"],
    denylist: ["delegate_agent", "complete_task", "write_file"],
  });
  assertEquals(resolvePersistentToolFilter(state), {
    allowlist: ["read_file", "write_file"],
    denylist: ["delegate_agent", "complete_task"],
  });
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
      denylist: ["delegate_agent"],
    },
    {
      id: "child",
      extends: "base",
      allowlist: ["write_file"],
      denylist: ["complete_task"],
    },
  ]);
  const state = createToolProfileState();
  setToolProfileLayer(state, "domain", { profileId: "child" });

  assertEquals(resolveEffectiveToolFilter(state, { registry }), {
    allowlist: ["read_file", "tool_search", "write_file"],
    denylist: ["delegate_agent", "complete_task"],
  });
});

Deno.test("ToolProfile sync updates effective and baseline mirrors", () => {
  const state = createToolProfileState();
  setToolProfileLayer(state, "baseline", {
    allowlist: ["read_file", "write_file", "tool_search"],
    denylist: ["delegate_agent"],
  });
  setToolProfileLayer(state, "discovery", {
    allowlist: ["read_file", "tool_search"],
  });

  const target = {
    toolFilterState: {},
    toolFilterBaseline: {},
  };
  const synced = syncEffectiveToolFilterToConfig(target, state);

  assertEquals(synced.effective.allowlist, ["read_file", "tool_search"]);
  assertEquals(synced.persistent.allowlist, [
    "read_file",
    "write_file",
    "tool_search",
  ]);
  assertEquals(target.toolAllowlist, ["read_file", "tool_search"]);
  assertEquals(target.toolFilterState.allowlist, ["read_file", "tool_search"]);
  assertEquals(target.toolFilterBaseline.allowlist, [
    "read_file",
    "write_file",
    "tool_search",
  ]);
});

Deno.test("ToolProfile can lift legacy mirrors into profile state", () => {
  const target = {
    toolAllowlist: ["read_file", "tool_search"],
    toolDenylist: ["delegate_agent"],
    toolFilterState: { allowlist: ["read_file"], denylist: ["delegate_agent"] },
    toolFilterBaseline: {
      allowlist: ["read_file", "tool_search"],
      denylist: ["delegate_agent"],
    },
  };

  const state = ensureToolProfileState(target);
  assertExists(state.layers.baseline);
  assertExists(state.layers.runtime);
  assertEquals(state.layers.baseline?.allowlist, ["read_file", "tool_search"]);
  assertEquals(state.layers.runtime?.allowlist, ["read_file"]);

  updateToolProfileLayer(target, "discovery", {
    allowlist: ["read_file", "tool_search"],
  });
  assertEquals(target.toolFilterState.allowlist, ["read_file"]);
});

Deno.test("browser profiles are declared for future domain routing", () => {
  const profiles = getDeclaredToolProfiles();
  assertExists(profiles.browser_safe);
  assertExists(profiles.browser_hybrid);
});
