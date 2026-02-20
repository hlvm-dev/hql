/**
 * Policy Tests
 *
 * Verifies agent policy resolution and path/network matching.
 */

import { assertEquals } from "jsr:@std/assert";
import { getPlatform } from "../../../src/platform/platform.ts";
import {
  loadAgentPolicy,
  resolvePolicyDecision,
  isPathAllowed,
  isNetworkAllowed,
  type AgentPolicy,
} from "../../../src/hlvm/agent/policy.ts";

const TEST_WORKSPACE = "/tmp/hlvm-agent-policy-test";

async function setupWorkspace() {
  const platform = getPlatform();
  await platform.fs.mkdir(TEST_WORKSPACE, { recursive: true });
  await platform.fs.mkdir(`${TEST_WORKSPACE}/.hlvm`, { recursive: true });
}

async function cleanupWorkspace() {
  const platform = getPlatform();
  try {
    await platform.fs.remove(TEST_WORKSPACE, { recursive: true });
  } catch {
    // ignore
  }
}

Deno.test({
  name: "Policy: resolvePolicyDecision uses tool > level > default",
  fn() {
    const policy: AgentPolicy = {
      version: 1,
      default: "ask",
      levelRules: { L2: "deny" },
      toolRules: { read_file: "allow" },
    };

    assertEquals(resolvePolicyDecision(policy, "read_file", "L0"), "allow");
    assertEquals(resolvePolicyDecision(policy, "write_file", "L2"), "deny");
    assertEquals(resolvePolicyDecision(policy, "search_code", "L0"), "ask");
  },
});

Deno.test({
  name: "Policy: path allow/deny rules",
  fn() {
    const policy: AgentPolicy = {
      version: 1,
      pathRules: {
        deny: ["**/secrets/**"],
        allow: ["src/**", "README.md"],
      },
    };

    assertEquals(isPathAllowed(policy, "src/main.ts"), true);
    assertEquals(isPathAllowed(policy, "README.md"), true);
    assertEquals(isPathAllowed(policy, "secrets/key.txt"), false);
    assertEquals(isPathAllowed(policy, "docs/guide.md"), false);
  },
});

Deno.test({
  name: "Policy: network allow/deny rules",
  fn() {
    const policy: AgentPolicy = {
      version: 1,
      networkRules: {
        deny: ["https://evil.example.com/**"],
        allow: ["https://api.example.com/**"],
      },
    };

    assertEquals(
      isNetworkAllowed(policy, "https://api.example.com/v1/data"),
      true,
    );
    assertEquals(
      isNetworkAllowed(policy, "https://evil.example.com/steal"),
      false,
    );
    assertEquals(isNetworkAllowed(policy, "https://other.example.com"), false);
  },
});

Deno.test({
  name: "Policy: loadAgentPolicy returns null if missing",
  async fn() {
    await setupWorkspace();
    const policy = await loadAgentPolicy(TEST_WORKSPACE);
    assertEquals(policy, null);
    await cleanupWorkspace();
  },
});

Deno.test({
  name: "Policy: loadAgentPolicy loads valid file",
  async fn() {
    await setupWorkspace();
    const platform = getPlatform();
    const path = `${TEST_WORKSPACE}/.hlvm/agent-policy.json`;

    const policy: AgentPolicy = {
      version: 1,
      default: "ask",
      toolRules: { read_file: "allow" },
    };
    await platform.fs.writeTextFile(path, JSON.stringify(policy));

    const loaded = await loadAgentPolicy(TEST_WORKSPACE, path);
    assertEquals(loaded?.version, 1);
    assertEquals(loaded?.toolRules?.read_file, "allow");
    await cleanupWorkspace();
  },
});
