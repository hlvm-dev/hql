import { requireComputerUseInput, requireComputerUseSwift, ensureRunningAppsCache } from "../src/hlvm/agent/computer-use/bridge.ts";

const input = requireComputerUseInput();
const swift = requireComputerUseSwift();

console.log("=== BRIDGE DIRECT TESTS ===\n");

// 1: Screenshot
console.log("1. Screenshot...");
try {
  const ss = await swift.screenshot.capture(75, 1280, 720);
  console.log(`   ✓ ${ss.width}x${ss.height}, ${ss.data.length} bytes base64`);
} catch (e: any) { console.log(`   ✗ ${e.message}`); }

// 2: Display info
console.log("2. Display info...");
try {
  const d = swift.display.mainDisplay();
  console.log(`   ✓ ${d.width}x${d.height} @ ${d.scaleFactor}x`);
} catch (e: any) { console.log(`   ✗ ${e.message}`); }

// 3: Cursor position
console.log("3. Cursor position...");
try {
  const pos = await input.getCursorPosition();
  console.log(`   ✓ (${pos.x}, ${pos.y})`);
} catch (e: any) { console.log(`   ✗ ${e.message}`); }

// 4: Running apps with cache
console.log("4. Running apps (ensureRunningAppsCache)...");
try {
  await ensureRunningAppsCache();
  const apps = swift.apps.listRunning();
  console.log(`   ✓ ${apps.length} apps: ${apps.slice(0,5).map((a: any) => a.displayName).join(", ")}${apps.length > 5 ? "..." : ""}`);
} catch (e: any) { console.log(`   ✗ ${e.message}`); }

// 5: Clipboard round-trip
console.log("5. Clipboard round-trip...");
try {
  const original = await input.readClipboard();
  await input.writeClipboard("HLVM_CU_TEST_98765");
  const read = await input.readClipboard();
  await input.writeClipboard(original);
  console.log(`   ${read === "HLVM_CU_TEST_98765" ? "✓" : "✗"} wrote→read: "${read}"`);
} catch (e: any) { console.log(`   ✗ ${e.message}`); }

// 6: Mouse move + verify
console.log("6. Mouse move (200,200) + verify...");
try {
  await input.moveMouse(200, 200);
  await new Promise(r => setTimeout(r, 150));
  const pos = await input.getCursorPosition();
  const ok = Math.abs(pos.x - 200) < 5 && Math.abs(pos.y - 200) < 5;
  console.log(`   ${ok ? "✓" : "✗"} target=(200,200) actual=(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)})`);
} catch (e: any) { console.log(`   ✗ ${e.message}`); }

// 7: Key press (shift — harmless)
console.log("7. Key press (shift)...");
try {
  await input.key("shift");
  console.log("   ✓ pressed");
} catch (e: any) { console.log(`   ✗ ${e.message}`); }

// 8: Frontmost app
console.log("8. Frontmost app...");
try {
  const app = await input.getFrontmostAppInfo();
  console.log(`   ✓ ${app.localizedName} (${app.bundleId}) pid=${app.pid}`);
} catch (e: any) { console.log(`   ✗ ${e.message}`); }

// 9: All displays
console.log("9. All displays...");
try {
  const d = swift.display.allDisplays();
  console.log(`   ✓ ${d.length} display(s): ${d.map((x: any) => `${x.width}x${x.height}`).join(", ")}`);
} catch (e: any) { console.log(`   ✗ ${e.message}`); }

// 10: App under point (if available)
console.log("10. App under point (640,400)...");
try {
  const bid = await swift.apps.appUnderPoint(640, 400);
  console.log(`   ✓ bundleId: ${bid ?? "(null — no app at that point)"}`);
} catch (e: any) { console.log(`   ✗ ${e.message}`); }

console.log("\n=== DONE ===");
