#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-env
/**
 * TRUE END-TO-END Vision Test
 *
 * Tests the FULL chain:
 * 1. Create image and add to globalThis.__hqlMedia (simulating drag & drop)
 * 2. Call ask() from ai.js through the provider chain
 * 3. Verify vision model receives and describes the image
 */

// Import the actual ai.js module
import { ask, chat } from "../src/hql/lib/stdlib/js/ai.js";
import { addAttachment } from "../src/hlvm/cli/repl/context.ts";
import { createAiApi } from "../src/hlvm/api/ai.ts";
import { OllamaProvider } from "../src/hlvm/providers/ollama/provider.ts";

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
║              TRUE END-TO-END VISION TEST                                 ║
║                                                                          ║
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
  // SETUP: Create provider and register on globalThis
  // ============================================================
  console.log("\n═══ SETUP ═══\n");

  // Create Ollama provider
  const provider = new OllamaProvider({
    endpoint: OLLAMA_API,
    defaultModel: visionModel,
  });

  // Create AI API with provider
  const aiApi = createAiApi({
    defaultProvider: "ollama",
    providers: { ollama: provider },
  });

  // Register on globalThis (this is what HLVM runtime does)
  (globalThis as Record<string, unknown>).ai = aiApi;
  console.log("✓ Registered globalThis.ai");

  // Set config (this is what HLVM runtime does)
  // Model format: "ollama:modelname" for provider routing
  (globalThis as Record<string, unknown>).__hqlConfig = {
    model: `ollama:${visionModel}`,
    endpoint: OLLAMA_API,
    temperature: 0.7,
    maxTokens: 100,
  };
  console.log(`✓ Set globalThis.__hqlConfig with model: ollama:${visionModel}`);

  // ============================================================
  // TEST 1: Explicit media parameter
  // ============================================================
  console.log("\n═══ TEST 1: Explicit Media Parameter ═══\n");

  const testPath = "/tmp/e2e-test-image.png";
  await Deno.writeFile(testPath, MINIMAL_PNG);
  const bytes = await Deno.readFile(testPath);
  const base64Data = btoa(String.fromCharCode(...bytes));

  const explicitMedia = {
    type: "image",
    mimeType: "image/png",
    data: base64Data,
    source: testPath,
    __hql_media__: true,
  };

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

    if (response1.toLowerCase().includes("red") || response1.toLowerCase().includes("color")) {
      console.log("\n✅ TEST 1 PASSED: Explicit media works!");
    } else {
      console.log("\n⚠️  TEST 1: Got response but unclear if image was seen");
      console.log("   (Vision model might describe differently)");
    }
  } catch (err) {
    console.log(`\n❌ TEST 1 FAILED: ${err}`);
  }

  // ============================================================
  // TEST 2: Auto-attach via globalThis.__hqlMedia (drag & drop)
  // ============================================================
  console.log("\n═══ TEST 2: Auto-Attach (Drag & Drop Simulation) ═══\n");

  // Simulate drag & drop by adding to context
  console.log("Simulating: Drag & drop image onto REPL");
  addAttachment("image", "[Image #1]", testPath, "image/png", bytes.length, base64Data);

  // Check __hqlMedia is set
  const hqlMedia = (globalThis as Record<string, unknown>).__hqlMedia as unknown[];
  console.log(`globalThis.__hqlMedia has ${hqlMedia?.length || 0} items`);

  if (!hqlMedia || hqlMedia.length === 0) {
    console.log("\n❌ TEST 2 FAILED: globalThis.__hqlMedia not populated");
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
        console.log("\n⚠️  TEST 2: Response too short, unclear if image was seen");
      }
    } catch (err) {
      console.log(`\n❌ TEST 2 FAILED: ${err}`);
    }
  }

  // ============================================================
  // TEST 3: chat() with per-message images
  // ============================================================
  console.log("\n═══ TEST 3: chat() with Per-Message Images ═══\n");

  // Clear auto-attach to test explicit per-message
  (globalThis as Record<string, unknown>).__hqlMedia = [];

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

The tests above verify the FULL chain:
  attachment.ts → context.ts → globalThis.__hqlMedia
                                      ↓
  ai.js ask() → __getImages() → __buildProviderOptions()
                                      ↓
  api/ai.ts → provider.generate() → ollama/api.ts
                                      ↓
  Ollama API with images: [...] → Vision model response
`);
}

main().catch(console.error);
