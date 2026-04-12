/**
 * Harness Engineering E2E Integration Tests
 *
 * Tests every feature end-to-end: @include, rules/, skills, hooks,
 * slash commands, trust gating, prompt rendering, completion catalog.
 */

import { assertEquals } from "jsr:@std/assert";
import { getPlatform } from "../../src/platform/platform.ts";
import {
  resetHlvmDirCacheForTests,
  setHlvmDirForTests,
} from "../../src/common/paths.ts";
import { resetSkillCatalogCache } from "../../src/hlvm/skills/mod.ts";

async function withTestEnv(
  fn: (env: {
    hlvmDir: string;
    workspace: string;
    fs: ReturnType<typeof getPlatform>["fs"];
    path: ReturnType<typeof getPlatform>["path"];
  }) => Promise<void>,
): Promise<void> {
  const platform = getPlatform();
  const testRoot = await platform.fs.makeTempDir({ prefix: "hlvm-e2e-" });
  const hlvmDir = platform.path.join(testRoot, ".hlvm");
  const workspace = platform.path.join(testRoot, "project");
  await platform.fs.mkdir(platform.path.join(hlvmDir, "skills"), { recursive: true });
  await platform.fs.mkdir(platform.path.join(hlvmDir, "rules"), { recursive: true });
  await platform.fs.mkdir(platform.path.join(workspace, ".hlvm", "skills"), { recursive: true });
  await platform.fs.mkdir(platform.path.join(workspace, ".hlvm", "rules"), { recursive: true });
  setHlvmDirForTests(hlvmDir);
  resetSkillCatalogCache();
  try {
    await fn({ hlvmDir, workspace, fs: platform.fs, path: platform.path });
  } finally {
    resetHlvmDirCacheForTests();
    resetSkillCatalogCache();
    await platform.fs.remove(testRoot, { recursive: true });
  }
}

// ═══════════════════════════════════════════════
// E2E 1: @include + rules pipeline
// ═══════════════════════════════════════════════

Deno.test("harness: @include resolves files into HLVM.md", async () => {
  await withTestEnv(async ({ hlvmDir, fs, path }) => {
    await fs.writeTextFile(path.join(hlvmDir, "HLVM.md"),
      "# Global\n@./rules/style.md\nBe concise.");
    await fs.writeTextFile(path.join(hlvmDir, "rules", "style.md"), "Use strict mode.");

    const { loadInstructionHierarchy } = await import(
      "../../src/hlvm/prompt/instructions.ts"
    );
    const h = await loadInstructionHierarchy();
    assertEquals(h.global.includes("Use strict mode"), true);
    assertEquals(h.global.includes("Be concise"), true);
    assertEquals(h.global.includes("@./rules/"), false);
  });
});

Deno.test("harness: rules/*.md auto-loaded and sorted", async () => {
  await withTestEnv(async ({ hlvmDir, fs, path }) => {
    await fs.writeTextFile(path.join(hlvmDir, "HLVM.md"), "Base.");
    await fs.writeTextFile(path.join(hlvmDir, "rules", "02-b.md"), "Rule B.");
    await fs.writeTextFile(path.join(hlvmDir, "rules", "01-a.md"), "Rule A.");
    await fs.writeTextFile(path.join(hlvmDir, "rules", "skip.txt"), "Not a rule.");

    const { loadInstructionHierarchy, mergeInstructions } = await import(
      "../../src/hlvm/prompt/instructions.ts"
    );
    const h = await loadInstructionHierarchy();
    assertEquals(h.globalRules?.includes("Rule A") === true, true);
    assertEquals(h.globalRules?.includes("Rule B") === true, true);
    assertEquals(h.globalRules?.includes("Not a rule") === true, false);
    assertEquals(
      (h.globalRules?.indexOf("Rule A") ?? 0) < (h.globalRules?.indexOf("Rule B") ?? 0),
      true,
    );
    const merged = mergeInstructions(h);
    assertEquals(merged.includes("## Rules"), true);
    assertEquals(merged.includes("## Global Instructions"), true);
  });
});

