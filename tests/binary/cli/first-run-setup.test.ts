/**
 * Deterministic binary coverage for first-run setup gating.
 *
 * Live onboarding and daemon-dependent flows are intentionally excluded from
 * the core binary suite. The remaining tests verify the user-visible gate
 * conditions that should never depend on Ollama availability.
 */

import { assertEquals } from "https://deno.land/std@0.218.0/assert/mod.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { runCLI, withTempDir } from "../_shared/binary-helpers.ts";

const platform = getPlatform();

Deno.test({
  name: "first-run gate: piped stdin skips setup (no Welcome message)",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withTempDir(async (dir) => {
      const result = await runCLI("ask", ["hello"], {
        cwd: dir,
        env: { HLVM_DIR: dir },
      });

      const output = result.stdout + result.stderr;
      assertEquals(output.includes("Welcome to HLVM!"), false);
      assertEquals(output.includes("Continue? [Y/n]"), false);
    });
  },
});

Deno.test({
  name: "first-run gate: --model flag skips setup even with fresh config",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withTempDir(async (dir) => {
      const result = await runCLI(
        "ask",
        ["--model", "ollama/llama3.1:8b", "what is 2+2"],
        { cwd: dir, env: { HLVM_DIR: dir } },
      );

      const output = result.stdout + result.stderr;
      assertEquals(output.includes("Welcome to HLVM!"), false);
    });
  },
});

Deno.test({
  name: "first-run gate: modelConfigured=true in config skips setup",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withTempDir(async (dir) => {
      await platform.fs.writeTextFile(
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
      assertEquals(output.includes("Welcome to HLVM!"), false);
    });
  },
});
