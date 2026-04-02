import { atomicWriteTextFile } from "../src/common/atomic-file.ts";
import { addServerToConfig, removeServerFromConfig } from "../src/hlvm/agent/mcp/config.ts";
import { createAgentSession, type AgentSession } from "../src/hlvm/agent/session.ts";
import { runAgentQuery } from "../src/hlvm/agent/agent-runner.ts";
import type { AgentUIEvent, TraceEvent } from "../src/hlvm/agent/orchestrator.ts";
import type { AgentExecutionMode } from "../src/hlvm/agent/execution-mode.ts";
import { resetHlvmDirCacheForTests } from "../src/common/paths.ts";
import { getPlatform } from "../src/platform/platform.ts";
import { log } from "../src/hlvm/api/log.ts";

const platform = getPlatform();
const DEFAULT_MODEL = "claude-code/claude-haiku-4-5-20251001";
const SOAK_DOC_DIR = platform.path.join("docs", "llvm-for-llm");
const CLI_ENTRY_PATH = platform.path.fromFileUrl(
  new URL("../src/hlvm/cli/cli.ts", import.meta.url),
);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type SoakStatus = "pass" | "open" | "not_triggered" | "manual_only";

interface SoakScenarioResult {
  title: string;
  status: SoakStatus;
  notes: string[];
  excerpt?: string;
}

function getArgValue(flag: string): string | undefined {
  const args = platform.process.args();
  const index = args.findIndex((arg) => arg === flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function resolveModel(): string {
  return getArgValue("--model") ??
    (platform.env.get("HLVM_LIVE_AGENT_MODEL")?.trim() || DEFAULT_MODEL);
}

function getCurrentDateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function resolveOutputPath(): string {
  return getArgValue("--markdown") ??
    platform.path.join(
      SOAK_DOC_DIR,
      `ship-soak-evidence-${getCurrentDateStamp()}.md`,
    );
}

function lastTurnStats(
  events: readonly AgentUIEvent[],
): Extract<AgentUIEvent, { type: "turn_stats" }> | null {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event.type === "turn_stats") {
      return event;
    }
  }
  return null;
}

function lastToolEnd(
  events: readonly AgentUIEvent[],
  toolName?: string,
): Extract<AgentUIEvent, { type: "tool_end" }> | null {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event.type !== "tool_end") continue;
    if (!toolName || event.name === toolName) {
      return event;
    }
  }
  return null;
}

function hasTrace(
  traces: readonly TraceEvent[],
  type: TraceEvent["type"],
): boolean {
  return traces.some((event) => event.type === type);
}

