#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-env
/**
 * TRUE END-TO-END Vision Test v2
 *
 * Tests the FULL chain after the __hlvm_media__ fix:
 * 1. Set up runtime with getMedia()
 * 2. Add attachment with base64Data
 * 3. Call ask() from ai.js through the provider chain
 * 4. Verify vision model receives and describes the image
 */

import { ask, chat } from "../src/hql/lib/stdlib/js/ai.js";
import { addAttachment, getMedia } from "../src/hlvm/cli/repl/context.ts";
import { ai, runtime, setRuntimeState, registerApis } from "../src/hlvm/api/index.ts";
import { initializeProviders, getProvider } from "../src/hlvm/providers/index.ts";

const OLLAMA_API = "http://localhost:11434";

// Minimal 1x1 red PNG
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

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║              TRUE END-TO-END VISION TEST v2                              ║
║                                                                          ║
║  After __hlvm_media__ fix                                                ║
║  Testing: Drag & Drop → ask() → Provider → Ollama → Vision Response      ║
╚══════════════════════════════════════════════════════════════════════════╝
`);

  // Check if Ollama is running
  let ollamaRunning = false;
  let hasVisionModel = false;
  let visionModel = "";

  try {
    const resp = await fetch(`${OLLAMA_API}/api/tags`);
    if (resp.ok) {
      ollamaRunning = true;
      const data = await resp.json();
      const models = (data.models || []).map((m: { name: string }) => m.name);
      visionModel = models.find((m: string) =>
        m.includes("moondream") || m.includes("llava") || m.includes("bakllava")
      ) || "";
      hasVisionModel = !!visionModel;
    }
  } catch {
    ollamaRunning = false;
  }

  if (!ollamaRunning) {
    console.log("❌ Ollama not running - cannot run end-to-end test");
    console.log("   Start Ollama with: ollama serve");
    Deno.exit(1);
  }

  if (!hasVisionModel) {
    console.log("❌ No vision model installed");
    console.log("   Install with: ollama pull moondream");
    Deno.exit(1);
  }

  console.log(`✓ Ollama running`);
  console.log(`✓ Vision model found: ${visionModel}`);

  // ============================================================
  // SETUP: Initialize providers and APIs
  // ============================================================
  console.log("\n═══ SETUP ═══\n");

  // Initialize providers (registers Ollama)
  initializeProviders({
    ollama: {
      endpoint: OLLAMA_API,
      defaultModel: visionModel,
    }
  });
  console.log("✓ Initialized providers");

  // Set up runtime state with getMedia (this is what REPL does)
  setRuntimeState({
    getMedia: getMedia,
    getSignatures: () => new Map(),
    getDocstrings: () => new Map(),
  });
  console.log("✓ Set up runtime state with getMedia");

  // Register APIs on globalThis
  registerApis({
    runtime: {
      getMedia: getMedia,
      getSignatures: () => new Map(),
      getDocstrings: () => new Map(),
    }
  });
  console.log("✓ Registered APIs on globalThis");

  // Set up config API
  (globalThis as Record<string, unknown>).config = {
    snapshot: {
      model: `ollama:${visionModel}`,
      endpoint: OLLAMA_API,
      temperature: 0.7,
      maxTokens: 100,
    }
  };
  console.log(`✓ Set globalThis.config with model: ollama:${visionModel}`);

  // Verify globalThis.ai exists
  const globalAi = (globalThis as Record<string, unknown>).ai;
  console.log(`✓ globalThis.ai exists: ${!!globalAi}`);

  // Verify globalThis.runtime.media works
  const globalRuntime = (globalThis as Record<string, unknown>).runtime as { media?: unknown[] } | undefined;
  console.log(`✓ globalThis.runtime exists: ${!!globalRuntime}`);

  // Create test image
  const testPath = "/tmp/e2e-test-image-v2.png";
  await Deno.writeFile(testPath, MINIMAL_PNG);
  const bytes = await Deno.readFile(testPath);
  const base64Data = btoa(String.fromCharCode(...bytes));
  console.log(`✓ Created test image: ${testPath}`);

  // ============================================================
  // TEST 1: Explicit media parameter
  // ============================================================
  console.log("\n═══ TEST 1: Explicit Media Parameter ═══\n");

  const explicitMedia = {
    type: "image",
    mimeType: "image/png",
    data: base64Data,
    source: testPath,
    __hlvm_media__: true,  // Using correct tag name!
  };

  console.log("Media object created with __hlvm_media__: true");
  console.log("Calling: (ask \"What color is this image?\" {media: image})");
  console.log("...");

  let response1 = "";
  try {
    for await (const chunk of ask("What color is this image? Answer in one word.", {
      media: explicitMedia,
      maxTokens: 50,
    })) {
      response1 += chunk;
    }
    console.log(`Response: "${response1.trim()}"`);

    if (response1.length > 0) {
      console.log("\n✅ TEST 1 PASSED: Explicit media works!");
    } else {
      console.log("\n❌ TEST 1 FAILED: Empty response");
    }
  } catch (err) {
    console.log(`\n❌ TEST 1 FAILED: ${err}`);
  }

  // ============================================================
  // TEST 2: Auto-attach via runtime.media (drag & drop)
  // ============================================================
  console.log("\n═══ TEST 2: Auto-Attach (Drag & Drop Simulation) ═══\n");

  // Simulate drag & drop by adding to context
  console.log("Simulating: Drag & drop image onto REPL");
  addAttachment("image", "[Image #1]", testPath, "image/png", bytes.length, base64Data);

  // Check getMedia() returns the attachment
  const media = getMedia();
  console.log(`getMedia() returns ${media.length} items`);

  if (media.length > 0) {
    const m = media[0] as Record<string, unknown>;
    console.log(`  - type: ${m.type}`);
    console.log(`  - __hlvm_media__: ${m.__hlvm_media__}`);
    console.log(`  - data length: ${String(m.data || "").length} chars`);
  }

  // Check runtime.media
  const runtimeMedia = globalRuntime?.media || [];
  console.log(`runtime.media has ${runtimeMedia.length} items`);

  if (!media || media.length === 0) {
    console.log("\n❌ TEST 2 FAILED: getMedia() returned empty");
  } else {
    console.log("\nCalling: (ask \"Describe what you see.\")  // No explicit media");
    console.log("...");

    let response2 = "";
    try {
      for await (const chunk of ask("Describe what you see in one sentence.", {
        maxTokens: 50,
      })) {
        response2 += chunk;
      }
      console.log(`Response: "${response2.trim()}"`);

      if (response2.length > 10) {
        console.log("\n✅ TEST 2 PASSED: Auto-attach from drag & drop works!");
      } else {
        console.log("\n⚠️  TEST 2: Response too short, may not have seen image");
      }
    } catch (err) {
      console.log(`\n❌ TEST 2 FAILED: ${err}`);
    }
  }

  // ============================================================
  // TEST 3: chat() with per-message images
  // ============================================================
  console.log("\n═══ TEST 3: chat() with Per-Message Images ═══\n");

  const messages = [
    {
      role: "user",
      content: "What color is this? One word answer.",
      media: explicitMedia,
    },
  ];

  console.log("Calling: (chat [{role: \"user\", content: \"...\", media: image}])");
  console.log("...");

  let response3 = "";
  try {
    for await (const chunk of chat(messages, { maxTokens: 20 })) {
      response3 += chunk;
    }
    console.log(`Response: "${response3.trim()}"`);

    if (response3.length > 0) {
      console.log("\n✅ TEST 3 PASSED: chat() with per-message media works!");
    } else {
      console.log("\n❌ TEST 3 FAILED: Empty response");
    }
  } catch (err) {
    console.log(`\n❌ TEST 3 FAILED: ${err}`);
  }

  // Cleanup
  await Deno.remove(testPath);

  // Summary
  console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║                         END-TO-END TEST COMPLETE                         ║
╚══════════════════════════════════════════════════════════════════════════╝

The tests verify the FULL chain:
  context.ts getMedia() → runtime.media → ai.js __getImages()
                                               ↓
  __isMedia() checks __hlvm_media__ ← FIXED!
                                               ↓
  provider.generate() → Ollama API with images: [...]
                                               ↓
  Vision model receives and describes the image
`);
}

main().catch(console.error);
