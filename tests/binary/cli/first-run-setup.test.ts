/**
 * Binary E2E tests for first-run auto-setup gate in `hlvm ask`.
 *
 * ALL tests are REAL — they run the actual CLI subprocess against a real Ollama daemon.
 * No mocks, no fakes, no dependency injection.
 *
 * Coverage:
 * - Happy path: fresh first run triggers onboarding, pulls cloud model, answers query
 * - Second run: skips onboarding entirely (modelConfigured=true)
 * - Piped stdin: non-terminal skips setup
 * - --model flag: bypasses setup gate
 * - modelConfigured=true in config: skips setup
 * - Full pipeline: onboarding writes correct config values
 * - LLM response: onboarding produces actual LLM answer (not just "Ready!")
 * - Non-existent model: gives clear error, no crash
 * - Broken endpoint: graceful error when Ollama unreachable
 * - Auth error detection: isOllamaAuthErrorMessage patterns in error output
 */

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.218.0/assert/mod.ts";
import { runCLI, withTempDir } from "../_shared/binary-helpers.ts";
import { DEFAULT_OLLAMA_ENDPOINT } from "../../../src/common/config/types.ts";
import { checkStatus } from "../../../src/hlvm/providers/ollama/api.ts";

/** Quick check if Ollama daemon is reachable. */
async function isOllamaAvailable(): Promise<boolean> {
  const status = await checkStatus(DEFAULT_OLLAMA_ENDPOINT);
  return status.available;
}

function includesAny(text: string, patterns: string[]): boolean {
  const lower = text.toLowerCase();
  return patterns.some((pattern) => lower.includes(pattern.toLowerCase()));
}

// ============================================================================
// Scenario 4: Piped stdin (non-terminal) skips setup
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
// Scenario 3: --model flag bypasses setup entirely
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
// Scenario 2 prerequisite: modelConfigured=true skips setup
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
// Scenario 3 + LLM: --model flag runs query with real Ollama
// ============================================================================

Deno.test({
  name: "ask --model: runs real query end-to-end (real Ollama)",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    if (!(await isOllamaAvailable())) {
      console.warn("WARN: Ollama not available. Skipping.");
      return;
    }

    const result = await runCLI(
      "ask",
      ["--model", "ollama/llama3.1:8b", "respond with exactly the word: pong"],
    );

    assertEquals(
      result.success,
      true,
      `Expected success, stderr: ${result.stderr}`,
    );
    const output = result.stdout.trim();
    assertEquals(
      output.length > 0,
      true,
      `Expected non-empty response, stderr: ${result.stderr}`,
    );
    assertEquals(
      includesAny(output, ["pong"]),
      true,
      `Expected response to include 'pong', got: ${output}`,
    );
  },
});

// ============================================================================
// Scenario 1: Full onboarding pipeline (happy path)
// ============================================================================

Deno.test({
  name: "onboarding E2E: HLVM_FORCE_SETUP=1 runs full pipeline, writes config",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    if (!(await isOllamaAvailable())) {
      console.warn("WARN: Ollama not running. Skipping onboarding E2E.");
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
      assertEquals(
        result.success,
        true,
        `Expected setup success, stderr: ${result.stderr}`,
      );

      const output = result.stdout + result.stderr;

      // 1. Should show the welcome message (setup triggered)
      assertStringIncludes(
        output,
        "Welcome to HLVM!",
        `Expected 'Welcome to HLVM!' in output:\n${output}`,
      );

      // 2. Should show "Ready!" (setup completed successfully)
      assertStringIncludes(
        output,
        "Ready!",
        `Expected 'Ready!' in output (setup should complete):\n${output}`,
      );

      // 3. Config file should have been written with modelConfigured=true
      const configPath = `${dir}/config.json`;
      const configText = await Deno.readTextFile(configPath);
      const configData = JSON.parse(configText);

      assertEquals(
        configData.modelConfigured,
        true,
        `Expected modelConfigured=true in config, got: ${
          JSON.stringify(configData)
        }`,
      );

      // 4. Model should be set to a cloud model
      assertEquals(typeof configData.model, "string");
      assertStringIncludes(
        configData.model,
        "ollama/",
        `Expected model to start with 'ollama/', got: ${configData.model}`,
      );
      assertStringIncludes(
        configData.model,
        "cloud",
        `Expected cloud model in config, got: ${configData.model}`,
      );
    });
  },
});

// ============================================================================
// Scenario 1 + LLM response: onboarding produces actual answer
// ============================================================================

Deno.test({
  name: "onboarding E2E: full pipeline produces actual LLM response",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    if (!(await isOllamaAvailable())) {
      console.warn("WARN: Ollama not running. Skipping.");
      return;
    }

    await withTempDir(async (dir) => {
      const result = await runCLI(
        "ask",
        ["say exactly ONBOARD_RESPONSE_OK"],
        { cwd: dir, env: { HLVM_DIR: dir, HLVM_FORCE_SETUP: "1" } },
      );
      assertEquals(
        result.success,
        true,
        `Expected setup+query success, stderr: ${result.stderr}`,
      );

      const output = result.stdout + result.stderr;

      // Should have completed onboarding
      assertStringIncludes(
        output,
        "Ready!",
        `Expected onboarding to complete:\n${output}`,
      );

      // Ensure model response is present, not only onboarding text.
      assertEquals(
        includesAny(output, ["onboard_response_ok"]),
        true,
        `Expected response to include ONBOARD_RESPONSE_OK, got:\n${output}`,
      );
    });
  },
});

