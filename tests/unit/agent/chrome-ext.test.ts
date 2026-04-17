/**
 * Chrome Extension Bridge — Unit Tests
 *
 * Tests: SessionLock (shared), tool registration, bridge resolution,
 * common constants, prompt content.
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// ── SessionLock Tests (shared module, still used by CU) ─────────────

Deno.test("shared/SessionLock — acquire returns fresh on first call", async () => {
  const { SessionLock } = await import(
    "../../../src/hlvm/agent/shared/session-lock.ts"
  );
  const tmpDir = Deno.makeTempDirSync();
  let freshCalled = false;
  const lock = new SessionLock({
    lockFilename: "test.lock",
    onAcquiredFresh: () => {
      freshCalled = true;
    },
    onReleased: () => {},
  });
  lock._setLockPathForTests(`${tmpDir}/test.lock`);
  const result = await lock.acquire("s1");
  assertEquals(result.kind, "acquired");
  assertEquals(result.kind === "acquired" && result.fresh, true);
  assertEquals(freshCalled, true);
  await lock.release();
  lock._resetStateForTests();
  Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("shared/SessionLock — re-acquire is reentrant", async () => {
  const { SessionLock } = await import(
    "../../../src/hlvm/agent/shared/session-lock.ts"
  );
  const tmpDir = Deno.makeTempDirSync();
  const lock = new SessionLock({
    lockFilename: "t.lock",
    onAcquiredFresh: () => {},
    onReleased: () => {},
  });
  lock._setLockPathForTests(`${tmpDir}/t.lock`);
  await lock.acquire("s1");
  const r2 = await lock.acquire("s1");
  assertEquals(r2.kind, "acquired");
  assertEquals(r2.kind === "acquired" && r2.fresh, false);
  await lock.release();
  lock._resetStateForTests();
  Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("shared/SessionLock — release clears lock", async () => {
  const { SessionLock } = await import(
    "../../../src/hlvm/agent/shared/session-lock.ts"
  );
  const tmpDir = Deno.makeTempDirSync();
  let released = false;
  const lock = new SessionLock({
    lockFilename: "t.lock",
    onAcquiredFresh: () => {},
    onReleased: () => {
      released = true;
    },
  });
  lock._setLockPathForTests(`${tmpDir}/t.lock`);
  await lock.acquire("s1");
  assertEquals(lock.isHeldLocally(), true);
  await lock.release();
  assertEquals(lock.isHeldLocally(), false);
  assertEquals(released, true);
  assertEquals((await lock.check()).kind, "free");
  lock._resetStateForTests();
  Deno.removeSync(tmpDir, { recursive: true });
});

// ── Tool Registration Tests ─────────────────────────────────────────

Deno.test("chrome-ext/tools — 21 tools registered with required fields", async () => {
  const { CHROME_EXT_TOOLS } = await import(
    "../../../src/hlvm/agent/chrome-ext/mod.ts"
  );
  const names = Object.keys(CHROME_EXT_TOOLS);
  assertEquals(names.length, 22);
  for (const [name, tool] of Object.entries(CHROME_EXT_TOOLS)) {
    assertExists(tool.fn, `${name} missing fn`);
    assertExists(tool.description, `${name} missing description`);
    assertExists(tool.args, `${name} missing args`);
    assertExists(tool.category, `${name} missing category`);
    assertExists(tool.safetyLevel, `${name} missing safetyLevel`);
    assertExists(tool.safety, `${name} missing safety`);
  }
});

Deno.test("chrome-ext/tools — all tool names start with ch_", async () => {
  const { CHROME_EXT_TOOLS } = await import(
    "../../../src/hlvm/agent/chrome-ext/mod.ts"
  );
  for (const name of Object.keys(CHROME_EXT_TOOLS)) {
    assertEquals(
      name.startsWith("ch_"),
      true,
      `${name} doesn't start with ch_`,
    );
  }
});

Deno.test("chrome-ext/tools — expected tool names present", async () => {
  const { CHROME_EXT_TOOLS } = await import(
    "../../../src/hlvm/agent/chrome-ext/mod.ts"
  );
  const expected = [
    "ch_navigate",
    "ch_back",
    "ch_click",
    "ch_fill",
    "ch_type",
    "ch_hover",
    "ch_scroll",
    "ch_select_option",
    "ch_evaluate",
    "ch_screenshot",
    "ch_content",
    "ch_links",
    "ch_wait_for",
    "ch_find",
    "ch_resize_window",
    "ch_tabs",
    "ch_tab_create",
    "ch_tab_close",
    "ch_tab_select",
    "ch_console",
    "ch_network",
    "ch_enable_monitoring",
  ];
  for (const name of expected) {
    assertExists(CHROME_EXT_TOOLS[name], `Missing tool: ${name}`);
  }
});

Deno.test("chrome-ext/tools — no CDP-specific tools (snapshot, monitor)", async () => {
  const { CHROME_EXT_TOOLS } = await import(
    "../../../src/hlvm/agent/chrome-ext/mod.ts"
  );
  assertEquals(
    CHROME_EXT_TOOLS["ch_snapshot"],
    undefined,
    "ch_snapshot should be removed (use cu_observe)",
  );
  assertEquals(
    CHROME_EXT_TOOLS["ch_monitor"],
    undefined,
    "ch_monitor renamed to ch_enable_monitoring",
  );
});

// ── Common Constants Tests ──────────────────────────────────────────

Deno.test("chrome-ext/common — NATIVE_HOST_IDENTIFIER", async () => {
  const { NATIVE_HOST_IDENTIFIER } = await import(
    "../../../src/hlvm/agent/chrome-ext/common.ts"
  );
  assertEquals(NATIVE_HOST_IDENTIFIER, "com.hlvm.chrome_bridge");
});

Deno.test("chrome-ext/common — 7 browser configs", async () => {
  const { CHROMIUM_BROWSERS } = await import(
    "../../../src/hlvm/agent/chrome-ext/common.ts"
  );
  assertEquals(Object.keys(CHROMIUM_BROWSERS).length, 7);
});

// ── Bridge Tests ────────────────────────────────────────────────────

Deno.test("chrome-ext/bridge — resolves to extension or unavailable", async () => {
  const bridge = await import("../../../src/hlvm/agent/chrome-ext/bridge.ts");
  bridge.invalidateChromeExtResolution();
  const result = await bridge.resolveChromeExtBackend();
  assertEquals(
    result.backend === "extension" || result.backend === "unavailable",
    true,
  );
});

// ── Prompt Tests ────────────────────────────────────────────────────

Deno.test("chrome-ext/prompt — contains ch_* and cu_* guidance", async () => {
  const { CHROME_EXT_SYSTEM_PROMPT } = await import(
    "../../../src/hlvm/agent/chrome-ext/prompt.ts"
  );
  assertEquals(CHROME_EXT_SYSTEM_PROMPT.includes("ch_*"), true);
  assertEquals(CHROME_EXT_SYSTEM_PROMPT.includes("pw_*"), true);
  assertEquals(CHROME_EXT_SYSTEM_PROMPT.includes("cu_*"), true);
  assertEquals(CHROME_EXT_SYSTEM_PROMPT.includes("cu_screenshot"), true);
  assertEquals(CHROME_EXT_SYSTEM_PROMPT.includes("cu_observe"), true);
  // No debugger references
  assertEquals(CHROME_EXT_SYSTEM_PROMPT.includes("debugger"), false);
  assertEquals(CHROME_EXT_SYSTEM_PROMPT.includes("debugging"), false);
});

// ── No lock/session-state files ─────────────────────────────────────

Deno.test("chrome-ext — lock.ts and session-state.ts deleted", async () => {
  const base = "src/hlvm/agent/chrome-ext";
  for (const file of ["lock.ts", "session-state.ts"]) {
    try {
      await Deno.stat(`${base}/${file}`);
      throw new Error(`${file} should be deleted`);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        // Expected
      } else if (
        e instanceof Error && e.message.includes("should be deleted")
      ) {
        throw e;
      }
    }
  }
});
