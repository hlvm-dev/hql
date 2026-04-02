/**
 * Policy Tests
 *
 * Verifies agent policy resolution, path/network matching,
 * loading edge cases, and normalization behavior.
 */

import { assertEquals, assertThrows } from "jsr:@std/assert";
import { getAgentPolicyPath } from "../../../src/common/paths.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import {
  type AgentPolicy,
  enforcePathPolicy,
  getNetworkPolicyDeniedUrl,
  isNetworkAllowed,
  isPathAllowed,
  isPathAllowedAbsolute,
  loadAgentPolicy,
  resolvePolicyDecision,
} from "../../../src/hlvm/agent/policy.ts";
import { withTempHlvmDir } from "../helpers.ts";

// ============================================================
// resolvePolicyDecision — priority order
// ============================================================

Deno.test({
  name: "Policy: resolvePolicyDecision uses tool > level > default",
  fn() {
    const policy: AgentPolicy = {
      version: 1,
      default: "ask",
      levelRules: { L2: "deny" },
      toolRules: { read_file: "allow" },
    };

    // tool rule takes priority over level and default
    assertEquals(resolvePolicyDecision(policy, "read_file", "L0"), "allow");
    // level rule used when no tool rule matches
    assertEquals(resolvePolicyDecision(policy, "write_file", "L2"), "deny");
    // default used when neither tool nor level matches
    assertEquals(resolvePolicyDecision(policy, "search_code", "L0"), "ask");
  },
});

Deno.test({
  name: "Policy: resolvePolicyDecision returns null for null/undefined policy",
  fn() {
    assertEquals(resolvePolicyDecision(null, "read_file", "L0"), null);
    assertEquals(resolvePolicyDecision(undefined, "read_file", "L0"), null);
  },
});

Deno.test({
  name: "Policy: resolvePolicyDecision returns null when no rules and no default",
  fn() {
    const policy: AgentPolicy = { version: 1 };
    assertEquals(resolvePolicyDecision(policy, "read_file", "L0"), null);
  },
});

Deno.test({
  name: "Policy: resolvePolicyDecision tool rule overrides same-level level rule",
  fn() {
    const policy: AgentPolicy = {
      version: 1,
      default: "deny",
      levelRules: { L2: "deny" },
      toolRules: { shell_exec: "allow" },
    };
    // tool rule wins even though L2 says deny
    assertEquals(resolvePolicyDecision(policy, "shell_exec", "L2"), "allow");
  },
});

Deno.test({
  name: "Policy: resolvePolicyDecision falls through to default when level rule absent for that level",
  fn() {
    const policy: AgentPolicy = {
      version: 1,
      default: "ask",
      levelRules: { L2: "deny" },
    };
    // L0 has no level rule, so default "ask" applies
    assertEquals(resolvePolicyDecision(policy, "write_file", "L0"), "ask");
    // L2 has a rule
    assertEquals(resolvePolicyDecision(policy, "write_file", "L2"), "deny");
  },
});

// ============================================================
// isPathAllowed — glob matching
// ============================================================

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
  name: "Policy: isPathAllowed returns true when no pathRules configured",
  fn() {
    const policy: AgentPolicy = { version: 1 };
    assertEquals(isPathAllowed(policy, "anything/goes.ts"), true);
  },
});

Deno.test({
  name: "Policy: isPathAllowed returns true for null/undefined policy",
  fn() {
    assertEquals(isPathAllowed(null, "src/main.ts"), true);
    assertEquals(isPathAllowed(undefined, "src/main.ts"), true);
  },
});

Deno.test({
  name: "Policy: deny takes precedence over allow when both match",
  fn() {
    const policy: AgentPolicy = {
      version: 1,
      pathRules: {
        deny: ["src/secret/**"],
        allow: ["src/**"],
      },
    };
    // src/** allow matches, but src/secret/** deny takes precedence
    assertEquals(isPathAllowed(policy, "src/secret/key.ts"), false);
    // regular src file is fine
    assertEquals(isPathAllowed(policy, "src/main.ts"), true);
  },
});

Deno.test({
  name: "Policy: empty allow list means everything is allowed (only deny applies)",
  fn() {
    const policy: AgentPolicy = {
      version: 1,
      pathRules: {
        deny: ["**/node_modules/**"],
        allow: [],
      },
    };
    assertEquals(isPathAllowed(policy, "src/main.ts"), true);
    assertEquals(isPathAllowed(policy, "node_modules/pkg/index.js"), false);
  },
});

// ============================================================
// isPathAllowedAbsolute — workspace-relative evaluation
// ============================================================

