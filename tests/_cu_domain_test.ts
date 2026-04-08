// CU domain E2E — edge cases (run in background!)
import { createCliExecutor } from "../src/hlvm/agent/computer-use/executor.ts";
import { ensureRunningAppsCache } from "../src/hlvm/agent/computer-use/bridge.ts";

let pass = 0, fail = 0;
async function t(name: string, fn: () => Promise<string>) {
  try { const r = await fn(); console.log(`  OK ${name}: ${r}`); pass++; }
  catch (e: any) { console.log(`  FAIL ${name}: ${e.message.slice(0, 120)}`); fail++; }
}

const exec = createCliExecutor({
  getMouseAnimationEnabled: () => true,
  getHideBeforeActionEnabled: () => false,
});

console.log("=== CU DOMAIN TESTS (edge cases) ===\n");

// ── Basic tools (regression) ──
await t("screenshot", async () => {
  const s = await exec.screenshot({ allowedBundleIds: [] });
  return `${s.width}x${s.height}`;
});

await t("cursor_position", async () => {
  const p = await exec.getCursorPosition();
  return `(${p.x.toFixed(0)},${p.y.toFixed(0)})`;
});

await t("running_apps", async () => {
  const apps = await exec.listRunningApps();
  return `${apps.length} apps`;
});

await t("frontmost_app", async () => {
  const a = await exec.getFrontmostApp();
  return a ? a.displayName : "null";
});

// ── Edge cases ──

// Empty key sequence should throw
await t("key empty (should throw)", async () => {
  try { await exec.key(""); return "DID NOT THROW (bug!)"; }
  catch { return "threw (correct)"; }
});

await t("key plus-only (should throw)", async () => {
  try { await exec.key("+"); return "DID NOT THROW (bug!)"; }
  catch { return "threw (correct)"; }
});

await t("key plus-plus (should throw)", async () => {
  try { await exec.key("++"); return "DID NOT THROW (bug!)"; }
  catch { return "threw (correct)"; }
});

// Valid multi-key combo
await t("key command+shift+z", async () => {
  await exec.key("command+shift+z");
  return "ok";
});

// Hold key with 0 duration (should be instant)
await t("hold_key duration=0", async () => {
  await exec.holdKey(["shift"], 0);
  return "ok (instant)";
});

// Type empty string (should be no-op)
await t("type empty string", async () => {
  await exec.type("", { viaClipboard: true });
  return "ok (no-op)";
});

// Clipboard roundtrip with special chars
await t("clipboard unicode", async () => {
  const orig = await exec.readClipboard();
  await exec.writeClipboard("테스트 🎉 test!");
  const back = await exec.readClipboard();
  await exec.writeClipboard(orig);
  return back === "테스트 🎉 test!" ? "ok" : `mismatch: "${back}"`;
});

// Scroll with each direction
await t("scroll up", async () => { await exec.scroll(640, 400, 0, -3); return "ok"; });
await t("scroll down", async () => { await exec.scroll(640, 400, 0, 3); return "ok"; });
await t("scroll left", async () => { await exec.scroll(640, 400, -3, 0); return "ok"; });
await t("scroll right", async () => { await exec.scroll(640, 400, 3, 0); return "ok"; });

// Drag same point (should be no-op)
await t("drag same point", async () => {
  await exec.drag({ x: 300, y: 300 }, { x: 300, y: 300 });
  return "ok (no-op)";
});

// Drag from undefined (current cursor)
await t("drag from cursor", async () => {
  await exec.moveMouse(200, 200);
  await new Promise(r => setTimeout(r, 100));
  await exec.drag(undefined, { x: 250, y: 200 });
  return "ok";
});

// Click all button types
await t("click left", async () => { await exec.click(400, 400, "left", 1, []); return "ok"; });
await t("click right", async () => { await exec.click(400, 400, "right", 1, []); return "ok"; });
await t("click middle", async () => { await exec.click(400, 400, "middle", 1, []); return "ok"; });
await t("double click", async () => { await exec.click(400, 400, "left", 2, []); return "ok"; });
await t("triple click", async () => { await exec.click(400, 400, "left", 3, []); return "ok"; });

// Mouse down/up
await t("mouse down+up", async () => { await exec.mouseDown(); await exec.mouseUp(); return "ok"; });

// Zoom
await t("zoom", async () => {
  const r = await exec.zoom({ x: 200, y: 200, w: 400, h: 300 }, []);
  return `${r.width}x${r.height}`;
});

// Open app
await t("open Finder", async () => { await exec.openApp("com.apple.finder"); return "ok"; });

// Multi-turn: 10 sequential screenshots
await t("multi-turn 10 screenshots", async () => {
  for (let i = 0; i < 10; i++) {
    await exec.screenshot({ allowedBundleIds: [] });
  }
  return "10 screenshots taken";
});

console.log(`\n=== CU DOMAIN: ${pass} passed, ${fail} failed ===`);
