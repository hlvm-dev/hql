/**
 * Harness Engineering E2E Integration Tests
 *
 * Tests every feature end-to-end: @include, rules/, skills, hooks,
 * slash commands, trust gating, prompt rendering, completion catalog.
 */

import { assertEquals, assertRejects } from "jsr:@std/assert";
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
  await platform.fs.mkdir(platform.path.join(hlvmDir, "skills"), {
    recursive: true,
  });
  await platform.fs.mkdir(platform.path.join(hlvmDir, "commands"), {
    recursive: true,
  });
  await platform.fs.mkdir(platform.path.join(hlvmDir, "rules"), {
    recursive: true,
  });
  await platform.fs.mkdir(platform.path.join(workspace, ".hlvm", "skills"), {
    recursive: true,
  });
  await platform.fs.mkdir(platform.path.join(workspace, ".hlvm", "commands"), {
    recursive: true,
  });
  await platform.fs.mkdir(platform.path.join(workspace, ".hlvm", "rules"), {
    recursive: true,
  });
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

async function writeSkillFile(
  root: string,
  name: string,
  content: string,
): Promise<void> {
  const platform = getPlatform();
  const skillDir = platform.path.join(root, "skills", name);
  await platform.fs.mkdir(skillDir, { recursive: true });
  await platform.fs.writeTextFile(
    platform.path.join(skillDir, "SKILL.md"),
    content,
  );
}

async function writeLegacyCommandFile(
  root: string,
  name: string,
  content: string,
): Promise<void> {
  const platform = getPlatform();
  const commandsDir = platform.path.join(root, "commands");
  await platform.fs.mkdir(commandsDir, { recursive: true });
  await platform.fs.writeTextFile(
    platform.path.join(commandsDir, `${name}.md`),
    content,
  );
}

// ═══════════════════════════════════════════════
// E2E 1: @include + rules pipeline
// ═══════════════════════════════════════════════

Deno.test("harness: @include resolves files into HLVM.md", async () => {
  await withTestEnv(async ({ hlvmDir, fs, path }) => {
    await fs.writeTextFile(
      path.join(hlvmDir, "HLVM.md"),
      "# Global\n@./rules/style.md\nBe concise.",
    );
    await fs.writeTextFile(
      path.join(hlvmDir, "rules", "style.md"),
      "Use strict mode.",
    );

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
    await fs.writeTextFile(
      path.join(hlvmDir, "rules", "skip.txt"),
      "Not a rule.",
    );

    const { loadInstructionHierarchy, mergeInstructions } = await import(
      "../../src/hlvm/prompt/instructions.ts"
    );
    const h = await loadInstructionHierarchy();
    assertEquals(h.globalRules?.includes("Rule A") === true, true);
    assertEquals(h.globalRules?.includes("Rule B") === true, true);
    assertEquals(h.globalRules?.includes("Not a rule") === true, false);
    assertEquals(
      (h.globalRules?.indexOf("Rule A") ?? 0) <
        (h.globalRules?.indexOf("Rule B") ?? 0),
      true,
    );
    const merged = mergeInstructions(h);
    assertEquals(merged.includes("## Rules"), true);
    assertEquals(merged.includes("## Global Instructions"), true);
  });
});

Deno.test("harness: missing @include shows placeholder", async () => {
  await withTestEnv(async ({ hlvmDir, fs, path }) => {
    await fs.writeTextFile(
      path.join(hlvmDir, "HLVM.md"),
      "Before\n@./gone.md\nAfter",
    );

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
      "../../src/hlvm/prompt/instructions.ts"
    );
    const h = await loadInstructionHierarchy();
    assertEquals(h.global.includes("SECRET"), false, "secret NOT leaked");
    assertEquals(
      h.global.includes("[include blocked:"),
      true,
      "blocked message shown",
    );
    assertEquals(h.global.includes("Legit"), true, "legit include still works");
    assertEquals(
      h.global.includes("Before"),
      true,
      "surrounding text preserved",
    );
    assertEquals(
      h.global.includes("After"),
      true,
      "surrounding text preserved",
    );
  });
});