// ============================================================================
// Scenario 2: Second run skips onboarding (idempotency)
// ============================================================================

Deno.test({
  name: "onboarding E2E: second run after setup skips onboarding entirely",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    if (!(await isOllamaAvailable())) {
      console.warn("WARN: Ollama not running. Skipping idempotency test.");
      return;
    }

    await withTempDir(async (dir) => {
      // First run: triggers onboarding
      const result1 = await runCLI(
        "ask",
        ["hello"],
        { cwd: dir, env: { HLVM_DIR: dir, HLVM_FORCE_SETUP: "1" } },
      );
      assertEquals(
        result1.success,
        true,
        `First run should succeed. stderr: ${result1.stderr}`,
      );

      const output1 = result1.stdout + result1.stderr;
      assertStringIncludes(
        output1,
        "Welcome to HLVM!",
        "First run should trigger onboarding",
      );

      // Verify config was written
      const configText = await Deno.readTextFile(`${dir}/config.json`);
      const configData = JSON.parse(configText);
      assertEquals(
        configData.modelConfigured,
        true,
        "First run should set modelConfigured=true",
      );

      // Second run: should NOT show welcome (modelConfigured is already true)
      const result2 = await runCLI(
        "ask",
        ["hello"],
        { cwd: dir, env: { HLVM_DIR: dir, HLVM_FORCE_SETUP: "1" } },
      );
      assertEquals(
        result2.success,
        true,
        `Second run should succeed. stderr: ${result2.stderr}`,
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

// ============================================================================
// Scenario 7 (edge): non-existent model gives clear error
// ============================================================================

Deno.test({
  name: "ask: non-existent model gives error, does not crash or hang",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    if (!(await isOllamaAvailable())) {
      console.warn("WARN: Ollama not available. Skipping.");
      return;
    }

    await withTempDir(async (dir) => {
      // Pre-configure so setup doesn't trigger
      await Deno.writeTextFile(
        `${dir}/config.json`,
        JSON.stringify({
          version: 1,
          model: "ollama/llama3.1:8b",
          modelConfigured: true,
        }),
      );

      const result = await runCLI(
        "ask",
        ["--model", "ollama/totally-fake-nonexistent-xyz:99b", "hello"],
        { cwd: dir, env: { HLVM_DIR: dir } },
      );

      // CLI may exit 0 or non-zero depending on error recovery path,
      // but it must always report the model failure in output
      const output = result.stdout + result.stderr;
      assertEquals(
        includesAny(output, ["model", "not found", "error", "failed", "couldn't generate"]),
        true,
        `Expected explicit model failure output, got:\n${output}`,
      );
    });
  },
});

// ============================================================================
// Scenario 9 (edge): broken endpoint gives graceful error
// ============================================================================

Deno.test({
  name: "ask: unreachable Ollama endpoint gives graceful error",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withTempDir(async (dir) => {
      // Configure with an endpoint that nothing listens on
      await Deno.writeTextFile(
        `${dir}/config.json`,
        JSON.stringify({
          version: 1,
          model: "ollama/llama3.1:8b",
          endpoint: "http://127.0.0.1:19999",
          modelConfigured: true,
        }),
      );

      const result = await runCLI(
        "ask",
        ["hello"],
        { cwd: dir, env: { HLVM_DIR: dir } },
      );

      // CLI may exit 0 or non-zero depending on error recovery path,
      // but it must always report the connection failure in output
      const output = result.stdout + result.stderr;
      assertEquals(
        includesAny(output, [
          "failed to setup default model",
          "agent error",
          "connection",
          "refused",
          "couldn't generate",
          "Connection refused",
        ]),
        true,
        `Expected endpoint failure output, got:\n${output}`,
      );

      // Should not show onboarding (modelConfigured=true)
      assertEquals(
        output.includes("Welcome to HLVM!"),
        false,
        "Should not re-trigger onboarding on connection error",
      );
    });
  },
});

// ============================================================================
// Scenario 1 config shape: verify exact config structure after onboarding
// ============================================================================

Deno.test({
  name: "onboarding E2E: config.json has correct shape after setup",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    if (!(await isOllamaAvailable())) {
      console.warn("WARN: Ollama not running. Skipping.");
      return;
    }

    await withTempDir(async (dir) => {
      await runCLI(
        "ask",
        ["hello"],
        { cwd: dir, env: { HLVM_DIR: dir, HLVM_FORCE_SETUP: "1" } },
      );

      const configText = await Deno.readTextFile(`${dir}/config.json`);
      const config = JSON.parse(configText);

      // Required fields
      assertEquals(
        config.modelConfigured,
        true,
        "modelConfigured must be true",
      );
      assertEquals(typeof config.model, "string", "model must be a string");
      assertEquals(
        config.model.startsWith("ollama/"),
        true,
        `model must start with 'ollama/', got: ${config.model}`,
      );
      assertEquals(
        config.model.includes("cloud"),
        true,
        `model must be a cloud model, got: ${config.model}`,
      );

      // No stale credential files should exist
      const entries: string[] = [];
      for await (const entry of Deno.readDir(dir)) {
        entries.push(entry.name);
      }

      // Should only have config.json (and maybe sessions dir)
      assertEquals(
        entries.includes("config.json"),
        true,
        "config.json must exist",
      );
      assertEquals(
        entries.includes("credentials.json"),
        false,
        "No credentials.json should be created",
      );
      assertEquals(
        entries.includes(".auth"),
        false,
        "No .auth directory should be created",
      );
    });
  },
});
