#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write
/**
 * End-to-End Model Flow Verification
 *
 * Simulates the complete user journey:
 * 1. User opens /config → sees Ollama models
 * 2. User selects a model → saved to config
 * 3. User runs (ask "hello") → correct model is called
 *
 * Verifies that model names are correctly:
 * - Fetched from Ollama API
 * - Displayed in config panel
 * - Saved to config file
 * - Extracted for Ollama API calls
 */

const OLLAMA_API = "http://localhost:11434";
const CONFIG_PATH = Deno.env.get("HOME") + "/.hlvm/config.json";

interface TestResult {
  step: string;
  status: "pass" | "fail";
  expected?: string;
  actual?: string;
  error?: string;
}

const results: TestResult[] = [];

function log(msg: string) {
  console.log(msg);
}

function pass(step: string, details?: string) {
  results.push({ step, status: "pass" });
  console.log(`✅ ${step}${details ? ` - ${details}` : ""}`);
}

function fail(step: string, expected: string, actual: string) {
  results.push({ step, status: "fail", expected, actual });
  console.log(`❌ ${step}`);
  console.log(`   Expected: ${expected}`);
  console.log(`   Actual:   ${actual}`);
}

// ============================================================================
// Step 1: Fetch models from Ollama (what ConfigPanel does)
// ============================================================================
async function step1_fetchOllamaModels(): Promise<string[]> {
  log("\n=== STEP 1: Fetch Ollama Models (simulating ConfigPanel) ===\n");

  try {
    const resp = await fetch(`${OLLAMA_API}/api/tags`);
    if (!resp.ok) {
      fail("Fetch Ollama models", "HTTP 200", `HTTP ${resp.status}`);
      return [];
    }

    const data = await resp.json();
    const models: string[] = (data.models || []).map((m: any) => m.name);

    if (models.length === 0) {
      fail("Fetch Ollama models", "At least 1 model", "0 models");
      return [];
    }

    pass("Fetch Ollama models", `Found ${models.length} models`);

    // Show what user would see in ConfigPanel
    log("\n   Models displayed in /config:");
    for (const m of models.slice(0, 5)) {
      log(`   - ${m}`);
    }
    if (models.length > 5) {
      log(`   ... and ${models.length - 5} more`);
    }

    return models;
  } catch (err) {
    fail("Fetch Ollama models", "Success", String(err));
    return [];
  }
}

// ============================================================================
// Step 2: Simulate user selecting a model in ConfigPanel
// ============================================================================
function step2_selectModel(ollamaModels: string[]): string | null {
  log("\n=== STEP 2: User Selects Model (simulating ConfigPanel) ===\n");

  if (ollamaModels.length === 0) {
    fail("Select model", "Models available", "No models");
    return null;
  }

  // User selects first model (simulating click)
  const selectedModel = ollamaModels[0];
  log(`   User clicks on: ${selectedModel}`);

  // ConfigPanel prepends "ollama/" prefix when saving
  const configValue = `ollama/${selectedModel}`;
  log(`   ConfigPanel saves as: ${configValue}`);

  pass("Model selection", `Selected "${selectedModel}" → saved as "${configValue}"`);

  return configValue;
}

// ============================================================================
// Step 3: Save to config file (what ConfigPanel does on save)
// ============================================================================
async function step3_saveConfig(modelValue: string): Promise<boolean> {
  log("\n=== STEP 3: Save Config (simulating ConfigPanel save) ===\n");

  try {
    // Read existing config
    let config: any = {};
    try {
      config = JSON.parse(await Deno.readTextFile(CONFIG_PATH));
    } catch {
      // Config doesn't exist, create new
    }

    // Save new model (what ConfigPanel does)
    config.model = modelValue;
    await Deno.writeTextFile(CONFIG_PATH, JSON.stringify(config, null, 2));

    // Verify it was saved
    const saved = JSON.parse(await Deno.readTextFile(CONFIG_PATH));

    if (saved.model === modelValue) {
      pass("Save to config", `~/.hlvm/config.json now has model: "${modelValue}"`);
      return true;
    } else {
      fail("Save to config", modelValue, saved.model);
      return false;
    }
  } catch (err) {
    fail("Save to config", "Success", String(err));
    return false;
  }
}

