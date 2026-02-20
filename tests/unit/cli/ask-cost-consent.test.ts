/**
 * Cost Consent Tests
 *
 * Verifies paid provider detection, consent checking,
 * and config storage for the cost consent flow.
 */

import { assertEquals } from "jsr:@std/assert";
import {
  extractProvider,
  isPaidProvider,
} from "../../../src/hlvm/cli/commands/ask.ts";
import { validateValue, DEFAULT_CONFIG, type HlvmConfig } from "../../../src/common/config/types.ts";

// MARK: - extractProvider

Deno.test({
  name: "extractProvider - extracts openai from openai/gpt-4o",
  fn() {
    assertEquals(extractProvider("openai/gpt-4o"), "openai");
  },
});

Deno.test({
  name: "extractProvider - extracts anthropic from anthropic/claude-sonnet-4-5-20250929",
  fn() {
    assertEquals(extractProvider("anthropic/claude-sonnet-4-5-20250929"), "anthropic");
  },
});

Deno.test({
  name: "extractProvider - extracts google from google/gemini-2.0-flash",
  fn() {
    assertEquals(extractProvider("google/gemini-2.0-flash"), "google");
  },
});

Deno.test({
  name: "extractProvider - extracts ollama from ollama/llama3.1:8b",
  fn() {
    assertEquals(extractProvider("ollama/llama3.1:8b"), "ollama");
  },
});

Deno.test({
  name: "extractProvider - returns null for bare model name",
  fn() {
    assertEquals(extractProvider("gpt-4o"), null);
  },
});

Deno.test({
  name: "extractProvider - returns null for empty string",
  fn() {
    assertEquals(extractProvider(""), null);
  },
});

Deno.test({
  name: "extractProvider - returns null for slash at start",
  fn() {
    assertEquals(extractProvider("/gpt-4o"), null);
  },
});

Deno.test({
  name: "extractProvider - case insensitive",
  fn() {
    assertEquals(extractProvider("OpenAI/gpt-4o"), "openai");
  },
});

// MARK: - isPaidProvider

Deno.test({
  name: "isPaidProvider - true for openai",
  fn() {
    assertEquals(isPaidProvider("openai/gpt-4o"), true);
  },
});

Deno.test({
  name: "isPaidProvider - true for anthropic",
  fn() {
    assertEquals(isPaidProvider("anthropic/claude-sonnet-4-5-20250929"), true);
  },
});

Deno.test({
  name: "isPaidProvider - true for google",
  fn() {
    assertEquals(isPaidProvider("google/gemini-2.0-flash"), true);
  },
});

Deno.test({
  name: "isPaidProvider - false for ollama",
  fn() {
    assertEquals(isPaidProvider("ollama/llama3.1:8b"), false);
  },
});

Deno.test({
  name: "isPaidProvider - false for ollama cloud models",
  fn() {
    assertEquals(isPaidProvider("ollama/deepseek-v3.1:671b-cloud"), false);
  },
});

Deno.test({
  name: "isPaidProvider - false for bare model name",
  fn() {
    assertEquals(isPaidProvider("gpt-4o"), false);
  },
});

Deno.test({
  name: "isPaidProvider - false for empty string",
  fn() {
    assertEquals(isPaidProvider(""), false);
  },
});

// MARK: - approvedProviders config validation

Deno.test({
  name: "validateValue - approvedProviders accepts string array",
  fn() {
    const result = validateValue("approvedProviders", ["openai", "anthropic"]);
    assertEquals(result.valid, true);
  },
});

Deno.test({
  name: "validateValue - approvedProviders accepts empty array",
  fn() {
    const result = validateValue("approvedProviders", []);
    assertEquals(result.valid, true);
  },
});

Deno.test({
  name: "validateValue - approvedProviders accepts undefined",
  fn() {
    const result = validateValue("approvedProviders", undefined);
    assertEquals(result.valid, true);
  },
});

