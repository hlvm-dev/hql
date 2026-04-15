/**
 * Chrome Extension Bridge — Unit Tests
 *
 * Tests: SessionLock, tool registration, frame protocol, bridge resolution,
 * and CLI command wiring.
 */

import {
  assertEquals,
  assertExists,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// ── SessionLock Tests ───────────────────────────────────────────────

Deno.test("shared/SessionLock — acquire returns fresh on first call", async () => {
  const { SessionLock } = await import(
    "../../../src/hlvm/agent/shared/session-lock.ts"
  );
  const tmpDir = Deno.makeTempDirSync();
  let freshCalled = false;

  const lock = new SessionLock({
    lockFilename: "test.lock",
    onAcquiredFresh: () => { freshCalled = true; },
    onReleased: () => {},
  });
  lock._setLockPathForTests(`${tmpDir}/test.lock`);

  const result = await lock.acquire("session-1");
  assertEquals(result.kind, "acquired");
  assertEquals(result.kind === "acquired" && result.fresh, true);
  assertEquals(freshCalled, true);

  await lock.release();
  lock._resetStateForTests();
  Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("shared/SessionLock — re-acquire same session is reentrant", async () => {
  const { SessionLock } = await import(
    "../../../src/hlvm/agent/shared/session-lock.ts"
  );
  const tmpDir = Deno.makeTempDirSync();

  const lock = new SessionLock({
    lockFilename: "test.lock",
    onAcquiredFresh: () => {},
    onReleased: () => {},
  });
  lock._setLockPathForTests(`${tmpDir}/test.lock`);

  await lock.acquire("session-1");
  const result = await lock.acquire("session-1");
  assertEquals(result.kind, "acquired");
  assertEquals(result.kind === "acquired" && result.fresh, false);

  await lock.release();
  lock._resetStateForTests();
  Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("shared/SessionLock — release clears lock", async () => {
  const { SessionLock } = await import(
    "../../../src/hlvm/agent/shared/session-lock.ts"
  );
  const tmpDir = Deno.makeTempDirSync();
  let releasedCalled = false;

  const lock = new SessionLock({
    lockFilename: "test.lock",
    onAcquiredFresh: () => {},
    onReleased: () => { releasedCalled = true; },
  });
  lock._setLockPathForTests(`${tmpDir}/test.lock`);

  await lock.acquire("session-1");
  assertEquals(lock.isHeldLocally(), true);

  const released = await lock.release();
  assertEquals(released, true);
  assertEquals(lock.isHeldLocally(), false);
  assertEquals(releasedCalled, true);

  const check = await lock.check();
  assertEquals(check.kind, "free");

  lock._resetStateForTests();
  Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("shared/SessionLock — check detects held_by_self", async () => {
  const { SessionLock } = await import(
    "../../../src/hlvm/agent/shared/session-lock.ts"
  );
  const tmpDir = Deno.makeTempDirSync();

  const lock = new SessionLock({
    lockFilename: "test.lock",
    onAcquiredFresh: () => {},
    onReleased: () => {},
  });
  lock._setLockPathForTests(`${tmpDir}/test.lock`);

  await lock.acquire("session-1");
  const check = await lock.check();
  assertEquals(check.kind, "held_by_self");

  await lock.release();
  lock._resetStateForTests();
  Deno.removeSync(tmpDir, { recursive: true });
});

// ── Chrome-Ext Lock Wrapper Tests ───────────────────────────────────

Deno.test("chrome-ext/lock — acquire and release", async () => {
  const lock = await import(
    "../../../src/hlvm/agent/chrome-ext/lock.ts"
  );
  const tmpDir = Deno.makeTempDirSync();
  lock._setLockPathForTests(`${tmpDir}/chrome-ext.lock`);
  lock._resetLockStateForTests();

  const r1 = await lock.tryAcquireChromeExtLock("test-session");
  assertEquals(r1.kind, "acquired");

  const r2 = await lock.releaseChromeExtLock();
  assertEquals(r2, true);

  lock._resetLockStateForTests();
  Deno.removeSync(tmpDir, { recursive: true });
});

// ── Tool Registration Tests ─────────────────────────────────────────

Deno.test("chrome-ext/tools — all 21 tools registered with required fields", async () => {
  const { CHROME_EXT_TOOLS } = await import(
    "../../../src/hlvm/agent/chrome-ext/mod.ts"
  );

  const toolNames = Object.keys(CHROME_EXT_TOOLS);
  assertEquals(toolNames.length, 21);

  // Verify required fields
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
    assertEquals(name.startsWith("ch_"), true, `${name} doesn't start with ch_`);
  }
});

Deno.test("chrome-ext/tools — expected tool names present", async () => {
  const { CHROME_EXT_TOOLS } = await import(
    "../../../src/hlvm/agent/chrome-ext/mod.ts"
  );

  const expected = [
    "ch_navigate", "ch_back", "ch_click", "ch_fill", "ch_type",
    "ch_hover", "ch_scroll", "ch_select_option", "ch_evaluate",
    "ch_screenshot", "ch_snapshot", "ch_content", "ch_links",
    "ch_wait_for", "ch_tabs", "ch_tab_create", "ch_tab_close",
    "ch_tab_select", "ch_monitor", "ch_console", "ch_network",
  ];

  for (const name of expected) {
    assertExists(CHROME_EXT_TOOLS[name], `Missing tool: ${name}`);
  }
});

// ── Common Constants Tests ──────────────────────────────────────────

Deno.test("chrome-ext/common — NATIVE_HOST_IDENTIFIER matches manifest", async () => {
  const { NATIVE_HOST_IDENTIFIER } = await import(
    "../../../src/hlvm/agent/chrome-ext/common.ts"
  );
  assertEquals(NATIVE_HOST_IDENTIFIER, "com.hlvm.chrome_bridge");
});

Deno.test("chrome-ext/common — CHROMIUM_BROWSERS has 7 entries", async () => {
  const { CHROMIUM_BROWSERS } = await import(
    "../../../src/hlvm/agent/chrome-ext/common.ts"
  );
  assertEquals(Object.keys(CHROMIUM_BROWSERS).length, 7);
});

// ── Bridge Resolution Tests ─────────────────────────────────────────

Deno.test("chrome-ext/bridge — resolves to extension or unavailable", async () => {
  const bridge = await import(
    "../../../src/hlvm/agent/chrome-ext/bridge.ts"
  );
  bridge.invalidateChromeExtResolution();

  const result = await bridge.resolveChromeExtBackend();
  // Either "extension" (if Chrome is running with our ext) or "unavailable"
  assertEquals(
    result.backend === "extension" || result.backend === "unavailable",
    true,
    `Unexpected backend: ${result.backend}`,
  );
});

// ── Prompt Tests ────────────────────────────────────────────────────

Deno.test("chrome-ext/prompt — system prompt contains ch_* guidance", async () => {
  const { CHROME_EXT_SYSTEM_PROMPT } = await import(
    "../../../src/hlvm/agent/chrome-ext/prompt.ts"
  );
  assertEquals(CHROME_EXT_SYSTEM_PROMPT.includes("ch_*"), true);
  assertEquals(CHROME_EXT_SYSTEM_PROMPT.includes("pw_*"), true);
  assertEquals(CHROME_EXT_SYSTEM_PROMPT.includes("ch_tabs"), true);
});