Deno.test("harness: missing @include shows placeholder", async () => {
  await withTestEnv(async ({ hlvmDir, fs, path }) => {
    await fs.writeTextFile(path.join(hlvmDir, "HLVM.md"), "Before\n@./gone.md\nAfter");

    const { loadInstructionHierarchy } = await import(
      "../../src/hlvm/prompt/instructions.ts"
    );
    const h = await loadInstructionHierarchy();
    assertEquals(h.global.includes("[include not found: ./gone.md]"), true);
    assertEquals(h.global.includes("Before"), true);
    assertEquals(h.global.includes("After"), true);
  });
});

Deno.test("harness: @include blocks path traversal", async () => {
  await withTestEnv(async ({ hlvmDir, fs, path }) => {
    // Create a secret file OUTSIDE the hlvm dir
    const secretPath = path.join(path.dirname(hlvmDir), "secret.txt");
    await fs.writeTextFile(secretPath, "SECRET_API_KEY=abc123");

    // Try to include it via traversal
    await fs.writeTextFile(
      path.join(hlvmDir, "HLVM.md"),
      "Before\n@./../secret.txt\n@./rules/legit.md\nAfter",
    );
    await fs.writeTextFile(path.join(hlvmDir, "rules", "legit.md"), "Legit.");

    const { loadInstructionHierarchy } = await import(
      "../../src/hlvm/prompt/instructions.ts",
    );
    const h = await loadInstructionHierarchy();
    assertEquals(h.global.includes("SECRET"), false, "secret NOT leaked");
    assertEquals(h.global.includes("[include blocked:"), true, "blocked message shown");
    assertEquals(h.global.includes("Legit"), true, "legit include still works");
    assertEquals(h.global.includes("Before"), true, "surrounding text preserved");
    assertEquals(h.global.includes("After"), true, "surrounding text preserved");
  });
});

Deno.test("harness: @include blocks symlinks", async () => {
  await withTestEnv(async ({ hlvmDir, fs, path }) => {
    const secretPath = path.join(path.dirname(hlvmDir), "secret2.txt");
    await fs.writeTextFile(secretPath, "SYMLINK_SECRET");
    await Deno.symlink(secretPath, path.join(hlvmDir, "rules", "link.md"));
    await fs.writeTextFile(path.join(hlvmDir, "rules", "real.md"), "Real content.");
    await fs.writeTextFile(
      path.join(hlvmDir, "HLVM.md"),
      "@./rules/link.md\n@./rules/real.md",
    );

    const { loadInstructionHierarchy } = await import(
      "../../src/hlvm/prompt/instructions.ts",
    );
    const h = await loadInstructionHierarchy();
    assertEquals(h.global.includes("SYMLINK_SECRET"), false, "symlink secret NOT leaked");
    assertEquals(h.global.includes("symlink"), true, "blocked message mentions symlink");
    assertEquals(h.global.includes("Real content"), true, "real file still works");
  });
});

// ═══════════════════════════════════════════════
// E2E 2: Skill lifecycle
// ═══════════════════════════════════════════════

Deno.test("harness: bundled skills load by default", async () => {
  await withTestEnv(async () => {
    const { loadSkillCatalog } = await import("../../src/hlvm/skills/mod.ts");
    resetSkillCatalogCache();
    const cat = await loadSkillCatalog();
    assertEquals(cat.has("commit"), true);
    assertEquals(cat.has("test"), true);
    assertEquals(cat.has("review"), true);
    assertEquals(cat.get("review")!.frontmatter.context, "fork");
  });
});