function truncate(text: string, max = 240): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 3)}...`;
}

function fixturePath(): string {
  return platform.path.join(
    platform.process.cwd(),
    "tests",
    "fixtures",
    "mcp-server.ts",
  );
}

function buildCliCommand(args: readonly string[]): string[] {
  const execPath = platform.process.execPath();
  return /(?:^|\/|\\)deno(?:\.exe)?$/i.test(execPath)
    ? [execPath, "run", "-A", CLI_ENTRY_PATH, ...args]
    : [execPath, ...args];
}

function fixtureServer(name: string, options: {
  env?: Record<string, string>;
  allowEnv?: string[];
  allowRead?: string[];
  allowWrite?: string[];
}) {
  const allowEnv = options.allowEnv?.length
    ? [`--allow-env=${options.allowEnv.join(",")}`]
    : [];
  const allowRead = options.allowRead?.length
    ? [`--allow-read=${options.allowRead.join(",")}`]
    : [];
  const allowWrite = options.allowWrite?.length
    ? [`--allow-write=${options.allowWrite.join(",")}`]
    : [];
  return {
    name,
    command: ["deno", "run", ...allowEnv, ...allowRead, ...allowWrite, fixturePath()],
    ...(options.env ? { env: options.env } : {}),
  };
}

async function withIsolatedEnv<T>(
  fn: (workspace: string) => Promise<T>,
): Promise<T> {
  const hlvmDir = await platform.fs.makeTempDir({
    prefix: "hlvm-ship-soak-hlvm-",
  });
  const workspace = await platform.fs.makeTempDir({
    prefix: "hlvm-ship-soak-ws-",
  });
  const originalHlvmDir = platform.env.get("HLVM_DIR");

  try {
    platform.env.set("HLVM_DIR", hlvmDir);
    resetHlvmDirCacheForTests();
    return await fn(workspace);
  } finally {
    if (typeof originalHlvmDir === "string") {
      platform.env.set("HLVM_DIR", originalHlvmDir);
    } else {
      platform.env.delete("HLVM_DIR");
    }
    resetHlvmDirCacheForTests();
    for (const dir of [workspace, hlvmDir]) {
      try {
        await platform.fs.remove(dir, { recursive: true });
      } catch {
        // Best-effort temp cleanup only.
      }
    }
  }
}

async function runSingleTurn(options: {
  query: string;
  model: string;
  workspace: string;
  permissionMode?: AgentExecutionMode;
  runtimeMode?: "manual" | "auto";
  toolAllowlist?: string[];
  maxOutputTokens?: number;
  contextWindow?: number;
  messageHistory?: import("../src/hlvm/agent/context.ts").Message[];
}): Promise<{
  text: string;
  events: AgentUIEvent[];
  traces: TraceEvent[];
}> {
  const events: AgentUIEvent[] = [];
  const traces: TraceEvent[] = [];
  const result = await runAgentQuery({
    query: options.query,
    model: options.model,
    workspace: options.workspace,
    permissionMode: options.permissionMode ?? "dontAsk",
    runtimeMode: options.runtimeMode ?? "manual",
    toolAllowlist: options.toolAllowlist,
    maxOutputTokens: options.maxOutputTokens,
    contextWindow: options.contextWindow,
    disablePersistentMemory: true,
    skipSessionHistory: true,
    messageHistory: options.messageHistory,
    callbacks: {
      onAgentEvent: (event) => events.push(event),
      onTrace: (event) => traces.push(event),
    },
  });
  return { text: result.text, events, traces };
}

async function createReusableScenarioSession(options: {
  model: string;
  workspace: string;
  toolAllowlist?: string[];
  permissionMode?: AgentExecutionMode;
  runtimeMode?: "manual" | "auto";
}): Promise<AgentSession> {
  return await createAgentSession({
    workspace: options.workspace,
    model: options.model,
    toolAllowlist: options.toolAllowlist,
    runtimeMode: options.runtimeMode ?? "manual",
    onToken: undefined,
  });
}

async function runSessionTurn(options: {
  session: AgentSession;
  query: string;
  model: string;
  workspace: string;
  toolAllowlist?: string[];
  permissionMode?: AgentExecutionMode;
  runtimeMode?: "manual" | "auto";
}): Promise<{
  text: string;
  events: AgentUIEvent[];
  traces: TraceEvent[];
}> {
  const events: AgentUIEvent[] = [];
  const traces: TraceEvent[] = [];
  const result = await runAgentQuery({
    query: options.query,
    model: options.model,
    workspace: options.workspace,
    reusableSession: options.session,
    toolAllowlist: options.toolAllowlist,
    permissionMode: options.permissionMode ?? "bypassPermissions",
    runtimeMode: options.runtimeMode ?? "manual",
    skipSessionHistory: true,
    callbacks: {
      onAgentEvent: (event) => events.push(event),
      onTrace: (event) => traces.push(event),
    },
  });
  return { text: result.text, events, traces };
}

async function runContinuationScenario(
  model: string,
  workspace: string,
): Promise<SoakScenarioResult> {
  const { text, events } = await runSingleTurn({
    model,
    workspace,
    maxOutputTokens: 64,
    query:
      "Begin exactly with RESILIENCE-CONTINUATION-HEADER on its own line. " +
      "Then output a numbered list with the format `N. fruit-N` for as many lines as you can. " +
      "Do not call any tools. Do not add a preamble or closing sentence.",
  });
  const stats = lastTurnStats(events);
  const headerCount = text.split("RESILIENCE-CONTINUATION-HEADER").length - 1;
  if (stats?.continuedThisTurn && (stats.continuationCount ?? 0) >= 1 && headerCount === 1) {
    return {
      title: "Long-answer continuation",
      status: "pass",
      notes: [
        `continuedThisTurn=${String(stats.continuedThisTurn)}`,
        `continuationCount=${String(stats.continuationCount ?? 0)}`,
      ],
      excerpt: truncate(text),
    };
  }
  return {
    title: "Long-answer continuation",
    status: "not_triggered",
    notes: [
      `continuedThisTurn=${String(stats?.continuedThisTurn ?? false)}`,
      `continuationCount=${String(stats?.continuationCount ?? 0)}`,
      `headerCount=${String(headerCount)}`,
    ],
    excerpt: truncate(text),
  };
}

async function runCompactionScenario(
  model: string,
  workspace: string,
): Promise<SoakScenarioResult> {
  const repeated = (token: string) => `${token} `.repeat(320);
  const { text, events, traces } = await runSingleTurn({
    model,
    workspace,
    contextWindow: 320,
    messageHistory: [
      { role: "user", content: `history-a ${repeated("alpha")}` },
      { role: "assistant", content: `history-b ${repeated("beta")}` },
      { role: "user", content: `history-c ${repeated("gamma")}` },
      { role: "assistant", content: `history-d ${repeated("delta")}` },
      { role: "user", content: `history-e ${repeated("epsilon")}` },
    ],
    query: "Reply with exactly RESILIENCE-COMPACTION-OK. Do not call any tools.",
  });
  const stats = lastTurnStats(events);
  if (
    stats?.compactionReason === "proactive_pressure" &&
    hasTrace(traces, "context_compaction")
  ) {
    return {
      title: "Proactive compaction",
      status: "pass",
      notes: [`compactionReason=${stats.compactionReason}`],
      excerpt: truncate(text),
    };
  }
  return {
    title: "Proactive compaction",
    status: "not_triggered",
    notes: [
      `compactionReason=${stats?.compactionReason ?? "none"}`,
      `context_compaction_trace=${String(hasTrace(traces, "context_compaction"))}`,
    ],
    excerpt: truncate(text),
  };
}

async function runLocalHostScenario(
  model: string,
  workspace: string,
  hlvmDir: string,
): Promise<SoakScenarioResult> {
  const env = {
    ...platform.env.toObject(),
    HLVM_DIR: hlvmDir,
  };
  const commands = [
    buildCliCommand([
      "ask",
      "--model",
      model,
      "--permission-mode",
      "bypassPermissions",
      "--allowedTools",
      "write_file",
      "--allowedTools",
      "read_file",
      "Create a file named note.txt with exact contents ship-soak-one, then read it back and answer exactly HOST-WRITE-OK.",
    ]),
    buildCliCommand([
      "ask",
      "--model",
      model,
      "--permission-mode",
      "dontAsk",
      "--allowedTools",
      "read_file",
      "Read note.txt and answer exactly HOST-READ-OK.",
    ]),
    buildCliCommand([
      "ask",
      "--model",
      model,
      "--permission-mode",
      "dontAsk",
      "--allowedTools",
      "read_file",
      "Read note.txt and answer in exactly three words.",
    ]),
  ] as const;

  const excerpts: string[] = [];
  for (const cmd of commands) {
    const output = await platform.command.output({
      cmd: [...cmd],
      cwd: workspace,
      env,
      stdout: "piped",
      stderr: "piped",
    });
    const stdout = decoder.decode(output.stdout);
    const stderr = decoder.decode(output.stderr);
    const combined = `${stdout}\n${stderr}`;
    excerpts.push(truncate(combined));
    if (
      !output.success ||
      combined.includes("[HLVM5009]") ||
      combined.toLowerCase().includes("broken-body")
    ) {
      return {
        title: "Repeated local runtime-host runs",
        status: "open",
        notes: [`exitCode=${String(output.code)}`],
        excerpt: excerpts.join(" | "),
      };
    }
  }

  return {
    title: "Repeated local runtime-host runs",
    status: "pass",
    notes: ["3 consecutive ./hlvm ask runs completed without HLVM5009/broken-body"],
    excerpt: excerpts.join(" | "),
  };
}

async function runMcpReconnectScenario(
  model: string,
  workspace: string,
): Promise<SoakScenarioResult> {
  const stateDir = await platform.fs.makeTempDir({
    prefix: "hlvm-mcp-reconnect-state-",
  });
  const statePath = platform.path.join(stateDir, "mcp-state.json");
  const serverName = "reconnect";
  const server = fixtureServer(serverName, {
    allowEnv: ["MCP_TEST_MODE", "MCP_STATE_PATH"],
    allowRead: [stateDir],
    allowWrite: [stateDir],
    env: {
      MCP_TEST_MODE: "disconnect_once,dynamic_tools",
      MCP_STATE_PATH: statePath,
    },
  });
  await addServerToConfig(server);
  const session = await createReusableScenarioSession({
    model,
    workspace,
  });
  try {
    await session.ensureMcpLoaded?.();
    const first = await runSessionTurn({
      session,
      query:
        "Call mcp_reconnect_stable_echo with message `ship soak reconnect`. " +
        "After the tool call, answer with the exact tool result only. Do not call any other tools.",
      model,
      workspace,
    });
    const second = await runSessionTurn({
      session,
      query:
        "Call mcp_reconnect_reverse with text `stressed`. " +
        "After the tool call, answer with the exact tool result only. Do not call any other tools.",
      model,
      workspace,
    });

    const stableTool = lastToolEnd(first.events, "mcp_reconnect_stable_echo");
    const reverseTool = lastToolEnd(second.events, "mcp_reconnect_reverse");
    const pass = stableTool?.success === true &&
      stableTool.content.includes("gen2:ship soak reconnect") &&
      reverseTool?.success === true &&
      reverseTool.content.includes("desserts");

    return {
      title: "MCP reconnect and tool refresh",
      status: pass ? "pass" : "open",
      notes: [
        `stable_tool_success=${String(stableTool?.success ?? false)}`,
        `reverse_tool_success=${String(reverseTool?.success ?? false)}`,
      ],
      excerpt: truncate(
        `${stableTool?.content ?? first.text} | ${reverseTool?.content ?? second.text}`,
      ),
    };
  } finally {
    await session.dispose();
    await removeServerFromConfig(serverName);
    try {
      await platform.fs.remove(stateDir, { recursive: true });
    } catch {
      // Best-effort cleanup only.
    }
  }
}

async function runFileConflictScenario(
  model: string,
  workspace: string,
): Promise<SoakScenarioResult> {
  const filePath = platform.path.join(workspace, "conflict.txt");
  await atomicWriteTextFile(filePath, "apple\n");
  const toolAllowlist = ["read_file", "edit_file"];
  const session = await createReusableScenarioSession({
    model,
    workspace,
    toolAllowlist,
  });
  try {
    const first = await runSessionTurn({
      session,
      query:
        "Call read_file exactly once on conflict.txt, then answer exactly FILE-CONFLICT-READ-OK. Do not modify anything.",
      model,
      workspace,
      toolAllowlist,
      permissionMode: "dontAsk",
    });
    const firstRead = lastToolEnd(first.events, "read_file");
    if (firstRead?.success !== true) {
      return {
        title: "File conflict detection",
        status: "not_triggered",
        notes: ["precondition_read_file=false"],
        excerpt: truncate(firstRead?.content ?? first.text),
      };
    }
    await atomicWriteTextFile(filePath, "pear\n");
    const second = await runSessionTurn({
      session,
      query:
        "Attempt exactly one edit_file call to replace `pear` with `berry` in conflict.txt. " +
        "If the tool fails, do not retry or call any other tools. Answer with the tool error only.",
      model,
      workspace,
      toolAllowlist,
    });
    const toolEnd = lastToolEnd(second.events, "edit_file");
    const expected = "File changed since it was last read in this session. Re-read before editing or overwriting.";
    return {
      title: "File conflict detection",
      status: toolEnd?.content.includes(expected) ? "pass" : "open",
      notes: [`tool_success=${String(toolEnd?.success ?? false)}`],
      excerpt: truncate(toolEnd?.content ?? second.text),
    };
  } finally {
    await session.dispose();
  }
}

async function runPartialViewScenario(
  model: string,
  workspace: string,
): Promise<SoakScenarioResult> {
  const filePath = platform.path.join(workspace, "partial.txt");
  await atomicWriteTextFile(
    filePath,
    "alpha\nPARTIAL-NEEDLE\nomega\n",
  );
  const toolAllowlist = ["search_code", "edit_file"];
  const session = await createReusableScenarioSession({
    model,
    workspace,
    toolAllowlist,
  });
  try {
    const first = await runSessionTurn({
      session,
      query:
        "Call search_code exactly once with pattern `PARTIAL-NEEDLE` and path `partial.txt`, then answer exactly PARTIAL-SEARCH-OK.",
      model,
      workspace,
      toolAllowlist,
      permissionMode: "dontAsk",
    });
    const firstSearch = lastToolEnd(first.events, "search_code");
    if (firstSearch?.success !== true) {
      return {
        title: "Partial-view edit blocking",
        status: "not_triggered",
        notes: ["precondition_search_code=false"],
        excerpt: truncate(firstSearch?.content ?? first.text),
      };
    }
    const second = await runSessionTurn({
      session,
      query:
        "Attempt exactly one edit_file call to replace `PARTIAL-NEEDLE` with `UPDATED-NEEDLE` in partial.txt. " +
        "If the tool fails, do not retry or call any other tools. Answer with the tool error only.",
      model,
      workspace,
      toolAllowlist,
    });
    const toolEnd = lastToolEnd(second.events, "edit_file");
    const expected = "File was only partially viewed in this session. Re-read with read_file before editing.";
    return {
      title: "Partial-view edit blocking",
      status: toolEnd?.content.includes(expected) ? "pass" : "open",
      notes: [`tool_success=${String(toolEnd?.success ?? false)}`],
      excerpt: truncate(toolEnd?.content ?? second.text),
    };
  } finally {
    await session.dispose();
  }
}

function renderSoakMarkdown(input: {
  generatedAt: string;
  model: string;
  results: SoakScenarioResult[];
  profilingMarkdownPath: string;
}): string {
  const lines = [
    "# Claude-Only Ship Soak Evidence",
    "",
    `Generated: ${input.generatedAt}`,
    `Model: ${input.model}`,
    "",
    "## Scope",
    "",
    "- Deterministic automated: already green in the targeted gate.",
    "- Opt-in live: still separate from this document.",
    "- Manual soak: this document records the Claude-only ship-confidence pass.",
    "",
    `Prompt-cache profiling evidence: ${input.profilingMarkdownPath}`,
    "",
    "## Scenario Results",
    "",
  ];

  for (const result of input.results) {
    lines.push(`### ${result.title}`);
    lines.push("");
    lines.push(`- Status: \`${result.status}\``);
    for (const note of result.notes) {
      lines.push(`- ${note}`);
    }
    if (result.excerpt) {
      lines.push("- Excerpt:");
      lines.push("");
      lines.push("```text");
      lines.push(result.excerpt);
      lines.push("```");
    }
    lines.push("");
  }

  lines.push("## Notes");
  lines.push("");
  lines.push(
    "- Hybrid REPL/team rail remains a manual interactive surface. Record it separately if you run an explicit PTY/REPL session.",
  );
  lines.push(
    "- Proactive compaction is reported as `not_triggered` when the live model completed successfully without surfacing `proactive_pressure`.",
  );
  lines.push("");

  return lines.join("\n");
}