Deno.test({
  name: "Policy: isPathAllowedAbsolute converts to workspace-relative path",
  fn() {
    const policy: AgentPolicy = {
      version: 1,
      pathRules: {
        allow: ["src/**"],
      },
    };
    assertEquals(isPathAllowedAbsolute(policy, "/project", "/project/src/main.ts"), true);
    assertEquals(isPathAllowedAbsolute(policy, "/project", "/project/tests/foo.ts"), false);
  },
});

Deno.test({
  name: "Policy: isPathAllowedAbsolute returns true when no pathRules",
  fn() {
    const policy: AgentPolicy = { version: 1 };
    assertEquals(isPathAllowedAbsolute(policy, "/project", "/project/anything.ts"), true);
    assertEquals(isPathAllowedAbsolute(null, "/project", "/project/anything.ts"), true);
  },
});

// ============================================================
// enforcePathPolicy — throws SecurityError
// ============================================================

Deno.test({
  name: "Policy: enforcePathPolicy throws SecurityError for denied path",
  fn() {
    const policy: AgentPolicy = {
      version: 1,
      pathRules: {
        allow: ["src/**"],
      },
    };
    assertThrows(
      () => enforcePathPolicy(policy, "/project", "/project/tests/foo.ts"),
      Error,
      "Path denied by policy",
    );
  },
});

Deno.test({
  name: "Policy: enforcePathPolicy does not throw for allowed path",
  fn() {
    const policy: AgentPolicy = {
      version: 1,
      pathRules: {
        allow: ["src/**"],
      },
    };
    // Should not throw
    enforcePathPolicy(policy, "/project", "/project/src/main.ts");
  },
});

Deno.test({
  name: "Policy: enforcePathPolicy is a no-op for null policy",
  fn() {
    // Should not throw
    enforcePathPolicy(null, "/project", "/project/anything.ts");
    enforcePathPolicy(undefined, "/project", "/project/anything.ts");
  },
});

// ============================================================
// Network rules
// ============================================================

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
  name: "Policy: isNetworkAllowed returns true when no networkRules",
  fn() {
    const policy: AgentPolicy = { version: 1 };
    assertEquals(isNetworkAllowed(policy, "https://anything.com"), true);
  },
});

Deno.test({
  name: "Policy: isNetworkAllowed returns true for null/undefined policy",
  fn() {
    assertEquals(isNetworkAllowed(null, "https://anything.com"), true);
    assertEquals(isNetworkAllowed(undefined, "https://anything.com"), true);
  },
});

Deno.test({
  name: "Policy: network deny takes precedence over allow",
  fn() {
    const policy: AgentPolicy = {
      version: 1,
      networkRules: {
        deny: ["https://api.example.com/admin/**"],
        allow: ["https://api.example.com/**"],
      },
    };
    assertEquals(isNetworkAllowed(policy, "https://api.example.com/v1/data"), true);
    assertEquals(isNetworkAllowed(policy, "https://api.example.com/admin/delete"), false);
  },
});

// ============================================================
// getNetworkPolicyDeniedUrl
// ============================================================

Deno.test({
  name: "Policy: getNetworkPolicyDeniedUrl returns first denied URL",
  fn() {
    const policy: AgentPolicy = {
      version: 1,
      networkRules: {
        allow: ["https://api.example.com/**"],
      },
    };
    const denied = getNetworkPolicyDeniedUrl(policy, [
      "https://api.example.com/ok",
      "https://evil.com/bad",
      "https://also-evil.com/bad",
    ]);
    assertEquals(denied, "https://evil.com/bad");
  },
});

Deno.test({
  name: "Policy: getNetworkPolicyDeniedUrl returns null when all allowed",
  fn() {
    const policy: AgentPolicy = {
      version: 1,
      networkRules: {
        allow: ["https://api.example.com/**"],
      },
    };
    assertEquals(
      getNetworkPolicyDeniedUrl(policy, ["https://api.example.com/v1"]),
      null,
    );
  },
});

Deno.test({
  name: "Policy: getNetworkPolicyDeniedUrl returns null for empty list or null policy",
  fn() {
    const policy: AgentPolicy = {
      version: 1,
      networkRules: { allow: ["https://x.com/**"] },
    };
    assertEquals(getNetworkPolicyDeniedUrl(policy, []), null);
    assertEquals(getNetworkPolicyDeniedUrl(null, ["https://evil.com"]), null);
  },
});

// ============================================================
// loadAgentPolicy — I/O and normalization
// ============================================================

Deno.test({
  name: "Policy: loadAgentPolicy returns null if missing",
  async fn() {
    await withTempHlvmDir(async () => {
      const policy = await loadAgentPolicy();
      assertEquals(policy, null);
    });
  },
});

Deno.test({
  name: "Policy: loadAgentPolicy loads valid file",
  async fn() {
    await withTempHlvmDir(async () => {
      const platform = getPlatform();
      const policy: AgentPolicy = {
        version: 1,
        default: "ask",
        toolRules: { read_file: "allow" },
      };
      await platform.fs.writeTextFile(
        getAgentPolicyPath(),
        JSON.stringify(policy),
      );

      const loaded = await loadAgentPolicy();
      assertEquals(loaded?.version, 1);
      assertEquals(loaded?.toolRules?.read_file, "allow");
    });
  },
});