Deno.test("harness: user skill loaded and invoked with args", async () => {
  await withTestEnv(async ({ hlvmDir, fs, path }) => {
    await fs.writeTextFile(path.join(hlvmDir, "skills", "deploy.md"),
      "---\ndescription: Deploy\nallowed_tools: [shell_exec]\ncontext: inline\n---\nDeploy to ${ARGS}.");

    const { loadSkillCatalog, executeInlineSkill } = await import(
      "../../src/hlvm/skills/mod.ts"
    );
    resetSkillCatalogCache();
    const cat = await loadSkillCatalog();
    assertEquals(cat.has("deploy"), true);
    assertEquals(cat.get("deploy")!.source, "user");

    const r = executeInlineSkill(cat.get("deploy")!, "production");
    assertEquals(r.systemMessage.includes("Deploy to production"), true);
    assertEquals(r.systemMessage.includes("${ARGS}"), false);
    assertEquals(r.allowedTools?.includes("shell_exec"), true);
  });
});

Deno.test("harness: user skill overrides bundled by name", async () => {
  await withTestEnv(async ({ hlvmDir, fs, path }) => {
    await fs.writeTextFile(path.join(hlvmDir, "skills", "commit.md"),
      "---\ndescription: Custom\ncontext: inline\n---\nCustom flow.");

    const { loadSkillCatalog } = await import("../../src/hlvm/skills/mod.ts");
    resetSkillCatalogCache();
    const cat = await loadSkillCatalog();
    assertEquals(cat.get("commit")!.source, "user");
    assertEquals(cat.get("commit")!.body.includes("Custom flow"), true);
  });
});

Deno.test("harness: untrusted project skill blocked", async () => {
  await withTestEnv(async ({ workspace, fs, path }) => {
    await fs.writeTextFile(path.join(workspace, ".hlvm", "skills", "evil.md"),
      "---\ndescription: Evil\ncontext: inline\n---\nBad.");

    const { loadSkillCatalog } = await import("../../src/hlvm/skills/mod.ts");
    resetSkillCatalogCache();
    const cat = await loadSkillCatalog(workspace);
    assertEquals(cat.has("evil"), false);
  });
});

Deno.test("harness: trusted project skill loaded", async () => {
  await withTestEnv(async ({ workspace, fs, path }) => {
    await fs.writeTextFile(path.join(workspace, ".hlvm", "skills", "lint.md"),
      "---\ndescription: Lint\ncontext: inline\n---\nLint body.");

    const { trustWorkspace } = await import(
      "../../src/hlvm/prompt/instructions.ts"
    );
    await trustWorkspace(workspace);

    const { loadSkillCatalog } = await import("../../src/hlvm/skills/mod.ts");
    resetSkillCatalogCache();
    const cat = await loadSkillCatalog(workspace);
    assertEquals(cat.has("lint"), true);
    assertEquals(cat.get("lint")!.source, "project");
  });
});

Deno.test("harness: malformed skills silently skipped", async () => {
  await withTestEnv(async ({ hlvmDir, fs, path }) => {
    await fs.writeTextFile(path.join(hlvmDir, "skills", "bad1.md"), "no frontmatter");
    await fs.writeTextFile(path.join(hlvmDir, "skills", "bad2.md"), "---\n{{invalid\n---\nbody");
    await fs.writeTextFile(path.join(hlvmDir, "skills", "bad3.md"), "---\nfoo: bar\n---\nno description");

    const { loadSkillCatalog } = await import("../../src/hlvm/skills/mod.ts");
    resetSkillCatalogCache();
    const cat = await loadSkillCatalog();
    assertEquals(cat.has("bad1"), false);
    assertEquals(cat.has("bad2"), false);
    assertEquals(cat.has("bad3"), false);
  });
});

// ═══════════════════════════════════════════════
// E2E 3: Slash commands
// ═══════════════════════════════════════════════

Deno.test({ name: "harness: /commit activates inline skill", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  await withTestEnv(async () => {
    const { runCommand } = await import("../../src/hlvm/cli/repl/commands.ts");
    resetSkillCatalogCache();
    const out: string[] = [];
    // deno-lint-ignore no-explicit-any
    const r = await runCommand("/commit fix bug", {} as any, {
      onOutput: (l: string) => out.push(l),
    });
    assertEquals(r.handled, true);
    assertEquals(!!r.skillActivation, true);
    assertEquals(r.skillActivation!.systemMessage.includes("fix bug"), true);
    assertEquals(r.skillActivation!.allowedTools?.includes("git_diff"), true);
  });
}});