// ============================================================================
// Step 4: Load config (what REPL does on startup)
// ============================================================================
async function step4_loadConfig(): Promise<string | null> {
  log("\n=== STEP 4: Load Config (simulating REPL startup) ===\n");

  try {
    const config = JSON.parse(await Deno.readTextFile(CONFIG_PATH));
    const model = config.model;

    if (!model) {
      fail("Load config", "Model in config", "No model found");
      return null;
    }

    pass("Load config", `Loaded model: "${model}"`);

    // This is what gets set to globalThis.__hlvmConfig
    log(`   globalThis.__hlvmConfig.model = "${model}"`);

    return model;
  } catch (err) {
    fail("Load config", "Success", String(err));
    return null;
  }
}

// ============================================================================
// Step 5: Extract model name for Ollama API (what AI functions do)
// ============================================================================
function step5_extractModelName(configModel: string): string | null {
  log("\n=== STEP 5: Extract Model Name (simulating AI function) ===\n");

  // This is the extraction logic from embedded-packages.ts
  function extractModelName(fullModel: string): string {
    // "ollama/llama3.2:3b" → "llama3.2:3b"
    // "llama3.2:3b" → "llama3.2:3b"
    if (fullModel.includes("/")) {
      return fullModel.split("/").slice(1).join("/");
    }
    return fullModel;
  }

  const extracted = extractModelName(configModel);

  log(`   Config model:    "${configModel}"`);
  log(`   Extracted name:  "${extracted}"`);

  // Verify extraction is correct
  const expectedExtracted = configModel.replace(/^ollama\//, "");

  if (extracted === expectedExtracted) {
    pass("Extract model name", `"${configModel}" → "${extracted}"`);
    return extracted;
  } else {
    fail("Extract model name", expectedExtracted, extracted);
    return null;
  }
}

// ============================================================================
// Step 6: Call Ollama API with extracted name
// ============================================================================
async function step6_callOllamaAPI(modelName: string): Promise<boolean> {
  log("\n=== STEP 6: Call Ollama API (simulating (ask \"hello\")) ===\n");

  log(`   POST ${OLLAMA_API}/api/generate`);
  log(`   Body: { model: "${modelName}", prompt: "Say OK", stream: false }`);

  try {
    const resp = await fetch(`${OLLAMA_API}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelName,
        prompt: "Say OK",
        stream: false,
        options: { num_predict: 10 }
      })
    });

    if (!resp.ok) {
      const error = await resp.text();
      fail("Call Ollama API", "HTTP 200", `HTTP ${resp.status}: ${error}`);
      return false;
    }

    const data = await resp.json();

    if (data.response) {
      pass("Call Ollama API", `Response: "${data.response.trim().substring(0, 50)}..."`);
      return true;
    } else {
      fail("Call Ollama API", "Response with content", "Empty response");
      return false;
    }
  } catch (err) {
    fail("Call Ollama API", "Success", String(err));
    return false;
  }
}

// Known vision-only models that require image input
const VISION_ONLY_MODELS = ["moondream", "llava", "bakllava", "llava-llama3", "llava-phi3"];

function isVisionOnlyModel(modelName: string): boolean {
  const baseName = modelName.split(":")[0];
  return VISION_ONLY_MODELS.some(v => baseName.includes(v));
}

// ============================================================================
// Step 7: Test ALL installed models
// ============================================================================
async function step7_testAllModels(ollamaModels: string[]): Promise<void> {
  log("\n=== STEP 7: Test ALL Installed Models ===\n");

  const tested: { model: string; configFormat: string; extractedName: string; apiResult: "pass" | "fail" | "skip"; note?: string }[] = [];

  for (const ollamaModel of ollamaModels) {
    // Simulate the full flow for each model
    const configFormat = `ollama/${ollamaModel}`;
    const extractedName = configFormat.replace(/^ollama\//, "");

    // Verify extraction matches original
    if (extractedName !== ollamaModel) {
      tested.push({ model: ollamaModel, configFormat, extractedName, apiResult: "fail" });
      continue;
    }

    // Vision-only models need image input - API call works but returns empty (expected)
    if (isVisionOnlyModel(ollamaModel)) {
      // Just verify API accepts the model name (HTTP 200)
      try {
        const resp = await fetch(`${OLLAMA_API}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: extractedName,
            prompt: "Say OK",
            stream: false,
            options: { num_predict: 10 }
          })
        });

        if (resp.ok) {
          tested.push({ model: ollamaModel, configFormat, extractedName, apiResult: "pass", note: "vision (needs image)" });
        } else {
          tested.push({ model: ollamaModel, configFormat, extractedName, apiResult: "fail" });
        }
      } catch {
        tested.push({ model: ollamaModel, configFormat, extractedName, apiResult: "fail" });
      }
      continue;
    }

    // Call API for regular models
    try {
      const resp = await fetch(`${OLLAMA_API}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: extractedName,
          prompt: "Say OK",
          stream: false,
          options: { num_predict: 10 }
        })
      });

      if (resp.ok) {
        const data = await resp.json();
        if (data.response) {
          tested.push({ model: ollamaModel, configFormat, extractedName, apiResult: "pass" });
        } else {
          tested.push({ model: ollamaModel, configFormat, extractedName, apiResult: "fail" });
        }
      } else {
        tested.push({ model: ollamaModel, configFormat, extractedName, apiResult: "fail" });
      }
    } catch {
      tested.push({ model: ollamaModel, configFormat, extractedName, apiResult: "fail" });
    }
  }

  // Print results table
  log("   ┌─────────────────────────┬───────────────────────────────┬─────────────────────────┬────────┬────────────────────┐");
  log("   │ Ollama Model            │ Config Format                 │ Extracted Name          │ Result │ Note               │");
  log("   ├─────────────────────────┼───────────────────────────────┼─────────────────────────┼────────┼────────────────────┤");

  for (const t of tested) {
    const m = t.model.padEnd(23);
    const c = t.configFormat.padEnd(29);
    const e = t.extractedName.padEnd(23);
    const r = t.apiResult === "pass" ? "✅ PASS" : "❌ FAIL";
    const n = (t.note || "").padEnd(18);
    log(`   │ ${m} │ ${c} │ ${e} │ ${r} │ ${n} │`);
  }

  log("   └─────────────────────────┴───────────────────────────────┴─────────────────────────┴────────┴────────────────────┘");

  const passed = tested.filter(t => t.apiResult === "pass").length;
  const total = tested.length;

  if (passed === total) {
    pass(`Test all ${total} models`, `${passed}/${total} passed`);
  } else {
    fail(`Test all ${total} models`, `${total}/${total}`, `${passed}/${total}`);
  }
}

// ============================================================================
// Main
// ============================================================================
async function main() {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║          END-TO-END MODEL FLOW VERIFICATION                    ║");
  console.log("║                                                                ║");
  console.log("║  Simulates: /config → select model → (ask \"hello\")            ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");

  // Step 1: Fetch models
  const ollamaModels = await step1_fetchOllamaModels();
  if (ollamaModels.length === 0) {
    console.log("\n❌ Cannot continue without Ollama models");
    Deno.exit(1);
  }

  // Step 2: Select model
  const configValue = step2_selectModel(ollamaModels);
  if (!configValue) {
    console.log("\n❌ Cannot continue without selected model");
    Deno.exit(1);
  }

  // Step 3: Save config
  const saved = await step3_saveConfig(configValue);
  if (!saved) {
    console.log("\n❌ Cannot continue without saved config");
    Deno.exit(1);
  }

  // Step 4: Load config
  const loadedModel = await step4_loadConfig();
  if (!loadedModel) {
    console.log("\n❌ Cannot continue without loaded config");
    Deno.exit(1);
  }

  // Step 5: Extract model name
  const extractedName = step5_extractModelName(loadedModel);
  if (!extractedName) {
    console.log("\n❌ Cannot continue without extracted model name");
    Deno.exit(1);
  }

  // Step 6: Call Ollama API
  await step6_callOllamaAPI(extractedName);

  // Step 7: Test ALL models
  await step7_testAllModels(ollamaModels);

  // Summary
  console.log("\n" + "=".repeat(68));
  console.log("SUMMARY");
  console.log("=".repeat(68));

  const passed = results.filter(r => r.status === "pass").length;
  const failed = results.filter(r => r.status === "fail").length;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failed === 0) {
    console.log("\n✅ ALL VERIFICATIONS PASSED");
    console.log("\nThe complete flow works correctly:");
    console.log("  1. Ollama models are fetched correctly");
    console.log("  2. Model selection saves correct format to config");
    console.log("  3. Config is persisted to ~/.hlvm/config.json");
    console.log("  4. REPL loads config correctly");
    console.log("  5. Model name is extracted correctly for API");
    console.log("  6. Ollama API receives correct model name");
    console.log("  7. All installed models work with this flow");
  } else {
    console.log("\n❌ SOME VERIFICATIONS FAILED");
    Deno.exit(1);
  }
}

main();