if (import.meta.main) {
  const model = resolveModel();
  const outputPath = resolveOutputPath();
  const profilingMarkdownPath = getArgValue("--profiling-markdown") ??
    platform.path.join(
      SOAK_DOC_DIR,
      `prompt-cache-profiling-evidence-${getCurrentDateStamp()}.md`,
    );

  try {
    await withIsolatedEnv(async (workspace) => {
      const hlvmDir = platform.env.get("HLVM_DIR");
      if (!hlvmDir) {
        throw new Error("Expected isolated HLVM_DIR to be set");
      }

      const results: SoakScenarioResult[] = [];
      log.info(`[claude-ship-soak] running continuation with ${model}`);
      results.push(await runContinuationScenario(model, workspace));
      log.info("[claude-ship-soak] running proactive compaction");
      results.push(await runCompactionScenario(model, workspace));
      log.info("[claude-ship-soak] running repeated local runtime-host checks");
      results.push(await runLocalHostScenario(model, workspace, hlvmDir));
      log.info("[claude-ship-soak] running MCP reconnect scenario");
      results.push(await runMcpReconnectScenario(model, workspace));
      log.info("[claude-ship-soak] running file conflict scenario");
      results.push(await runFileConflictScenario(model, workspace));
      log.info("[claude-ship-soak] running partial-view scenario");
      results.push(await runPartialViewScenario(model, workspace));
      results.push({
        title: "Hybrid REPL/team rail",
        status: "manual_only",
        notes: ["Requires an explicit interactive REPL session; not automated in this script."],
      });

      const markdown = renderSoakMarkdown({
        generatedAt: new Date().toISOString(),
        model,
        results,
        profilingMarkdownPath,
      });
      await platform.fs.ensureDir(platform.path.dirname(outputPath));
      await atomicWriteTextFile(outputPath, markdown);
      log.raw.log(`Wrote ship soak Markdown: ${outputPath}`);
    });
  } catch (error) {
    log.error("[claude-ship-soak] failed", error);
    platform.process.exit(1);
  }
}