Deno.test({ name: "harness: /review activates fork skill", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  await withTestEnv(async () => {
    const { runCommand } = await import("../../src/hlvm/cli/repl/commands.ts");
    resetSkillCatalogCache();
    const out: string[] = [];
    // deno-lint-ignore no-explicit-any
    const r = await runCommand("/review src/x.ts", {} as any, {
      onOutput: (l: string) => out.push(l),
    });
    assertEquals(r.handled, true);
    assertEquals(!!r.skillActivation, true);
    assertEquals(r.skillActivation!.systemMessage.includes("src/x.ts"), true);
  });
}});

Deno.test({ name: "harness: unknown slash command rejected", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  await withTestEnv(async () => {
    const { runCommand } = await import("../../src/hlvm/cli/repl/commands.ts");
    const out: string[] = [];
    // deno-lint-ignore no-explicit-any
    const r = await runCommand("/nope", {} as any, {
      onOutput: (l: string) => out.push(l),
    });
    assertEquals(r.handled, false);
    assertEquals(r.skillActivation, undefined);
  });
}});

// ═══════════════════════════════════════════════
// E2E 4: Skills in system prompt
// ═══════════════════════════════════════════════

Deno.test("harness: skills section renders in system prompt", async () => {
  await withTestEnv(async () => {
    const { compileSystemPrompt } = await import(
      "../../src/hlvm/agent/llm-integration.ts"
    );
    const { loadSkillCatalog } = await import("../../src/hlvm/skills/mod.ts");
    resetSkillCatalogCache();
    const skills = await loadSkillCatalog();
    const with_ = compileSystemPrompt({ skills });
    assertEquals(with_.text.includes("# Skills"), true);
    assertEquals(with_.text.includes("/commit"), true);
    const without_ = compileSystemPrompt({});
    assertEquals(without_.text.includes("# Skills"), false);
  });
});

// ═══════════════════════════════════════════════
// E2E 5: Skill tool
// ═══════════════════════════════════════════════

Deno.test("harness: skill tool registered in registry", () => {
  const { hasTool } = Deno as unknown as { hasTool?: never };
  void hasTool; // suppress unused
  // Use the real import
  import("../../src/hlvm/agent/registry.ts").then(({ hasTool: ht }) => {
    assertEquals(ht("skill"), true);
  });
});

// ═══════════════════════════════════════════════
// E2E 6: Hooks
// ═══════════════════════════════════════════════

Deno.test("harness: hook runtime loads all 3 types + new events", async () => {
  const platform = getPlatform();
  const dir = await platform.fs.makeTempDir({ prefix: "hlvm-hook-" });
  await platform.fs.mkdir(platform.path.join(dir, ".hlvm"), { recursive: true });
  await platform.fs.writeTextFile(
    platform.path.join(dir, ".hlvm", "hooks.json"),
    JSON.stringify({
      version: 1,
      hooks: {
        pre_tool: [
          { command: ["echo", "ok"] },
          { type: "prompt", prompt: "safe?" },
          { type: "http", url: "https://x.com" },
        ],
        session_start: [{ command: ["echo", "s"] }],
        session_end: [{ command: ["echo", "e"] }],
        pre_compact: [{ type: "http", url: "https://y.com" }],
        user_prompt_submit: [{ command: ["echo", "u"] }],
      },
    }),
  );

  try {
    const { loadAgentHookRuntime } = await import(
      "../../src/hlvm/agent/hooks.ts"
    );
    const rt = await loadAgentHookRuntime(dir);
    assertEquals(!!rt, true);
    assertEquals(rt!.hasHandlers("pre_tool"), true);
    assertEquals(rt!.hasHandlers("session_start"), true);
    assertEquals(rt!.hasHandlers("session_end"), true);
    assertEquals(rt!.hasHandlers("pre_compact"), true);
    assertEquals(rt!.hasHandlers("user_prompt_submit"), true);
    assertEquals(rt!.hasHandlers("post_llm"), false);

    const fb = await rt!.dispatchWithFeedback("session_start", {});
    assertEquals(fb.blocked, false);
  } finally {
    await platform.fs.remove(dir, { recursive: true });
  }
});