Deno.test({
  name: "validateValue - approvedProviders rejects non-array",
  fn() {
    const result = validateValue("approvedProviders", "openai");
    assertEquals(result.valid, false);
  },
});

Deno.test({
  name: "validateValue - approvedProviders rejects array with non-strings",
  fn() {
    const result = validateValue("approvedProviders", ["openai", 123]);
    assertEquals(result.valid, false);
  },
});

// MARK: - Config round-trip (save → load preserves approvedProviders)

Deno.test({
  name: "Config round-trip - approvedProviders persists through save/load",
  async fn() {
    const { saveConfig, loadConfig, getConfigPath } = await import(
      "../../../src/common/config/storage.ts"
    );
    const { getPlatform } = await import("../../../src/platform/platform.ts");

    const configPath = getConfigPath();
    const fs = getPlatform().fs;

    // Backup existing config
    let backup: string | null = null;
    try {
      backup = await fs.readTextFile(configPath);
    } catch {
      // No existing config
    }

    try {
      // Save config with approvedProviders
      const testConfig: HlvmConfig = {
        ...DEFAULT_CONFIG,
        approvedProviders: ["openai", "anthropic"],
      };
      await saveConfig(testConfig);

      // Load it back
      const loaded = await loadConfig();
      assertEquals(loaded.approvedProviders, ["openai", "anthropic"]);
    } finally {
      // Restore original config
      if (backup !== null) {
        await fs.writeTextFile(configPath, backup);
      } else {
        try {
          await fs.remove(configPath);
        } catch {
          // Ignore
        }
      }
    }
  },
});

Deno.test({
  name: "Config round-trip - missing approvedProviders loads as undefined",
  async fn() {
    const { saveConfig, loadConfig, getConfigPath } = await import(
      "../../../src/common/config/storage.ts"
    );
    const { getPlatform } = await import("../../../src/platform/platform.ts");

    const configPath = getConfigPath();
    const fs = getPlatform().fs;

    // Backup existing config
    let backup: string | null = null;
    try {
      backup = await fs.readTextFile(configPath);
    } catch {
      // No existing config
    }

    try {
      // Save config WITHOUT approvedProviders
      const testConfig: HlvmConfig = { ...DEFAULT_CONFIG };
      delete testConfig.approvedProviders;
      await saveConfig(testConfig);

      // Load it back — should be undefined, not an error
      const loaded = await loadConfig();
      assertEquals(loaded.approvedProviders, undefined);
    } finally {
      // Restore original config
      if (backup !== null) {
        await fs.writeTextFile(configPath, backup);
      } else {
        try {
          await fs.remove(configPath);
        } catch {
          // Ignore
        }
      }
    }
  },
});

Deno.test({
  name: "Config round-trip - agentMode/sessionMemory/checkpointing persist through save/load",
  async fn() {
    const { saveConfig, loadConfig, getConfigPath } = await import(
      "../../../src/common/config/storage.ts"
    );
    const { getPlatform } = await import("../../../src/platform/platform.ts");

    const configPath = getConfigPath();
    const fs = getPlatform().fs;

    let backup: string | null = null;
    try {
      backup = await fs.readTextFile(configPath);
    } catch {
      // No existing config
    }

    try {
      const testConfig: HlvmConfig = {
        ...DEFAULT_CONFIG,
        agentMode: "claude-code-agent",
        sessionMemory: true,
        checkpointing: true,
      };
      await saveConfig(testConfig);

      const loaded = await loadConfig();
      assertEquals(loaded.agentMode, "claude-code-agent");
      assertEquals(loaded.sessionMemory, true);
      assertEquals(loaded.checkpointing, true);
    } finally {
      if (backup !== null) {
        await fs.writeTextFile(configPath, backup);
      } else {
        try {
          await fs.remove(configPath);
        } catch {
          // Ignore
        }
      }
    }
  },
});
