/**
 * Binary E2E tests for first-run auto-setup gate in `hlvm ask`.
 *
 * These run the actual CLI subprocess and verify:
 * - Non-interactive stdin (piped) skips the first-run setup
 * - --model flag bypasses the first-run gate entirely
 * - modelConfigured=true in config skips the first-run gate
 * - HLVM_FORCE_SETUP=1 triggers the full onboarding pipeline (real Ollama)
 * - After onboarding, config.json has modelConfigured=true and a cloud model
 * - Second run after onboarding skips setup entirely
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.218.0/assert/mod.ts";
import {
  runCLI,
  withTempDir,
} from "../_shared/binary-helpers.ts";
import { DEFAULT_OLLAMA_ENDPOINT } from "../../../src/common/config/types.ts";
import { checkStatus } from "../../../src/hlvm/providers/ollama/api.ts";

/** Quick check if Ollama daemon is reachable. */
async function isOllamaAvailable(): Promise<boolean> {
  const status = await checkStatus(DEFAULT_OLLAMA_ENDPOINT);
  return status.available;
}

// ============================================================================
// First-run gate: piped stdin (non-terminal) skips setup
// ============================================================================

Deno.test({
  name: "first-run gate: piped stdin skips setup (no Welcome message)",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withTempDir(async (dir) => {
      // Fresh HLVM_DIR with no config → modelConfigured is false
      // But stdin is piped (not a terminal) → setup gate should NOT trigger
      const result = await runCLI("ask", ["hello"], {
        cwd: dir,
        env: { HLVM_DIR: dir },
      });

      const output = result.stdout + result.stderr;

      // Should NOT show the welcome/setup prompt
      assertEquals(
        output.includes("Welcome to HLVM!"),
        false,
        `Expected no 'Welcome to HLVM!' in piped mode, got:\n${output}`,
      );

      // Should NOT show "Continue? [Y/n]"
      assertEquals(
        output.includes("Continue? [Y/n]"),
        false,
        `Expected no confirmation prompt in piped mode, got:\n${output}`,
      );
    });
  },
});

// ============================================================================
// First-run gate: --model flag bypasses setup entirely
// ============================================================================

Deno.test({
  name: "first-run gate: --model flag skips setup even with fresh config",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withTempDir(async (dir) => {
      // Fresh HLVM_DIR + explicit --model → should skip first-run gate
      const result = await runCLI(
        "ask",
        ["--model", "ollama/llama3.1:8b", "what is 2+2"],
        { cwd: dir, env: { HLVM_DIR: dir } },
      );

      const output = result.stdout + result.stderr;

      // Should NOT show the welcome/setup prompt
      assertEquals(
        output.includes("Welcome to HLVM!"),
        false,
        `Expected no setup with --model flag, got:\n${output}`,
      );
    });
  },
});

// ============================================================================
// First-run gate: modelConfigured=true skips setup
// ============================================================================

Deno.test({
  name: "first-run gate: modelConfigured=true in config skips setup",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withTempDir(async (dir) => {
      // Write a config with modelConfigured=true
      await Deno.mkdir(dir, { recursive: true });
      await Deno.writeTextFile(
        `${dir}/config.json`,
        JSON.stringify({
          version: 1,
          model: "ollama/llama3.1:8b",
          endpoint: "http://localhost:11434",
          temperature: 0.7,
          maxTokens: 4096,
          theme: "dracula",
          modelConfigured: true,
        }),
      );

      const result = await runCLI("ask", ["hello"], {
        cwd: dir,
        env: { HLVM_DIR: dir },
      });

      const output = result.stdout + result.stderr;

      // Should NOT show the welcome/setup prompt
      assertEquals(
        output.includes("Welcome to HLVM!"),
        false,
        `Expected no setup with modelConfigured=true, got:\n${output}`,
      );
    });
  },
});

// ============================================================================
// ask command: --model flag works end-to-end with real Ollama
// ============================================================================