Deno.test("harness: old-format hooks (no type field) still work", async () => {
  const platform = getPlatform();
  const dir = await platform.fs.makeTempDir({ prefix: "hlvm-hook-compat-" });
  await platform.fs.mkdir(platform.path.join(dir, ".hlvm"), { recursive: true });
  await platform.fs.writeTextFile(
    platform.path.join(dir, ".hlvm", "hooks.json"),
    JSON.stringify({ version: 1, hooks: { pre_tool: [{ command: ["old.sh"] }] } }),
  );

  try {
    const { loadAgentHookRuntime } = await import(
      "../../src/hlvm/agent/hooks.ts"
    );
    const rt = await loadAgentHookRuntime(dir);
    assertEquals(rt?.hasHandlers("pre_tool"), true);
  } finally {
    await platform.fs.remove(dir, { recursive: true });
  }
});

// ═══════════════════════════════════════════════
// E2E 7: Trust gating consistency
// ═══════════════════════════════════════════════

Deno.test("harness: trust gates agents, skills, and rules consistently", async () => {
  await withTestEnv(async ({ hlvmDir, workspace, fs, path }) => {
    // Setup project files
    await fs.mkdir(path.join(workspace, ".hlvm", "agents"), { recursive: true });
    await fs.writeTextFile(path.join(workspace, ".hlvm", "agents", "evil.md"),
      "---\nname: evil\ndescription: Bad\ntools:\n  - shell_exec\n---\nEvil.");
    await fs.writeTextFile(path.join(workspace, ".hlvm", "rules", "proj.md"), "Project rule.");
    await fs.writeTextFile(path.join(workspace, ".hlvm", "skills", "pskill.md"),
      "---\ndescription: Project skill\ncontext: inline\n---\nBody.");

    const { loadAgentProfiles } = await import(
      "../../src/hlvm/agent/agent-registry.ts"
    );
    const { loadInstructionHierarchy, trustWorkspace } = await import(
      "../../src/hlvm/prompt/instructions.ts"
    );
    const { loadSkillCatalog } = await import("../../src/hlvm/skills/mod.ts");

    // Untrusted: all blocked
    const p1 = await loadAgentProfiles(workspace, { trusted: false });
    assertEquals(p1.some((p) => p.name === "evil"), false);

    const h1 = await loadInstructionHierarchy(workspace);
    assertEquals(h1.projectRules?.includes("Project rule") ?? false, false);

    resetSkillCatalogCache();
    assertEquals((await loadSkillCatalog(workspace)).has("pskill"), false);

    // Trust and verify all load
    await trustWorkspace(workspace);
    const p2 = await loadAgentProfiles(workspace, { trusted: true });
    assertEquals(p2.some((p) => p.name === "evil"), true);

    const h2 = await loadInstructionHierarchy(workspace);
    assertEquals(h2.projectRules?.includes("Project rule") ?? false, true);

    resetSkillCatalogCache();
    assertEquals((await loadSkillCatalog(workspace)).has("pskill"), true);
  });
});

// ═══════════════════════════════════════════════
// E2E 8: Completion catalog
// ═══════════════════════════════════════════════

Deno.test("harness: completion catalog includes skills", async () => {
  await withTestEnv(async () => {
    const { getFullCommandCatalog } = await import(
      "../../src/hlvm/cli/repl/commands.ts"
    );
    resetSkillCatalogCache();
    const cat = await getFullCommandCatalog();
    const names = cat.map((c) => c.name);
    assertEquals(names.includes("/skills"), true);
    assertEquals(names.includes("/hooks"), true);
    assertEquals(names.includes("/commit"), true);
    assertEquals(names.includes("/test"), true);
    assertEquals(names.includes("/review"), true);
    assertEquals(names.includes("/help"), true);
    assertEquals(cat.length >= 14, true);
  });
});
