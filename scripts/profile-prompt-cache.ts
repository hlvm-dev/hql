import { atomicWriteTextFile } from "../src/common/atomic-file.ts";
import { resetHlvmDirCacheForTests } from "../src/common/paths.ts";
import { getPlatform } from "../src/platform/platform.ts";
import { log } from "../src/hlvm/api/log.ts";
import { runAgentQuery } from "../src/hlvm/agent/agent-runner.ts";
import type { AgentExecutionMode } from "../src/hlvm/agent/execution-mode.ts";
import type { RuntimeMode } from "../src/hlvm/agent/runtime-mode.ts";
import {
  materializeConversationAttachment,
  registerTextAttachment,
} from "../src/hlvm/attachments/service.ts";
import {
  buildPromptCacheProfilingReport,
  renderPromptCacheProfilingMarkdown,
  summarizePromptCacheProfilingRun,
  type PromptCacheProfilingScenarioName,
  type PromptCacheProfilingScenarioRun,
} from "../src/hlvm/agent/prompt-cache-profiling.ts";
import type { TraceEvent } from "../src/hlvm/agent/orchestrator.ts";

const platform = getPlatform();
const DEFAULT_MODEL = "claude-code/claude-haiku-4-5-20251001";
const PROFILE_DOC_DIR = platform.path.join("docs", "llvm-for-llm");

interface ScenarioConfig {
  name: PromptCacheProfilingScenarioName;
  title: string;
  query: string;
  runtimeMode: RuntimeMode;
  toolAllowlist?: string[];
  useTextAttachment?: boolean;
}

const SCENARIOS: readonly ScenarioConfig[] = [
  {
    name: "cold_baseline",
    title: "Cold baseline",
    query: "Reply with exactly CACHE-PROFILE-BASELINE-OK. Do not call any tools.",
    runtimeMode: "auto",
  },
  {
    name: "warm_stable_repeat",
    title: "Warm stable repeat",
    query: "Reply with exactly CACHE-PROFILE-BASELINE-OK. Do not call any tools.",
    runtimeMode: "auto",
  },
  {
    name: "turn_only_change",
    title: "Turn-only change",
    query:
      "Reply with exactly CACHE-PROFILE-TURN-OK. Do not call any tools.",
    runtimeMode: "auto",
    useTextAttachment: true,
  },
  {
    name: "session_stable_change",
    title: "Session-stable change",
    query:
      "Reply with exactly CACHE-PROFILE-SESSION-OK. Do not call any tools.",
    runtimeMode: "auto",
    toolAllowlist: ["read_file"],
  },
];

function getArgValue(flag: string): string | undefined {
  const args = platform.process.args();
  const index = args.findIndex((arg) => arg === flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function getCurrentDateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function resolveOutputPaths(): { jsonPath: string; markdownPath: string } {
  const dateStamp = getCurrentDateStamp();
  const defaultJsonPath = platform.path.join(
    PROFILE_DOC_DIR,
    `prompt-cache-profile-${dateStamp}.json`,
  );
  const defaultMarkdownPath = platform.path.join(
    PROFILE_DOC_DIR,
    `prompt-cache-profiling-evidence-${dateStamp}.md`,
  );
  return {
    jsonPath: getArgValue("--json") ?? defaultJsonPath,
    markdownPath: getArgValue("--markdown") ?? defaultMarkdownPath,
  };
}

function resolveModel(): string {
  return getArgValue("--model") ??
    (platform.env.get("HLVM_LIVE_AGENT_MODEL")?.trim() || DEFAULT_MODEL);
}

async function withIsolatedEnv<T>(
  fn: (workspace: string) => Promise<T>,
): Promise<T> {
  const hlvmDir = await platform.fs.makeTempDir({
    prefix: "hlvm-prompt-cache-profile-",
  });
  const workspace = await platform.fs.makeTempDir({
    prefix: "hlvm-prompt-cache-profile-ws-",
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

async function runScenario(
  scenario: ScenarioConfig,
  model: string,
  workspace: string,
): Promise<PromptCacheProfilingScenarioRun> {
  const traces: TraceEvent[] = [];
  const permissionMode: AgentExecutionMode = "dontAsk";
  const attachments = scenario.useTextAttachment
    ? [await materializeConversationAttachment(
      (
        await registerTextAttachment(
          "Prompt cache turn-only attachment context.",
          "turn-context.txt",
        )
      ).id,
    )]
    : undefined;

  const result = await runAgentQuery({
    query: scenario.query,
    model,
    workspace,
    skipSessionHistory: true,
    disablePersistentMemory: true,
    permissionMode,
    runtimeMode: scenario.runtimeMode,
    toolAllowlist: scenario.toolAllowlist,
    attachments,
    callbacks: { onTrace: (event) => traces.push(event) },
  });

  return summarizePromptCacheProfilingRun({
    scenario: scenario.name,
    title: scenario.title,
    traces,
    responseText: result.text,
  });
}

async function writeArtifacts(input: {
  jsonPath: string;
  markdownPath: string;
  report: ReturnType<typeof buildPromptCacheProfilingReport>;
}): Promise<void> {
  await platform.fs.ensureDir(platform.path.dirname(input.jsonPath));
  await platform.fs.ensureDir(platform.path.dirname(input.markdownPath));
  await atomicWriteTextFile(
    input.jsonPath,
    `${JSON.stringify(input.report, null, 2)}\n`,
  );
  await atomicWriteTextFile(
    input.markdownPath,
    renderPromptCacheProfilingMarkdown(input.report),
  );
}

if (import.meta.main) {
  const model = resolveModel();
  const { jsonPath, markdownPath } = resolveOutputPaths();
  try {
    const runs = await withIsolatedEnv(async (workspace) => {
      const collected: PromptCacheProfilingScenarioRun[] = [];
      for (const scenario of SCENARIOS) {
        log.info(`[profile-prompt-cache] running ${scenario.name} with ${model}`);
        collected.push(await runScenario(scenario, model, workspace));
      }
      return collected;
    });

    const report = buildPromptCacheProfilingReport(
      runs,
      new Date().toISOString(),
    );
    await writeArtifacts({ jsonPath, markdownPath, report });

    log.raw.log(`Wrote prompt cache profiling JSON: ${jsonPath}`);
    log.raw.log(`Wrote prompt cache profiling Markdown: ${markdownPath}`);
    log.raw.log(
      `Stable signature checks: cold->warm=${
        report.comparisons.warmStableMatchesCold ?? "n/a"
      } warm->turn=${report.comparisons.turnOnlyMatchesWarmStable ?? "n/a"} warm->session=${
        report.comparisons.sessionChangeDiffersFromWarmStable ?? "n/a"
      }`,
    );
  } catch (error) {
    log.error("[profile-prompt-cache] failed", error);
    platform.process.exit(1);
  }
}
