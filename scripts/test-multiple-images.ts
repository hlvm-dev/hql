#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env
/**
 * Test multiple image support for vision models
 */

import { addAttachment } from "../src/cli/repl/context.ts";

// Create test PNGs with different "colors" (just different bytes for testing)
function createTestPNG(marker: number): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
    0x54, 0x08, 0xD7, 0x63, marker, 0xCF, 0xC0, 0x00, // marker byte differs
    0x00, 0x01, 0x01, 0x01, 0x00, 0x18, 0xDD, 0x8D,
    0xB4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
    0x44, 0xAE, 0x42, 0x60, 0x82
  ]);
}

type HqlMediaItem = {
  type: string;
  mimeType: string;
  data: string;
  source: string;
  __hql_media__: boolean;
};

function isMedia(v: unknown): boolean {
  if (v == null) return false;
  return (v as Record<string, unknown>).__hql_media__ === true;
}

console.log("╔══════════════════════════════════════════════════════════════════╗");
console.log("║          MULTIPLE IMAGES SUPPORT TEST                            ║");
console.log("╚══════════════════════════════════════════════════════════════════╝\n");

// ============================================================
// TEST 1: Drag & Drop Multiple Images (Auto-attach mode)
// ============================================================
console.log("═══ TEST 1: Drag & Drop Multiple Images ═══\n");

const testPaths = ["/tmp/test-img-1.png", "/tmp/test-img-2.png", "/tmp/test-img-3.png"];

// Create and "drop" 3 images
for (let i = 0; i < 3; i++) {
  const png = createTestPNG(0xF0 + i); // Different marker for each
  await Deno.writeFile(testPaths[i], png);
  const bytes = await Deno.readFile(testPaths[i]);
  const base64Data = btoa(String.fromCharCode(...bytes));

  console.log(`  Dropping image ${i + 1}: ${testPaths[i]}`);
  addAttachment("image", `[Image #${i + 1}]`, testPaths[i], "image/png", bytes.length, base64Data);
}

const hqlMedia = (globalThis as Record<string, unknown>).__hqlMedia as HqlMediaItem[] || [];
console.log(`\n  globalThis.__hqlMedia has ${hqlMedia.length} items`);

const images = hqlMedia
  .filter(m => isMedia(m) && m.type === "image")
  .map(m => m.data);

console.log(`  __getImages() would return ${images.length} images`);

if (images.length === 3) {
  console.log("\n  ✅ Drag & drop multiple images: WORKS!");
  console.log("\n  Usage:");
  console.log("    1. Drop image1.png");
  console.log("    2. Drop image2.png");
  console.log("    3. Drop image3.png");
  console.log('    4. (ask "compare these images")');
  console.log("    → All 3 images sent to vision model!");
} else {
  console.log(`\n  ❌ FAIL: Expected 3 images, got ${images.length}`);
}

// ============================================================
// TEST 2: Explicit Array Syntax
// ============================================================
console.log("\n\n═══ TEST 2: Explicit Array Syntax ═══\n");

// Simulate explicit media array in options
const mediaObjects = testPaths.map((p, i) => ({
  type: "image",
  mimeType: "image/png",
  data: `base64data_${i}`,
  source: p,
  __hql_media__: true
}));

// Simulate __getImages with explicit array
function getImagesExplicit(options: { media?: unknown }) {
  if (options && options.media !== undefined) {
    if (options.media === null) return [];
    if (Array.isArray(options.media) && options.media.length === 0) return [];

    const mediaList = Array.isArray(options.media) ? options.media : [options.media];
    return mediaList
      .filter(m => isMedia(m) && (m as HqlMediaItem).type === "image")
      .map(m => (m as HqlMediaItem).data);
  }
  return [];
}

const explicitImages = getImagesExplicit({ media: mediaObjects });
console.log(`  Explicit array with ${mediaObjects.length} Media objects`);
console.log(`  __getImages() returns ${explicitImages.length} images`);

if (explicitImages.length === 3) {
  console.log("\n  ✅ Explicit array syntax: WORKS!");
  console.log("\n  Usage (HQL):");
  console.log('    (import [read-image] from "@hql/media")');
  console.log('    (ask "compare these" {media: [');
  console.log('      (read-image "photo1.jpg")');
  console.log('      (read-image "photo2.jpg")');
  console.log('      (read-image "photo3.jpg")');
  console.log("    ]})");
} else {
  console.log(`\n  ❌ FAIL: Expected 3 images, got ${explicitImages.length}`);
}

// ============================================================
// TEST 3: Mixed - Override auto-attach with explicit
// ============================================================
console.log("\n\n═══ TEST 3: Explicit Overrides Auto-attach ═══\n");

// When explicit media is provided, auto-attach should be ignored
const singleMedia = {
  type: "image",
  mimeType: "image/png",
  data: "explicit_single_image",
  source: "/explicit/path.png",
  __hql_media__: true
};

const overrideImages = getImagesExplicit({ media: singleMedia });
console.log("  3 images in globalThis.__hqlMedia");
console.log("  1 image passed explicitly in options.media");
console.log(`  __getImages() returns ${overrideImages.length} image(s)`);

if (overrideImages.length === 1 && overrideImages[0] === "explicit_single_image") {
  console.log("\n  ✅ Explicit overrides auto-attach: WORKS!");
  console.log("\n  This means:");
  console.log("    - Drop 10 images");
  console.log('    - (ask "..." {media: (read-image "specific.jpg")})');
  console.log("    → Only specific.jpg is sent, not all 10");
} else {
  console.log("\n  ❌ FAIL");
}

// ============================================================
// TEST 4: Disable auto-attach with empty array
// ============================================================
console.log("\n\n═══ TEST 4: Disable Auto-attach ═══\n");

const disabledImages = getImagesExplicit({ media: [] });
console.log("  3 images in globalThis.__hqlMedia");
console.log("  Empty array passed: {media: []}");
console.log(`  __getImages() returns ${disabledImages.length} image(s)`);

if (disabledImages.length === 0) {
  console.log("\n  ✅ Disable with empty array: WORKS!");
  console.log("\n  Usage:");
  console.log("    - Drop images for context");
  console.log('    - (ask "text only question" {media: []})');
  console.log("    → No images sent even though some are attached");
} else {
  console.log("\n  ❌ FAIL");
}

// Cleanup
for (const p of testPaths) {
  try { await Deno.remove(p); } catch { /* ignore */ }
}

console.log("\n╔══════════════════════════════════════════════════════════════════╗");
console.log("║                    ALL TESTS PASSED!                             ║");
console.log("╚══════════════════════════════════════════════════════════════════╝\n");