Deno.test("harness: @include blocks symlinks", async () => {
  await withTestEnv(async ({ hlvmDir, fs, path }) => {
    const secretPath = path.join(path.dirname(hlvmDir), "secret2.txt");
    await fs.writeTextFile(secretPath, "SYMLINK_SECRET");
    await Deno.symlink(secretPath, path.join(hlvmDir, "rules", "link.md"));
    await fs.writeTextFile(
      path.join(hlvmDir, "rules", "real.md"),
      "Real content.",
    );
    await fs.writeTextFile(
      path.join(hlvmDir, "HLVM.md"),
      "@./rules/link.md\n@./rules/real.md",
    );

    const { loadInstructionHierarchy } = await import(
      "../../src/hlvm/prompt/instructions.ts"
    );
    const h = await loadInstructionHierarchy();
    assertEquals(
      h.global.includes("SYMLINK_SECRET"),
      false,
      "symlink secret NOT leaked",
    );
    assertEquals(
      h.global.includes("symlink"),
      true,
      "blocked message mentions symlink",
    );
    assertEquals(
      h.global.includes("Real content"),
      true,
      "real file still works",
    );
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
  await withTestEnv(async ({ hlvmDir }) => {
    await writeSkillFile(
      hlvmDir,
      "deploy",
      '---\ndescription: Deploy\nargument-hint: "[environment]"\nallowed-tools: Bash Read\ncontext: inline\n---\nDeploy to $ARGUMENTS.',
    );

    const { loadSkillCatalog, executeInlineSkill } = await import(
      "../../src/hlvm/skills/mod.ts"
    );
    resetSkillCatalogCache();
    const cat = await loadSkillCatalog();
    assertEquals(cat.has("deploy"), true);
    assertEquals(cat.get("deploy")!.source, "user");
    assertEquals(cat.get("deploy")!.sourceKind, "skill");
    assertEquals(cat.get("deploy")!.frontmatter.argument_hint, "[environment]");

    const r = executeInlineSkill(cat.get("deploy")!, "production");
    assertEquals(r.systemMessage.includes("Deploy to production"), true);
    assertEquals(r.systemMessage.includes("$ARGUMENTS"), false);
    assertEquals(r.allowedTools?.includes("shell_exec"), true);
    assertEquals(r.allowedTools?.includes("read_file"), true);
  });
});

Deno.test("harness: legacy command is loaded as a skill", async () => {
  await withTestEnv(async ({ hlvmDir }) => {
    await writeLegacyCommandFile(
      hlvmDir,
      "deploy",
      "---\ndescription: Deploy command\nuser-invocable: true\ndisable-model-invocation: true\n---\nRun deploy for $0.",
    );

    const { loadSkillCatalog, executeInlineSkill } = await import(
      "../../src/hlvm/skills/mod.ts"
    );
    resetSkillCatalogCache();
    const cat = await loadSkillCatalog();
    const skill = cat.get("deploy")!;
    assertEquals(skill.sourceKind, "legacy-command");
    assertEquals(skill.frontmatter.manual_only, true);
    assertEquals(skill.frontmatter.model_invocable, false);

    const rendered = executeInlineSkill(skill, "staging");
    assertEquals(
      rendered.systemMessage.includes("Run deploy for staging."),
      true,
    );
  });
});

Deno.test("harness: project skill overrides project legacy command by name", async () => {
  await withTestEnv(async ({ workspace, path }) => {
    const projectHlvm = path.join(workspace, ".hlvm");
    await writeLegacyCommandFile(
      projectHlvm,
      "deploy",
      "---\ndescription: Legacy deploy\n---\nLegacy path.",
    );
    await writeSkillFile(
      projectHlvm,
      "deploy",
      "---\ndescription: Canonical deploy\n---\nCanonical path.",
    );

    const { trustWorkspace } = await import(
      "../../src/hlvm/prompt/instructions.ts"
    );
    await trustWorkspace(workspace);

    const { loadSkillCatalog } = await import("../../src/hlvm/skills/mod.ts");
    resetSkillCatalogCache();
    const cat = await loadSkillCatalog(workspace);
    const skill = cat.get("deploy")!;
    assertEquals(skill.source, "project");
    assertEquals(skill.sourceKind, "skill");
    assertEquals(skill.body.includes("Canonical path."), true);
  });
});

Deno.test("harness: description falls back to first paragraph", async () => {
  await withTestEnv(async ({ hlvmDir }) => {
    await writeSkillFile(
      hlvmDir,
      "summarize",
      "Summarize the selected files.\n\nThen report the key risks.",
    );

    const { loadSkillCatalog } = await import("../../src/hlvm/skills/mod.ts");
    resetSkillCatalogCache();
    const cat = await loadSkillCatalog();
    assertEquals(
      cat.get("summarize")!.frontmatter.description,
      "Summarize the selected files.",
    );
  });
});

Deno.test("harness: argument rendering matches CC-style placeholders", async () => {
  await withTestEnv(async ({ hlvmDir }) => {
    await writeSkillFile(
      hlvmDir,
      "deploy",
      "---\ndescription: Deploy\n---\nRaw=$ARGUMENTS first=$0 second=$1 bracket=$ARGUMENTS[1]",
    );

    const { loadSkillCatalog, executeInlineSkill } = await import(
      "../../src/hlvm/skills/mod.ts"
    );
    resetSkillCatalogCache();
    const cat = await loadSkillCatalog();
    const rendered = executeInlineSkill(cat.get("deploy")!, "staging west");
    assertEquals(
      rendered.systemMessage.includes(
        "Raw=staging west first=staging second=west bracket=west",
      ),
      true,
    );
  });
});

Deno.test("harness: arguments append when no placeholder exists", async () => {
  await withTestEnv(async ({ hlvmDir }) => {
    await writeSkillFile(
      hlvmDir,
      "note",
      "---\ndescription: Note\n---\nWrite a short release note.",
    );

    const { loadSkillCatalog, executeInlineSkill } = await import(
      "../../src/hlvm/skills/mod.ts"
    );
    resetSkillCatalogCache();
    const cat = await loadSkillCatalog();
    const rendered = executeInlineSkill(cat.get("note")!, "v1.2.3");
    assertEquals(rendered.systemMessage.includes("ARGUMENTS: v1.2.3"), true);
  });
});

Deno.test("harness: unsupported allowed-tools entries fail fast", async () => {
  await withTestEnv(async ({ hlvmDir }) => {
    await writeSkillFile(
      hlvmDir,
      "bad-tools",
      "---\ndescription: Bad tools\nallowed-tools: Bash LSP\n---\nNope.",
    );

    const { loadSkillCatalog } = await import("../../src/hlvm/skills/mod.ts");
    resetSkillCatalogCache();
    await assertRejects(
      () => loadSkillCatalog(),
      Error,
      "Unsupported allowed-tools entry",
    );
  });
});

Deno.test({
  name:
    "harness: model-only skills stay out of slash catalog but remain in prompt",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withTestEnv(async ({ hlvmDir }) => {
      await writeSkillFile(
        hlvmDir,
        "auto-fix",
        "---\ndescription: Auto fix\nuser-invocable: false\n---\nRepair the issue.",
      );

      const { compileSystemPrompt } = await import(
        "../../src/hlvm/agent/llm-integration.ts"
      );
      const { getFullCommandCatalog } = await import(
        "../../src/hlvm/cli/repl/commands.ts"
      );
      const { loadSkillCatalog } = await import("../../src/hlvm/skills/mod.ts");

      resetSkillCatalogCache();
      const skills = await loadSkillCatalog();
      const prompt = compileSystemPrompt({ skills }).text;
      const commands = await getFullCommandCatalog();

      assertEquals(prompt.includes("**auto-fix**"), true);
      assertEquals(prompt.includes("model-only"), true);
      assertEquals(commands.some((entry) => entry.name === "/auto-fix"), false);
    });
  },
});

Deno.test({
  name: "harness: manual-only skills reject model invocation",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withTestEnv(async ({ hlvmDir }) => {
      await writeSkillFile(
        hlvmDir,
        "deploy",
        "---\ndescription: Deploy\ndisable-model-invocation: true\n---\nDeploy to $ARGUMENTS.",
      );

      const { getTool } = await import("../../src/hlvm/agent/registry.ts");
      const tool = getTool("Skill");
      const result = await tool.fn(
        { skill: "deploy", args: "staging" },
        "/tmp",
      );
      assertEquals(
        typeof result === "object" && result !== null &&
          "error" in result &&
          String(result.error).includes("manual-only"),
        true,
      );
    });
  },
});