Deno.test({
  name: "ask --model: runs query with explicit model (real Ollama)",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    if (!(await isOllamaAvailable())) {
      console.warn("WARN: Ollama not available. Skipping E2E ask test.");
      return;
    }

    // This test requires a running Ollama daemon with llama3.1:8b
    // It verifies the full ask pipeline works end-to-end
    const result = await runCLI(
      "ask",
      ["--model", "ollama/llama3.1:8b", "respond with exactly the word: pong"],
    );

    // Should produce some output (the model's response)
    const output = result.stdout.trim();
    assertEquals(output.length > 0, true,
      `Expected non-empty response, got empty stdout. stderr: ${result.stderr}`);
  },
});

// ============================================================================
// Full onboarding pipeline E2E: HLVM_FORCE_SETUP=1 triggers real setup
// ============================================================================

Deno.test({
  name: "onboarding E2E: HLVM_FORCE_SETUP=1 runs full pipeline, writes config",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    if (!(await isOllamaAvailable())) {
      console.warn("WARN: Ollama not running. Skipping onboarding E2E test.");
      return;
    }

    await withTempDir(async (dir) => {
      // Fresh HLVM_DIR, no config.json → modelConfigured=false
      // HLVM_FORCE_SETUP=1 bypasses isTerminal() check and auto-confirms Y
      const result = await runCLI(
        "ask",
        ["hello"],
        { cwd: dir, env: { HLVM_DIR: dir, HLVM_FORCE_SETUP: "1" } },
      );

      const output = result.stdout + result.stderr;

      // 1. Should show the welcome message (setup triggered)
      assertStringIncludes(output, "Welcome to HLVM!",
        `Expected 'Welcome to HLVM!' in output:\n${output}`);

      // 2. Should show "Ready!" (setup completed)
      assertStringIncludes(output, "Ready!",
        `Expected 'Ready!' in output (setup should complete):\n${output}`);

      // 3. Config file should have been written with modelConfigured=true
      const configPath = `${dir}/config.json`;
      const configText = await Deno.readTextFile(configPath);
      const configData = JSON.parse(configText);

      assertEquals(configData.modelConfigured, true,
        `Expected modelConfigured=true in config, got: ${JSON.stringify(configData)}`);

      // 4. Model should be set to a cloud model
      assertEquals(typeof configData.model, "string");
      assertStringIncludes(configData.model, "ollama/",
        `Expected model to start with 'ollama/', got: ${configData.model}`);
      assertStringIncludes(configData.model, "cloud",
        `Expected cloud model in config, got: ${configData.model}`);
    });
  },
});

// ============================================================================
// Idempotency: second run after onboarding skips setup
// ============================================================================

Deno.test({
  name: "onboarding E2E: second run after setup skips onboarding entirely",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    if (!(await isOllamaAvailable())) {
      console.warn("WARN: Ollama not running. Skipping idempotency E2E test.");
      return;
    }

    await withTempDir(async (dir) => {
      // First run: triggers onboarding
      await runCLI(
        "ask",
        ["hello"],
        { cwd: dir, env: { HLVM_DIR: dir, HLVM_FORCE_SETUP: "1" } },
      );

      // Verify config was written
      const configText = await Deno.readTextFile(`${dir}/config.json`);
      const configData = JSON.parse(configText);
      assertEquals(configData.modelConfigured, true,
        "First run should have set modelConfigured=true");

      // Second run: should NOT show welcome (modelConfigured is already true)
      const result2 = await runCLI(
        "ask",
        ["hello"],
        { cwd: dir, env: { HLVM_DIR: dir, HLVM_FORCE_SETUP: "1" } },
      );

      const output2 = result2.stdout + result2.stderr;
      assertEquals(
        output2.includes("Welcome to HLVM!"),
        false,
        `Second run should skip setup, but got:\n${output2}`,
      );
    });
  },
});
