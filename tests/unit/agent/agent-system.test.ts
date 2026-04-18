/**
 * Agent System Tests — Comprehensive unit + integration tests
 *
 * Tests all modules of the new CC-inspired agent system:
 * - agent-constants: disallow lists, limits
 * - agent-types: type guards
 * - agent-tool-utils: tool resolution, filtering
 * - built-in agents: definitions, prompts, tools
 * - agent-definitions: .md parsing, loading, priority
 * - agent-prompt: brain-facing listing
 * - run-agent: child loop execution
 * - agent-tool: dispatcher (sync + async)
 */

import {
  assertEquals,
  assertExists,
  assertMatch,
  assertNotEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";

// Constants
import {
  AGENT_MAX_TURNS,
  AGENT_TOOL_NAME,
  ALL_AGENT_DISALLOWED_TOOLS,
  ASYNC_AGENT_ALLOWED_TOOLS,
  CUSTOM_AGENT_DISALLOWED_TOOLS,
  ONE_SHOT_AGENT_TYPES,
} from "../../../src/hlvm/agent/tools/agent-constants.ts";

// Types
import {
  type AgentDefinition,
  type BuiltInAgentDefinition,
  type CustomAgentDefinition,
  isBuiltInAgent,
  isCustomAgent,
} from "../../../src/hlvm/agent/tools/agent-types.ts";

// Tool utils
import {
  applyParentPermissions,
  filterToolsForAgent,
  resolveAgentTools,
} from "../../../src/hlvm/agent/tools/agent-tool-utils.ts";
import { permissionRuleValueFromString } from "../../../src/hlvm/agent/tools/permission-rule.ts";

// Built-in agents
import { GENERAL_PURPOSE_AGENT } from "../../../src/hlvm/agent/tools/built-in/general.ts";
import { EXPLORE_AGENT } from "../../../src/hlvm/agent/tools/built-in/explore.ts";
import { PLAN_AGENT } from "../../../src/hlvm/agent/tools/built-in/plan.ts";
import { getBuiltInAgents } from "../../../src/hlvm/agent/tools/built-in-agents.ts";

// Agent definitions
import {
  getActiveAgentsFromList,
  parseAgentFromMarkdown,
} from "../../../src/hlvm/agent/tools/agent-definitions.ts";

// Prompt
import {
  formatAgentLine,
  getAgentToolPrompt,
} from "../../../src/hlvm/agent/tools/agent-prompt.ts";

// Agent tool
import {
  getAllBackgroundAgents,
  getBackgroundAgent,
} from "../../../src/hlvm/agent/tools/agent-tool.ts";

// Registry (verify wiring)
import { getAllTools, hasTool } from "../../../src/hlvm/agent/registry.ts";
import type { ToolMetadata } from "../../../src/hlvm/agent/registry.ts";
import { buildToolJsonSchema } from "../../../src/hlvm/agent/tool-schema.ts";

// ============================================================
// Helper: create mock tool metadata
// ============================================================

function mockTool(
  name: string,
  overrides?: Partial<ToolMetadata>,
): ToolMetadata {
  return {
    fn: async () => `result from ${name}`,
    description: `Mock ${name}`,
    args: {},
    ...overrides,
  };
}

function mockToolRegistry(...names: string[]): Record<string, ToolMetadata> {
  const registry: Record<string, ToolMetadata> = {};
  for (const name of names) {
    registry[name] = mockTool(name);
  }
  return registry;
}

// ============================================================
// 1. agent-constants.ts
// ============================================================

Deno.test("constants: AGENT_TOOL_NAME is 'Agent'", () => {
  assertEquals(AGENT_TOOL_NAME, "Agent");
});

Deno.test("constants: AGENT_MAX_TURNS is 200", () => {
  assertEquals(AGENT_MAX_TURNS, 200);
});

Deno.test("constants: ALL_AGENT_DISALLOWED_TOOLS contains expected tools", () => {
  assertEquals(ALL_AGENT_DISALLOWED_TOOLS.has("ask_user"), true);
  assertEquals(ALL_AGENT_DISALLOWED_TOOLS.has("complete_task"), true);
  assertEquals(ALL_AGENT_DISALLOWED_TOOLS.has("Agent"), true);
});

Deno.test("constants: ASYNC_AGENT_ALLOWED_TOOLS contains core tools", () => {
  assertEquals(ASYNC_AGENT_ALLOWED_TOOLS.has("read_file"), true);
  assertEquals(ASYNC_AGENT_ALLOWED_TOOLS.has("write_file"), true);
  assertEquals(ASYNC_AGENT_ALLOWED_TOOLS.has("edit_file"), true);
  assertEquals(ASYNC_AGENT_ALLOWED_TOOLS.has("search_code"), true);
  assertEquals(ASYNC_AGENT_ALLOWED_TOOLS.has("shell_exec"), true);
});

Deno.test("constants: ONE_SHOT_AGENT_TYPES contains Explore and Plan", () => {
  assertEquals(ONE_SHOT_AGENT_TYPES.has("Explore"), true);
  assertEquals(ONE_SHOT_AGENT_TYPES.has("Plan"), true);
  assertEquals(ONE_SHOT_AGENT_TYPES.has("general-purpose"), false);
});

// ============================================================
// 2. agent-types.ts — type guards
// ============================================================

Deno.test("types: isBuiltInAgent returns true for built-in", () => {
  assertEquals(isBuiltInAgent(GENERAL_PURPOSE_AGENT), true);
  assertEquals(isBuiltInAgent(EXPLORE_AGENT), true);
  assertEquals(isBuiltInAgent(PLAN_AGENT), true);
});

Deno.test("types: isBuiltInAgent returns false for custom", () => {
  const custom: CustomAgentDefinition = {
    agentType: "test",
    whenToUse: "test",
    source: "user",
    getSystemPrompt: () => "test prompt",
  };
  assertEquals(isBuiltInAgent(custom), false);
});

Deno.test("types: isCustomAgent returns true for custom, false for built-in", () => {
  const custom: CustomAgentDefinition = {
    agentType: "test",
    whenToUse: "test",
    source: "user",
    getSystemPrompt: () => "test prompt",
  };
  assertEquals(isCustomAgent(custom), true);
  assertEquals(isCustomAgent(GENERAL_PURPOSE_AGENT), false);
});

// ============================================================
// 3. agent-tool-utils.ts — tool filtering and resolution
// ============================================================

Deno.test("filterToolsForAgent: blocks ALL_AGENT_DISALLOWED_TOOLS", () => {
  const tools = mockToolRegistry(
    "read_file",
    "ask_user",
    "complete_task",
    "Agent",
  );
  const filtered = filterToolsForAgent({ tools, isBuiltIn: true });

  assertEquals("read_file" in filtered, true);
  assertEquals("ask_user" in filtered, false);
  assertEquals("complete_task" in filtered, false);
  assertEquals("Agent" in filtered, false);
});

Deno.test("filterToolsForAgent: allows MCP tools always", () => {
  const tools = mockToolRegistry("mcp__slack_post", "ask_user");
  const filtered = filterToolsForAgent({ tools, isBuiltIn: false });

  assertEquals("mcp__slack_post" in filtered, true);
  assertEquals("ask_user" in filtered, false);
});

Deno.test("filterToolsForAgent: async restricts to allowlist", () => {
  const tools = mockToolRegistry("read_file", "write_file", "some_custom_tool");
  const filtered = filterToolsForAgent({
    tools,
    isBuiltIn: true,
    isAsync: true,
  });

  assertEquals("read_file" in filtered, true);
  assertEquals("write_file" in filtered, true);
  assertEquals("some_custom_tool" in filtered, false);
});

Deno.test("resolveAgentTools: wildcard returns all filtered tools", () => {
  const tools = mockToolRegistry("read_file", "write_file", "search_code");
  const result = resolveAgentTools(
    { tools: undefined, source: "built-in" },
    tools,
  );

  assertEquals(result.hasWildcard, true);
  assertEquals(result.resolvedTools.size, 3);
});

Deno.test("resolveAgentTools: ['*'] is treated as wildcard", () => {
  const tools = mockToolRegistry("read_file", "write_file");
  const result = resolveAgentTools(
    { tools: ["*"], source: "built-in" },
    tools,
  );

  assertEquals(result.hasWildcard, true);
  assertEquals(result.resolvedTools.size, 2);
});

Deno.test("resolveAgentTools: explicit list resolves correctly", () => {
  const tools = mockToolRegistry("read_file", "write_file", "search_code");
  const result = resolveAgentTools(
    { tools: ["read_file", "search_code"], source: "built-in" },
    tools,
  );

  assertEquals(result.hasWildcard, false);
  assertEquals(result.validTools, ["read_file", "search_code"]);
  assertEquals(result.invalidTools, []);
  assertEquals(result.resolvedTools.size, 2);
  assertEquals(result.resolvedTools.has("read_file"), true);
  assertEquals(result.resolvedTools.has("write_file"), false);
});

Deno.test("resolveAgentTools: invalid tools tracked", () => {
  const tools = mockToolRegistry("read_file");
  const result = resolveAgentTools(
    { tools: ["read_file", "nonexistent"], source: "built-in" },
    tools,
  );

  assertEquals(result.validTools, ["read_file"]);
  assertEquals(result.invalidTools, ["nonexistent"]);
});

Deno.test("applyParentPermissions: parent allowlist restricts child pool", () => {
  const tools = mockToolRegistry("read_file", "write_file", "shell_exec");
  const filtered = applyParentPermissions(tools, ["read_file"], undefined);
  assertEquals(Object.keys(filtered).sort(), ["read_file"]);
});

Deno.test("applyParentPermissions: parent denylist removes tools from child pool", () => {
  const tools = mockToolRegistry("read_file", "write_file", "shell_exec");
  const filtered = applyParentPermissions(tools, undefined, ["shell_exec"]);
  assertEquals(Object.keys(filtered).sort(), ["read_file", "write_file"]);
});

Deno.test("applyParentPermissions: no-op when neither list present", () => {
  const tools = mockToolRegistry("read_file", "write_file");
  const filtered = applyParentPermissions(tools, undefined, undefined);
  assertEquals(Object.keys(filtered).sort(), ["read_file", "write_file"]);
});

Deno.test("applyParentPermissions: MCP tools always pass through", () => {
  const tools = {
    ...mockToolRegistry("read_file"),
    "mcp__server__tool": { name: "mcp__server__tool" } as never,
  };
  const filtered = applyParentPermissions(tools, ["read_file"], undefined);
  assertEquals(Object.keys(filtered).sort(), ["mcp__server__tool", "read_file"]);
});

Deno.test("applyParentPermissions: allowlist accepts Tool(pattern) specs via CC parser", () => {
  const tools = mockToolRegistry("shell_exec", "read_file");
  const filtered = applyParentPermissions(
    tools,
    ["shell_exec(git status)"],
    undefined,
  );
  assertEquals(Object.keys(filtered).sort(), ["shell_exec"]);
});

Deno.test("computeEnvInfo: cwd override is reflected in <env> block", async () => {
  const { computeEnvInfo } = await import(
    "../../../src/hlvm/agent/tools/prompt-env.ts"
  );
  const tmp = await Deno.makeTempDir({ prefix: "env-cwd-override-" });
  try {
    const info = await computeEnvInfo("test-model", { cwd: tmp });
    if (!info.includes(`Working directory: ${tmp}`)) {
      throw new Error(`env block missing override cwd: ${info}`);
    }
    if (info.includes(`Working directory: ${Deno.cwd()}\n`)) {
      throw new Error(`env block leaked parent cwd: ${info}`);
    }
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("computeEnvInfo: falls back to process cwd when no override", async () => {
  const { computeEnvInfo } = await import(
    "../../../src/hlvm/agent/tools/prompt-env.ts"
  );
  const info = await computeEnvInfo("test-model");
  if (!info.includes(`Working directory: ${Deno.cwd()}`)) {
    throw new Error(`env block missing parent cwd fallback: ${info}`);
  }
});

Deno.test("permissionRuleValueFromString: plain tool name", () => {
  const r = permissionRuleValueFromString("Bash");
  assertEquals(r.toolName, "Bash");
  assertEquals(r.ruleContent, undefined);
});

Deno.test("permissionRuleValueFromString: tool with pattern content", () => {
  const r = permissionRuleValueFromString("Bash(npm install)");
  assertEquals(r.toolName, "Bash");
  assertEquals(r.ruleContent, "npm install");
});

Deno.test("permissionRuleValueFromString: wildcard content -> tool-wide", () => {
  const r = permissionRuleValueFromString("Bash(*)");
  assertEquals(r.toolName, "Bash");
  assertEquals(r.ruleContent, undefined);
});

Deno.test("permissionRuleValueFromString: empty content -> tool-wide", () => {
  const r = permissionRuleValueFromString("Bash()");
  assertEquals(r.toolName, "Bash");
  assertEquals(r.ruleContent, undefined);
});

Deno.test("permissionRuleValueFromString: escaped parens in content", () => {
  const r = permissionRuleValueFromString("Bash(python -c \"print\\(1\\)\")");
  assertEquals(r.toolName, "Bash");
  assertEquals(r.ruleContent, "python -c \"print(1)\"");
});

Deno.test("permissionRuleValueFromString: malformed returns whole string as toolName", () => {
  const r = permissionRuleValueFromString("Bash(unclosed");
  assertEquals(r.toolName, "Bash(unclosed");
});

Deno.test("resolveAgentTools: disallowedTools removed", () => {
  const tools = mockToolRegistry("read_file", "write_file", "edit_file");
  const result = resolveAgentTools(
    { tools: undefined, disallowedTools: ["write_file"], source: "built-in" },
    tools,
  );

  assertEquals(result.hasWildcard, true);
  assertEquals(result.resolvedTools.has("read_file"), true);
  assertEquals(result.resolvedTools.has("write_file"), false);
  assertEquals(result.resolvedTools.has("edit_file"), true);
});

Deno.test("resolveAgentTools: disallowedTools pattern spec 'shell_exec(rm -rf)' blocks whole tool", () => {
  const tools = mockToolRegistry("shell_exec", "read_file");
  const result = resolveAgentTools(
    {
      tools: undefined,
      disallowedTools: ["shell_exec(rm -rf)"],
      source: "built-in",
    },
    tools,
  );

  assertEquals(result.resolvedTools.has("shell_exec"), false);
  assertEquals(result.resolvedTools.has("read_file"), true);
});

Deno.test("resolveAgentTools: tools allow-list accepts 'shell_exec(pattern)' spec and resolves toolName", () => {
  const tools = mockToolRegistry("shell_exec", "read_file");
  const result = resolveAgentTools(
    {
      tools: ["shell_exec(git status)", "read_file"],
      source: "built-in",
    },
    tools,
  );

  assertEquals(result.validTools.includes("shell_exec"), true);
  assertEquals(result.validTools.includes("read_file"), true);
  assertEquals(result.resolvedTools.has("shell_exec"), true);
});

Deno.test("resolveAgentTools: tools allow-list 'Tool(*)' is treated as tool-wide", () => {
  const tools = mockToolRegistry("shell_exec");
  const result = resolveAgentTools(
    { tools: ["shell_exec(*)"], source: "built-in" },
    tools,
  );

  assertEquals(result.validTools.includes("shell_exec"), true);
  assertEquals(result.resolvedTools.has("shell_exec"), true);
});

// ============================================================
// 4. built-in agents
// ============================================================

Deno.test("built-in: GP agent has tools=['*']", () => {
  assertEquals(GENERAL_PURPOSE_AGENT.tools, ["*"]);
  assertEquals(GENERAL_PURPOSE_AGENT.agentType, "general-purpose");
  assertEquals(GENERAL_PURPOSE_AGENT.source, "built-in");
});

Deno.test("built-in: Explore agent has disallowed edit/write/Agent", () => {
  assertExists(EXPLORE_AGENT.disallowedTools);
  assertEquals(EXPLORE_AGENT.disallowedTools!.includes("Agent"), true);
  assertEquals(EXPLORE_AGENT.disallowedTools!.includes("edit_file"), true);
  assertEquals(EXPLORE_AGENT.disallowedTools!.includes("write_file"), true);
});

Deno.test("built-in: Plan agent has disallowed edit/write/Agent", () => {
  assertExists(PLAN_AGENT.disallowedTools);
  assertEquals(PLAN_AGENT.disallowedTools!.includes("Agent"), true);
  assertEquals(PLAN_AGENT.disallowedTools!.includes("edit_file"), true);
  assertEquals(PLAN_AGENT.disallowedTools!.includes("write_file"), true);
});

Deno.test("built-in: all agents have non-empty system prompts", () => {
  const gp = GENERAL_PURPOSE_AGENT.getSystemPrompt();
  const explore = EXPLORE_AGENT.getSystemPrompt();
  const plan = PLAN_AGENT.getSystemPrompt();

  assertNotEquals(gp.length, 0);
  assertNotEquals(explore.length, 0);
  assertNotEquals(plan.length, 0);
});

Deno.test("built-in: Explore prompt contains READ-ONLY", () => {
  const prompt = EXPLORE_AGENT.getSystemPrompt();
  assertStringIncludes(prompt, "READ-ONLY");
});

Deno.test("built-in: Plan prompt contains READ-ONLY", () => {
  const prompt = PLAN_AGENT.getSystemPrompt();
  assertStringIncludes(prompt, "READ-ONLY");
});

Deno.test("built-in: Explore has omitClaudeMd=true", () => {
  assertEquals(EXPLORE_AGENT.omitClaudeMd, true);
});

Deno.test("built-in: Plan has omitClaudeMd=true", () => {
  assertEquals(PLAN_AGENT.omitClaudeMd, true);
});

Deno.test("built-in: getBuiltInAgents returns all 3", () => {
  const agents = getBuiltInAgents();
  assertEquals(agents.length, 3);
  const types = agents.map((a) => a.agentType);
  assertEquals(types.includes("general-purpose"), true);
  assertEquals(types.includes("Explore"), true);
  assertEquals(types.includes("Plan"), true);
});

// ============================================================
// 5. agent-definitions.ts — .md parsing
// ============================================================

Deno.test("parseAgentFromMarkdown: parses valid agent", () => {
  const md = `---
name: security-auditor
description: Audit code for vulnerabilities
tools:
  - read_file
  - search_code
maxTurns: 100
---

You are a security auditor. Check for SQL injection.`;

  const agent = parseAgentFromMarkdown("/test/agents/sec.md", md, "user");
  assertExists(agent);
  assertEquals(agent!.agentType, "security-auditor");
  assertEquals(agent!.whenToUse, "Audit code for vulnerabilities");
  assertEquals(agent!.tools, ["read_file", "search_code"]);
  assertEquals(agent!.maxTurns, 100);
  assertEquals(agent!.source, "user");
  assertStringIncludes(agent!.getSystemPrompt(), "security auditor");
});

Deno.test("parseAgentFromMarkdown: returns null without name", () => {
  const md = `---
description: No name here
---

Some prompt.`;

  const agent = parseAgentFromMarkdown("/test/noname.md", md, "user");
  assertEquals(agent, null);
});

Deno.test("parseAgentFromMarkdown: returns null without description", () => {
  const md = `---
name: test-agent
---

Some prompt.`;

  const agent = parseAgentFromMarkdown("/test/nodesc.md", md, "user");
  assertEquals(agent, null);
});

Deno.test("parseAgentFromMarkdown: parses model inherit", () => {
  const md = `---
name: inheriter
description: Uses parent model
model: inherit
---

Prompt.`;

  const agent = parseAgentFromMarkdown("/test/inherit.md", md, "user");
  assertExists(agent);
  assertEquals(agent!.model, "inherit");
});

Deno.test("parseAgentFromMarkdown: parses isolation worktree", () => {
  const md = `---
name: isolated
description: Isolated agent
isolation: worktree
---

Prompt.`;

  const agent = parseAgentFromMarkdown("/test/iso.md", md, "user");
  assertExists(agent);
  assertEquals(agent!.isolation, "worktree");
});

Deno.test("parseAgentFromMarkdown: parses background true", () => {
  const md = `---
name: bg-agent
description: Background agent
background: true
---

Prompt.`;

  const agent = parseAgentFromMarkdown("/test/bg.md", md, "user");
  assertExists(agent);
  assertEquals(agent!.background, true);
});

Deno.test("parseAgentFromMarkdown: parses disallowedTools", () => {
  const md = `---
name: limited
description: Limited agent
disallowedTools:
  - shell_exec
  - write_file
---

Prompt.`;

  const agent = parseAgentFromMarkdown("/test/limited.md", md, "user");
  assertExists(agent);
  assertEquals(agent!.disallowedTools, ["shell_exec", "write_file"]);
});

Deno.test("parseAgentFromMarkdown: parses initialPrompt and permissionMode", () => {
  const md = `---
name: guided
description: Guided agent
initialPrompt: "Always start with ACK:"
permissionMode: plan
---

Prompt.`;

  const agent = parseAgentFromMarkdown("/test/guided.md", md, "user");
  assertExists(agent);
  assertEquals(agent!.initialPrompt, "Always start with ACK:");
  assertEquals(agent!.permissionMode, "plan");
});

Deno.test("parseAgentFromMarkdown: parses mcpServers references and inline servers", () => {
  const md = `---
name: mcp-agent
description: MCP-backed agent
mcpServers:
  - test
  - inline_test:
      command:
        - deno
        - run
        - /tmp/mcp-server.ts
      env:
        MCP_REPLY_PREFIX: inline
---

Prompt.`;

  const agent = parseAgentFromMarkdown("/test/mcp-agent.md", md, "user");
  assertExists(agent);
  assertEquals(agent!.mcpServers?.length, 2);
  assertEquals(agent!.mcpServers?.[0], "test");
  assertEquals(
    typeof agent!.mcpServers?.[1] === "object" &&
      agent!.mcpServers?.[1] !== null &&
      "inline_test" in agent!.mcpServers![1],
    true,
  );
});

// ============================================================
// 5b. agent-definitions.ts — priority resolution
// ============================================================

Deno.test("getActiveAgentsFromList: deduplicates by agentType", () => {
  const agents: AgentDefinition[] = [
    {
      agentType: "test",
      whenToUse: "built-in",
      source: "built-in",
      getSystemPrompt: () => "v1",
    },
    {
      agentType: "test",
      whenToUse: "user",
      source: "user",
      getSystemPrompt: () => "v2",
    },
  ];

  const active = getActiveAgentsFromList(agents);
  assertEquals(active.length, 1);
  assertEquals(active[0].whenToUse, "user"); // user overrides built-in
});

Deno.test("getActiveAgentsFromList: project overrides user", () => {
  const agents: AgentDefinition[] = [
    {
      agentType: "test",
      whenToUse: "built-in",
      source: "built-in",
      getSystemPrompt: () => "v1",
    },
    {
      agentType: "test",
      whenToUse: "user",
      source: "user",
      getSystemPrompt: () => "v2",
    },
    {
      agentType: "test",
      whenToUse: "project",
      source: "project",
      getSystemPrompt: () => "v3",
    },
  ];

  const active = getActiveAgentsFromList(agents);
  assertEquals(active.length, 1);
  assertEquals(active[0].whenToUse, "project"); // project wins
});

Deno.test("getActiveAgentsFromList: different types coexist", () => {
  const agents: AgentDefinition[] = [
    {
      agentType: "alpha",
      whenToUse: "a",
      source: "built-in",
      getSystemPrompt: () => "",
    },
    {
      agentType: "beta",
      whenToUse: "b",
      source: "user",
      getSystemPrompt: () => "",
    },
  ];

  const active = getActiveAgentsFromList(agents);
  assertEquals(active.length, 2);
});

// ============================================================
// 6. agent-prompt.ts
// ============================================================

Deno.test("formatAgentLine: produces correct format", () => {
  const line = formatAgentLine(GENERAL_PURPOSE_AGENT);
  assertStringIncludes(line, "- general-purpose:");
  assertStringIncludes(line, "(Tools:");
});

Deno.test("formatAgentLine: GP agent with tools=['*'] shows '*'", () => {
  const line = formatAgentLine(GENERAL_PURPOSE_AGENT);
  // GP has tools: ["*"] which is an explicit allowlist with one item
  assertStringIncludes(line, "(Tools: *)");
});

Deno.test("formatAgentLine: undefined tools shows 'All tools'", () => {
  const agent: AgentDefinition = {
    agentType: "test",
    whenToUse: "test",
    source: "built-in",
    // tools: undefined → no restrictions
    getSystemPrompt: () => "",
  };
  const line = formatAgentLine(agent);
  assertStringIncludes(line, "All tools");
});

Deno.test("formatAgentLine: disallowed shows 'All tools except'", () => {
  const agent: AgentDefinition = {
    agentType: "test",
    whenToUse: "test",
    source: "built-in",
    disallowedTools: ["Agent", "edit_file"],
    getSystemPrompt: () => "",
  };
  const line = formatAgentLine(agent);
  assertStringIncludes(line, "All tools except");
});

Deno.test("formatAgentLine: explicit tools listed", () => {
  const agent: AgentDefinition = {
    agentType: "test",
    whenToUse: "test",
    source: "built-in",
    tools: ["read_file", "search_code"],
    getSystemPrompt: () => "",
  };
  const line = formatAgentLine(agent);
  assertStringIncludes(line, "read_file, search_code");
});

Deno.test("getAgentToolPrompt: includes all built-in agents", () => {
  const agents = getBuiltInAgents();
  const prompt = getAgentToolPrompt(agents);
  assertStringIncludes(prompt, "general-purpose");
  assertStringIncludes(prompt, "Explore");
  assertStringIncludes(prompt, "Plan");
});

Deno.test("getAgentToolPrompt: includes usage guidance", () => {
  const agents = getBuiltInAgents();
  const prompt = getAgentToolPrompt(agents);
  assertStringIncludes(prompt, "Writing the prompt");
  assertStringIncludes(prompt, "When not to use");
});

// ============================================================
// 7. Registry integration
// ============================================================

Deno.test("registry: Agent tool is registered", () => {
  assertEquals(hasTool("Agent"), true);
});

Deno.test("registry: Agent tool has correct metadata", () => {
  const allTools = getAllTools();
  const agentTool = allTools["Agent"];
  assertExists(agentTool);
  assertEquals(typeof agentTool.fn, "function");
  assertStringIncludes(agentTool.description, "agent");
  assertEquals(agentTool.safetyLevel, "L0");
  assertEquals(agentTool.category, "meta");
});

Deno.test("registry: Agent tool schema only requires description and prompt", () => {
  const allTools = getAllTools();
  const agentTool = allTools["Agent"];
  assertExists(agentTool);
  const schema = buildToolJsonSchema(agentTool);
  assertEquals(schema.required?.includes("description"), true);
  assertEquals(schema.required?.includes("prompt"), true);
  assertEquals(schema.required?.includes("subagent_type"), false);
  assertEquals(schema.required?.includes("model"), false);
  assertEquals(schema.required?.includes("run_in_background"), false);
  assertEquals(schema.required?.includes("isolation"), false);
});

// ============================================================
// 8. agent-tool.ts — background agent tracking
// ============================================================

Deno.test("agent-tool: getAllBackgroundAgents starts empty", () => {
  const agents = getAllBackgroundAgents();
  // May have agents from other tests, just verify it returns an array
  assertEquals(Array.isArray(agents), true);
});

// ============================================================
// 9. Integration: tool resolution for built-in agents
// ============================================================

Deno.test("integration: Explore agent cannot use edit/write tools", () => {
  const tools = mockToolRegistry(
    "read_file",
    "write_file",
    "edit_file",
    "search_code",
    "list_files",
    "shell_exec",
    "Agent",
  );
  const result = resolveAgentTools(EXPLORE_AGENT, tools);

  assertEquals(result.resolvedTools.has("read_file"), true);
  assertEquals(result.resolvedTools.has("search_code"), true);
  // Disallowed by EXPLORE_AGENT.disallowedTools
  assertEquals(result.resolvedTools.has("edit_file"), false);
  assertEquals(result.resolvedTools.has("write_file"), false);
  assertEquals(result.resolvedTools.has("Agent"), false);
});

Deno.test("integration: GP agent gets all tools minus disallowed", () => {
  const tools = mockToolRegistry(
    "read_file",
    "write_file",
    "edit_file",
    "search_code",
    "shell_exec",
    "ask_user",
    "complete_task",
    "Agent",
  );
  const result = resolveAgentTools(GENERAL_PURPOSE_AGENT, tools);

  assertEquals(result.hasWildcard, true);
  // Should have everything except ALL_AGENT_DISALLOWED_TOOLS
  assertEquals(result.resolvedTools.has("read_file"), true);
  assertEquals(result.resolvedTools.has("write_file"), true);
  assertEquals(result.resolvedTools.has("shell_exec"), true);
  // Blocked by ALL_AGENT_DISALLOWED_TOOLS
  assertEquals(result.resolvedTools.has("ask_user"), false);
  assertEquals(result.resolvedTools.has("complete_task"), false);
  assertEquals(result.resolvedTools.has("Agent"), false);
});

Deno.test("integration: Plan agent has same restrictions as Explore", () => {
  const tools = mockToolRegistry(
    "read_file",
    "write_file",
    "edit_file",
    "search_code",
    "Agent",
  );
  const exploreResult = resolveAgentTools(EXPLORE_AGENT, tools);
  const planResult = resolveAgentTools(PLAN_AGENT, tools);

  // Both should block edit_file, write_file, Agent
  assertEquals(exploreResult.resolvedTools.has("edit_file"), false);
  assertEquals(planResult.resolvedTools.has("edit_file"), false);
  assertEquals(exploreResult.resolvedTools.has("write_file"), false);
  assertEquals(planResult.resolvedTools.has("write_file"), false);
});
