#!/usr/bin/env -S deno run --allow-net --allow-read --allow-env
/**
 * Test EXACTLY what /config displays and uses
 *
 * This simulates the EXACT ConfigPanel.tsx code path:
 * 1. Fetch from /api/tags (line 122)
 * 2. Format as `ollama/${m.name}` (line 125)
 * 3. Extract for API call (runtime.ts:123)
 * 4. Call Ollama API
 */

const OLLAMA_API = "http://localhost:11434";

// EXACT extraction function from runtime.ts:123
function extractModelName(model: string): string {
  const i = model.indexOf("/");
  return i >= 0 ? model.slice(i + 1) : model;
}

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════╗
║  TEST EXACTLY WHAT /config DISPLAYS                                       ║
╠═══════════════════════════════════════════════════════════════════════════╣
║  Simulates ConfigPanel.tsx EXACTLY:                                       ║
║  1. fetch(\`\${endpoint}/api/tags\`)     (line 122)                         ║
║  2. \`ollama/\${m.name}\`                 (line 125)                         ║
║  3. extractModelName()                 (runtime.ts:123)                   ║
║  4. Call Ollama /api/generate                                             ║
╚═══════════════════════════════════════════════════════════════════════════╝
`);

  // Step 1: EXACTLY what ConfigPanel does (line 122)
  console.log("Step 1: Fetching from /api/tags (exactly like ConfigPanel.tsx:122)\n");

  const response = await fetch(`${OLLAMA_API}/api/tags`);
  if (!response.ok) {
    console.error("Failed to fetch /api/tags");
    Deno.exit(1);
  }

  const data = await response.json();

  // Step 2: EXACTLY what ConfigPanel does (line 125)
  const models = (data.models || []).map((m: { name: string }) => `ollama/${m.name}`);

  console.log("Step 2: ConfigPanel formats as (exactly like line 125):\n");
  console.log("  ┌────────────────────────────────────────────────────────────┐");
  console.log("  │ What /config displays (availableModels)                    │");
  console.log("  ├────────────────────────────────────────────────────────────┤");
  for (const m of models) {
    console.log(`  │  ${m.padEnd(56)} │`);
  }
  console.log("  └────────────────────────────────────────────────────────────┘\n");

  // Step 3 & 4: Test each model through our implementation
  console.log("Step 3 & 4: Testing each model through HQL implementation:\n");

  let passed = 0;
  let failed = 0;

  for (const configModel of models) {
    // Step 3: Extract (exactly like runtime.ts:123)
    const extractedName = extractModelName(configModel);

    // Step 4: Call Ollama API (exactly like ai.js)
    try {
      const genResponse = await fetch(`${OLLAMA_API}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: extractedName,
          prompt: "Say OK",
          stream: false,
          options: { num_predict: 5 }
        })
      });

      if (genResponse.ok) {
        const result = await genResponse.json();
        if (result.response) {
          console.log(`  ✅ ${configModel}`);
          console.log(`     └─ Extracted: "${extractedName}" → Response: "${result.response.trim().substring(0, 30)}..."`);
          passed++;
        } else {
          console.log(`  ❌ ${configModel} - Empty response`);
          failed++;
        }
      } else {
        const error = await genResponse.text();
        console.log(`  ❌ ${configModel} - ${error.substring(0, 50)}`);
        failed++;
      }
    } catch (err) {
      console.log(`  ❌ ${configModel} - ${err}`);
      failed++;
    }
  }

  // Summary
  console.log(`
═══════════════════════════════════════════════════════════════════════════
RESULTS
═══════════════════════════════════════════════════════════════════════════

Models shown in /config:  ${models.length}
Passed:                   ${passed}
Failed:                   ${failed}

Flow verified:
  /api/tags → "${data.models?.[0]?.name || 'model'}"
       ↓ ConfigPanel.tsx:125
  "ollama/${data.models?.[0]?.name || 'model'}"
       ↓ runtime.ts:123 extractModelName()
  "${data.models?.[0]?.name || 'model'}"
       ↓ ai.js fetch()
  POST /api/generate { model: "${data.models?.[0]?.name || 'model'}" }
`);

  if (failed === 0) {
    console.log(`\n✅ ALL ${passed} MODELS IN /config WORK CORRECTLY\n`);
  } else {
    console.log(`\n❌ ${failed} MODELS FAILED\n`);
    Deno.exit(1);
  }
}

main();
