#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env
/**
 * Test drag & drop -> auto-attach flow for vision models
 */

import { addAttachment } from "../src/hlvm/cli/repl/context.ts";

// Create a test 1x1 red PNG (minimal valid PNG)
const MINIMAL_PNG = new Uint8Array([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
  0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
  0x00, 0x01, 0x01, 0x01, 0x00, 0x18, 0xDD, 0x8D,
  0xB4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
  0x44, 0xAE, 0x42, 0x60, 0x82
]);

// Write test image
const testPath = "/tmp/drag-drop-test.png";
await Deno.writeFile(testPath, MINIMAL_PNG);
const bytes = await Deno.readFile(testPath);
const base64Data = btoa(String.fromCharCode(...bytes));

console.log("=== DRAG & DROP -> AUTO-ATTACH TEST ===\n");

// Simulate drag & drop: addAttachment with base64Data
console.log("1. Simulating drag & drop (addAttachment with base64Data)...");
addAttachment("image", "[Image #1]", testPath, "image/png", bytes.length, base64Data);

// Check globalThis.__hlvmMedia was populated
type HlvmMediaItem = {
  type: string;
  mimeType: string;
  data: string;
  source: string;
  __hlvm_media__: boolean;
};
const hqlMedia = (globalThis as Record<string, unknown>).__hlvmMedia as HlvmMediaItem[] || [];

console.log("2. Checking globalThis.__hlvmMedia...");
console.log("   Length:", hqlMedia.length);

// Helper to check if value is media object
const isMedia = (v: unknown): boolean => {
  if (v == null) return false;
  return (v as Record<string, unknown>).__hlvm_media__ === true;
};

if (hqlMedia.length > 0) {
  const media = hqlMedia[0];
  console.log("\n3. Media object structure:");
  console.log("   type:", media.type);
  console.log("   mimeType:", media.mimeType);
  console.log("   __hlvm_media__:", media.__hlvm_media__);
  console.log("   source:", media.source);
  console.log("   data length:", media.data?.length || 0, "chars");

  const images = hqlMedia
    .filter(m => isMedia(m) && m.type === "image")
    .map(m => m.data);

  console.log("\n4. __getImages() simulation:");
  console.log("   Would return", images.length, "image(s)");

  if (images.length > 0 && images[0].length > 0) {
    console.log("\n✅ SUCCESS: Drag & drop -> auto-attach WORKS!");
    console.log("\n   Usage in REPL:");
    console.log("   1. Drag & drop image onto REPL");
    console.log("   2. Type: (ask \"what's in this image?\")");
    console.log("   3. Vision model receives image automatically!");
  } else {
    console.log("\n❌ FAIL: Images array is empty");
    Deno.exit(1);
  }
} else {
  console.log("\n❌ FAIL: globalThis.__hlvmMedia is empty");
  Deno.exit(1);
}

// Cleanup
await Deno.remove(testPath);
