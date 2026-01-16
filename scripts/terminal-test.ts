#!/usr/bin/env -S deno run --allow-all
/**
 * Minimal terminal key test - works in Terminal.app
 * Tests raw stdin to see exactly what bytes are sent
 */

// Set terminal to raw mode
Deno.stdin.setRaw(true);

console.log("╔════════════════════════════════════════════════════════════╗");
console.log("║  TERMINAL KEY TEST - See exactly what bytes are sent       ║");
console.log("╠════════════════════════════════════════════════════════════╣");
console.log("║  Press keys to see their byte codes                        ║");
console.log("║  Press 'q' to quit                                         ║");
console.log("║                                                            ║");
console.log("║  Try:                                                      ║");
console.log("║    Ctrl+]  → should show: [29]                            ║");
console.log("║    Ctrl+\\  → should show: [28]                            ║");
console.log("║    ESC     → should show: [27]                            ║");
console.log("║    ESC + s → should show: [27] then [115]                 ║");
console.log("╚════════════════════════════════════════════════════════════╝");
console.log("");

const buf = new Uint8Array(100);

while (true) {
  const n = await Deno.stdin.read(buf);
  if (n === null) break;

  const bytes = Array.from(buf.slice(0, n));
  // Special names for control characters
  const names: Record<number, string> = {
    27: "ESC",
    28: "Ctrl+\\",
    29: "Ctrl+]",
    13: "Enter",
    127: "Backspace",
    9: "Tab",
  };

  const byteNames = bytes.map(b => names[b] || (b >= 32 && b < 127 ? `'${String.fromCharCode(b)}'` : b.toString()));

  console.log(`Bytes: [${bytes.join(", ")}] = [${byteNames.join(", ")}]`);

  // Quit on 'q'
  if (bytes.length === 1 && bytes[0] === 113) {
    break;
  }
}

// Restore terminal
Deno.stdin.setRaw(false);
console.log("\nBye!");