Deno.test({
  name: "Policy: loadAgentPolicy returns null for malformed JSON",
  async fn() {
    await withTempHlvmDir(async () => {
      const platform = getPlatform();
      const policyPath = getAgentPolicyPath();
      await platform.fs.mkdir(platform.path.dirname(policyPath), { recursive: true });
      await platform.fs.writeTextFile(policyPath, "{ this is not valid JSON }}}");

      const loaded = await loadAgentPolicy();
      assertEquals(loaded, null);
    });
  },
});

Deno.test({
  name: "Policy: loadAgentPolicy returns null for empty file",
  async fn() {
    await withTempHlvmDir(async () => {
      const platform = getPlatform();
      const policyPath = getAgentPolicyPath();
      await platform.fs.mkdir(platform.path.dirname(policyPath), { recursive: true });
      await platform.fs.writeTextFile(policyPath, "");

      const loaded = await loadAgentPolicy();
      assertEquals(loaded, null);
    });
  },
});

Deno.test({
  name: "Policy: loadAgentPolicy returns null for wrong version",
  async fn() {
    await withTempHlvmDir(async () => {
      const platform = getPlatform();
      const policyPath = getAgentPolicyPath();
      await platform.fs.mkdir(platform.path.dirname(policyPath), { recursive: true });
      await platform.fs.writeTextFile(policyPath, JSON.stringify({ version: 2 }));

      const loaded = await loadAgentPolicy();
      assertEquals(loaded, null);
    });
  },
});

Deno.test({
  name: "Policy: loadAgentPolicy returns null for non-object JSON",
  async fn() {
    await withTempHlvmDir(async () => {
      const platform = getPlatform();
      const policyPath = getAgentPolicyPath();
      await platform.fs.mkdir(platform.path.dirname(policyPath), { recursive: true });
      await platform.fs.writeTextFile(policyPath, '"just a string"');

      const loaded = await loadAgentPolicy();
      assertEquals(loaded, null);
    });
  },
});

Deno.test({
  name: "Policy: loadAgentPolicy normalizes invalid decision values away",
  async fn() {
    await withTempHlvmDir(async () => {
      const platform = getPlatform();
      const policyPath = getAgentPolicyPath();
      await platform.fs.mkdir(platform.path.dirname(policyPath), { recursive: true });
      // "permit" is not a valid PolicyDecision — should be stripped
      await platform.fs.writeTextFile(
        policyPath,
        JSON.stringify({
          version: 1,
          default: "permit",
          toolRules: { read_file: "allow", write_file: "nope" },
        }),
      );

      const loaded = await loadAgentPolicy();
      assertEquals(loaded?.version, 1);
      // invalid "permit" default is stripped
      assertEquals(loaded?.default, undefined);
      // valid tool rule kept, invalid one stripped
      assertEquals(loaded?.toolRules?.read_file, "allow");
      assertEquals(loaded?.toolRules?.write_file, undefined);
    });
  },
});

Deno.test({
  name: "Policy: loadAgentPolicy preserves all valid fields in roundtrip",
  async fn() {
    await withTempHlvmDir(async () => {
      const platform = getPlatform();
      const policyPath = getAgentPolicyPath();
      await platform.fs.mkdir(platform.path.dirname(policyPath), { recursive: true });
      const fullPolicy = {
        version: 1,
        default: "deny",
        toolRules: { read_file: "allow", write_file: "ask" },
        levelRules: { L0: "allow", L2: "deny" },
        pathRules: {
          allow: ["src/**"],
          deny: ["**/secrets/**"],
        },
        networkRules: {
          allow: ["https://api.example.com/**"],
          deny: ["https://evil.com/**"],
        },
      };
      await platform.fs.writeTextFile(policyPath, JSON.stringify(fullPolicy));

      const loaded = await loadAgentPolicy();
      assertEquals(loaded?.version, 1);
      assertEquals(loaded?.default, "deny");
      assertEquals(loaded?.toolRules?.read_file, "allow");
      assertEquals(loaded?.toolRules?.write_file, "ask");
      assertEquals(loaded?.levelRules?.L0, "allow");
      assertEquals(loaded?.levelRules?.L2, "deny");
      assertEquals(loaded?.pathRules?.allow, ["src/**"]);
      assertEquals(loaded?.pathRules?.deny, ["**/secrets/**"]);
      assertEquals(loaded?.networkRules?.allow, ["https://api.example.com/**"]);
      assertEquals(loaded?.networkRules?.deny, ["https://evil.com/**"]);
    });
  },
});