Deno.test("harness: user skill overrides bundled by name", async () => {
  await withTestEnv(async ({ hlvmDir }) => {
    await writeSkillFile(
      hlvmDir,
      "commit",
      "---\ndescription: Custom\ncontext: inline\n---\nCustom flow.",
    );

    const { loadSkillCatalog } = await import("../../src/hlvm/skills/mod.ts");
    resetSkillCatalogCache();
    const cat = await loadSkillCatalog();
    assertEquals(cat.get("commit")!.source, "user");
    assertEquals(cat.get("commit")!.body.includes("Custom flow"), true);
  });
});

Deno.test("harness: untrusted project skill blocked", async () => {
  await withTestEnv(async ({ workspace, path }) => {
    await writeSkillFile(
      path.join(workspace, ".hlvm"),
      "evil",
      "---\ndescription: Evil\ncontext: inline\n---\nBad.",
    );

    const { loadSkillCatalog } = await import("../../src/hlvm/skills/mod.ts");
    resetSkillCatalogCache();
    const cat = await loadSkillCatalog(workspace);
    assertEquals(cat.has("evil"), false);
  });
});

Deno.test("harness: trusted project skill loaded", async () => {
  await withTestEnv(async ({ workspace, path }) => {
    await writeSkillFile(
      path.join(workspace, ".hlvm"),
      "lint",
      "---\ndescription: Lint\ncontext: inline\n---\nLint body.",
    );

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

Deno.test("harness: unsupported flat skill files fail fast", async () => {
  await withTestEnv(async ({ hlvmDir, fs, path }) => {
    await fs.writeTextFile(
      path.join(hlvmDir, "skills", "bad.md"),
      "---\ndescription: Bad\n---\nNope.",
    );

    const { loadSkillCatalog } = await import("../../src/hlvm/skills/mod.ts");
    resetSkillCatalogCache();
    await assertRejects(
      () => loadSkillCatalog(),
      Error,
      "Flat skill file",
    );
  });
});

Deno.test("harness: unsupported skill metadata fails fast", async () => {
  await withTestEnv(async ({ hlvmDir }) => {
    await writeSkillFile(
      hlvmDir,
      "bad",
      "---\ndescription: Bad\nallowed_tools: [shell_exec]\n---\nNope.",
    );

    const { loadSkillCatalog } = await import("../../src/hlvm/skills/mod.ts");
    resetSkillCatalogCache();
    await assertRejects(
      () => loadSkillCatalog(),
      Error,
      "Unsupported legacy skill field",
    );
  });
});

// ═══════════════════════════════════════════════
// E2E 3: Slash commands
// ═══════════════════════════════════════════════

Deno.test({
  name: "harness: /commit activates inline skill",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withTestEnv(async () => {
      const { runCommand } = await import(
        "../../src/hlvm/cli/repl/commands.ts"
      );
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
  },
});

Deno.test({
  name: "harness: /review activates fork skill",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withTestEnv(async () => {
      const { runCommand } = await import(
        "../../src/hlvm/cli/repl/commands.ts"
      );
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
  },
});

Deno.test({
  name: "harness: unknown slash command rejected",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withTestEnv(async () => {
      const { runCommand } = await import(
        "../../src/hlvm/cli/repl/commands.ts"
      );
      const out: string[] = [];
      // deno-lint-ignore no-explicit-any
      const r = await runCommand("/nope", {} as any, {
        onOutput: (l: string) => out.push(l),
      });
      assertEquals(r.handled, false);
      assertEquals(r.skillActivation, undefined);
    });
  },
});

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
    assertEquals(with_.text.includes("commit"), true);
    const without_ = compileSystemPrompt({});
    assertEquals(without_.text.includes("# Skills"), false);
  });
});

// ═══════════════════════════════════════════════
// E2E 5: Skill tool
// ═══════════════════════════════════════════════

Deno.test("harness: skill tool aliases registered in registry", async () => {
  const { hasTool } = await import("../../src/hlvm/agent/registry.ts");
  assertEquals(hasTool("skill"), true);
  assertEquals(hasTool("Skill"), true);
});

// ═══════════════════════════════════════════════
// E2E 6: Hooks
// ═══════════════════════════════════════════════

Deno.test("harness: hook runtime loads all 3 types + new events", async () => {
  const platform = getPlatform();
  const dir = await platform.fs.makeTempDir({ prefix: "hlvm-hook-" });
  await platform.fs.mkdir(platform.path.join(dir, ".hlvm"), {
    recursive: true,
  });
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

Deno.test("harness: dispatchWithFeedback blocks on exit code 2", async () => {
  const platform = getPlatform();
  const dir = await platform.fs.makeTempDir({ prefix: "hlvm-hook-block-" });
  await platform.fs.mkdir(platform.path.join(dir, ".hlvm"), {
    recursive: true,
  });
  // Runtime-level hook behavior: exit code 2 blocks and stdout becomes feedback.
  await platform.fs.writeTextFile(
    platform.path.join(dir, ".hlvm", "hooks.json"),
    JSON.stringify({
      version: 1,
      hooks: {
        pre_tool: [{
          command: ["sh", "-c", "echo 'blocked by policy' && exit 2"],
        }],
      },
    }),
  );

  try {
    const { loadAgentHookRuntime } = await import(
      "../../src/hlvm/agent/hooks.ts"
    );
    const rt = await loadAgentHookRuntime(dir);
    assertEquals(!!rt, true);
    const fb = await rt!.dispatchWithFeedback("pre_tool", {
      tool: "shell_exec",
    });
    assertEquals(fb.blocked, true, "exit code 2 must block");
    assertEquals(
      fb.feedback?.includes("blocked by policy"),
      true,
      "stdout is feedback message",
    );
  } finally {
    await platform.fs.remove(dir, { recursive: true });
  }
});

Deno.test({
  name: "harness: executeToolCall respects blocking pre_tool hook",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    // Orchestrator caller behavior: executeToolCall must honor blocking pre_tool feedback.
    const mockHookRuntime = {
      hasHandlers: () => true,
      dispatch: () => Promise.resolve(),
      dispatchWithFeedback: (_name: string, _payload: unknown) =>
        Promise.resolve({ blocked: true, feedback: "policy: blocked" }),
      dispatchDetached: () => {},
      waitForIdle: () => Promise.resolve(),
    };

    const { executeToolCall } = await import(
      "../../src/hlvm/agent/orchestrator-tool-execution.ts"
    );

    // Minimal OrchestratorConfig with blocking hookRuntime
    const config = {
      workspace: "/tmp",
      hookRuntime: mockHookRuntime,
      modelId: "test",
      sessionId: "test",
      turnId: "test",
      l1Confirmations: new Map(),
      toolOwnerId: "test",
      ensureMcpLoaded: () => Promise.resolve(),
    };

    const toolCall = {
      toolName: "shell_exec",
      id: "call-1",
      args: { command: "rm -rf /" },
    };

    // deno-lint-ignore no-explicit-any
    const result = await executeToolCall(toolCall as any, config as any);
    assertEquals(result.success, false, "blocked tool must fail");
    assertEquals(
      result.error?.includes("policy: blocked") ||
        result.returnDisplay?.includes("policy: blocked") ||
        result.llmContent?.includes("policy: blocked") ||
        false,
      true,
      "feedback message propagated to result",
    );
  },
});

Deno.test("harness: skill cache is workspace-keyed", async () => {
  await withTestEnv(async ({ hlvmDir, workspace, path }) => {
    await writeSkillFile(
      hlvmDir,
      "global-only",
      "---\ndescription: Global skill\ncontext: inline\n---\nGlobal body.",
    );
    await writeSkillFile(
      path.join(workspace, ".hlvm"),
      "project-only",
      "---\ndescription: Project skill\ncontext: inline\n---\nProject body.",
    );
    const { trustWorkspace } = await import(
      "../../src/hlvm/prompt/instructions.ts"
    );
    await trustWorkspace(workspace);

    const { loadSkillCatalog } = await import("../../src/hlvm/skills/mod.ts");

    // Reset once at start, then NO resets between loads.
    // This is the actual regression test: load A, then B, verify B != A.
    resetSkillCatalogCache();

    // Load 1: no workspace — bundled + user only
    const cat1 = await loadSkillCatalog();
    assertEquals(cat1.has("global-only"), true, "load 1: global skill present");
    assertEquals(cat1.has("project-only"), false, "load 1: no project skill");

    // Load 2: with workspace — should NOT return stale cache from load 1
    const cat2 = await loadSkillCatalog(workspace);
    assertEquals(cat2.has("global-only"), true, "load 2: global skill present");
    assertEquals(
      cat2.has("project-only"),
      true,
      "load 2: project skill present (not stale)",
    );

    // Load 3: no workspace again — should NOT return stale cache from load 2
    const cat3 = await loadSkillCatalog();
    assertEquals(
      cat3.has("project-only"),
      false,
      "load 3: project skill gone (not leaked from load 2)",
    );
  });
});

Deno.test("harness: old-format hooks (no type field) still work", async () => {
  const platform = getPlatform();
  const dir = await platform.fs.makeTempDir({ prefix: "hlvm-hook-compat-" });
  await platform.fs.mkdir(platform.path.join(dir, ".hlvm"), {
    recursive: true,
  });
  await platform.fs.writeTextFile(
    platform.path.join(dir, ".hlvm", "hooks.json"),
    JSON.stringify({
      version: 1,
      hooks: { pre_tool: [{ command: ["old.sh"] }] },
    }),
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
  await withTestEnv(async ({ workspace, fs, path }) => {
    // Setup project files
    await fs.mkdir(path.join(workspace, ".hlvm", "agents"), {
      recursive: true,
    });
    await fs.writeTextFile(
      path.join(workspace, ".hlvm", "agents", "evil.md"),
      "---\nname: evil\ndescription: Bad\ntools:\n  - shell_exec\n---\nEvil.",
    );
    await fs.writeTextFile(
      path.join(workspace, ".hlvm", "rules", "proj.md"),
      "Project rule.",
    );
    await writeSkillFile(
      path.join(workspace, ".hlvm"),
      "pskill",
      "---\ndescription: Project skill\ncontext: inline\n---\nBody.",
    );

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
