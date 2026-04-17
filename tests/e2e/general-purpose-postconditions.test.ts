/**
 * Opt-in Phase 1 postcondition evaluation.
 *
 * Purpose:
 * - Validate exact filesystem outcomes for common local tasks
 * - Inspect raw tool-call args, not only tool names
 * - Keep coverage close to real `hlvm ask` behavior by using the main-thread eager surface
 *
 * Run:
 *   HLVM_E2E_GENERAL_PURPOSE_POSTCONDITIONS=1 \
 *   HLVM_LIVE_AGENT_MODEL=ollama/gemma4:e2b \
 *   deno test --no-check --allow-all tests/e2e/general-purpose-postconditions.test.ts
 */

import { assertEquals } from "jsr:@std/assert";
import { REPL_MAIN_THREAD_QUERY_SOURCE } from "../../src/hlvm/agent/query-tool-routing.ts";
import type {
  AgentUIEvent,
  TraceEvent,
} from "../../src/hlvm/agent/orchestrator.ts";
import { getPlatform } from "../../src/platform/platform.ts";
import {
  runSourceAgentWithCompatibleModel,
  withFullyIsolatedEnv,
} from "./native-provider-smoke-helpers.ts";

const platform = getPlatform();
const ENABLED = platform.env.get("HLVM_E2E_GENERAL_PURPOSE_POSTCONDITIONS") ===
  "1";
const TIMEOUT_MS = 600_000;

const DEFAULT_MODEL_CANDIDATES = [
  "claude-code/claude-haiku-4-5-20251001",
  "claude-code/claude-haiku-4-5-20251001:agent",
  "claude-haiku-4.5",
  "claude-haiku-4-5-20251001",
  "claude-haiku-4-5-20251001:agent",
  "google/gemini-2.5-flash",
  "google/gemini-2.5-flash-lite",
  "google/gemini-2.0-flash-001",
] as const;
const liveModel = platform.env.get("HLVM_LIVE_AGENT_MODEL")?.trim() ?? "";
const MODEL_CANDIDATES = [
  ...new Set(
    [liveModel, ...DEFAULT_MODEL_CANDIDATES].filter((value) =>
      value.length > 0
    ),
  ),
];

interface ScenarioResult {
  model: string;
  text: string;
  toolNames: string[];
  toolCalls: Array<{ name: string; args: unknown }>;
  workspaceEntries: string[];
}

interface ScenarioCase {
  id: string;
  query: string;
  fixtures: Record<string, string>;
  validate: (result: ScenarioResult, workspace: string) => Promise<string[]>;
}

function renderWorkspaceScopedQuery(query: string, workspace: string): string {
  return [
    query,
    "",
    `Current workspace: ${workspace}`,
    "Use only the current workspace for this task unless an explicit path says otherwise.",
    "If a dedicated file tool is available or discoverable, use it instead of shell_exec.",
  ].join("\n");
}

function collectToolNames(events: AgentUIEvent[]): string[] {
  return events
    .filter((event): event is Extract<AgentUIEvent, { type: "tool_end" }> =>
      event.type === "tool_end"
    )
    .map((event) => event.name);
}

function collectToolCalls(
  traces: TraceEvent[],
): Array<{ name: string; args: unknown }> {
  return traces
    .filter((event): event is Extract<TraceEvent, { type: "tool_call" }> =>
      event.type === "tool_call"
    )
    .map((event) => ({ name: event.toolName, args: event.args }));
}

function findToolCalls(
  result: ScenarioResult,
  toolName: string,
): Array<Record<string, unknown>> {
  return result.toolCalls
    .filter((entry) => entry.name === toolName)
    .map((entry) => entry.args)
    .filter((value): value is Record<string, unknown> =>
      !!value && typeof value === "object" && !Array.isArray(value)
    );
}

async function writeWorkspaceFiles(
  workspace: string,
  fixtures: Record<string, string>,
): Promise<void> {
  for (const [name, content] of Object.entries(fixtures)) {
    const filePath = platform.path.join(workspace, name);
    await platform.fs.mkdir(platform.path.dirname(filePath), {
      recursive: true,
    });
    await platform.fs.writeTextFile(filePath, content);
  }
}

async function clearWorkspace(workspace: string): Promise<void> {
  for await (const entry of platform.fs.readDir(workspace)) {
    await platform.fs.remove(platform.path.join(workspace, entry.name), {
      recursive: true,
    });
  }
}

async function listWorkspaceEntries(
  workspace: string,
  relative = "",
): Promise<string[]> {
  const base = relative ? platform.path.join(workspace, relative) : workspace;
  const entries: string[] = [];
  for await (const entry of platform.fs.readDir(base)) {
    const nextRelative = relative
      ? platform.path.join(relative, entry.name)
      : entry.name;
    entries.push(nextRelative.replaceAll("\\", "/"));
    if (entry.isDirectory) {
      const nested = await listWorkspaceEntries(workspace, nextRelative);
      entries.push(...nested);
    }
  }
  return entries.sort();
}

async function existsInWorkspace(
  workspace: string,
  relativePath: string,
): Promise<boolean> {
  return await platform.fs.exists(platform.path.join(workspace, relativePath));
}

function normalizeWorkspaceToolPath(
  workspace: string,
  value: unknown,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "";
  }
  const normalizedValue = value.replaceAll("\\", "/");
  const normalizedWorkspace = workspace.replaceAll("\\", "/");
  if (
    normalizedValue === normalizedWorkspace ||
    normalizedValue === "."
  ) {
    return ".";
  }
  if (normalizedValue.startsWith("./")) {
    return normalizedValue.slice(2);
  }
  if (normalizedValue.startsWith(`${normalizedWorkspace}/`)) {
    return normalizedValue.slice(normalizedWorkspace.length + 1);
  }
  return normalizedValue;
}

function normalizeWorkspaceToolPathList(
  workspace: string,
  value: unknown,
): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => normalizeWorkspaceToolPath(workspace, entry));
}

const CASES: ScenarioCase[] = [
  {
    id: "rename_file_exact",
    query: "Rename draft.txt to final.txt in this folder.",
    fixtures: {
      "draft.txt": "working draft",
    },
    validate: async (result, workspace) => {
      const errors: string[] = [];
      if (!result.toolNames.includes("move_path")) {
        errors.push(
          `Expected move_path, got ${result.toolNames.join(", ") || "(none)"}.`,
        );
      }
      const calls = findToolCalls(result, "move_path");
      const call = calls[0];
      if (
        normalizeWorkspaceToolPath(workspace, call?.sourcePath) !==
          "draft.txt" ||
        normalizeWorkspaceToolPath(workspace, call?.destinationPath) !==
          "final.txt"
      ) {
        errors.push(
          `Expected move_path args sourcePath=draft.txt destinationPath=final.txt, got ${
            JSON.stringify(call ?? null)
          }.`,
        );
      }
      if (await existsInWorkspace(workspace, "draft.txt")) {
        errors.push("draft.txt still exists after rename.");
      }
      if (!(await existsInWorkspace(workspace, "final.txt"))) {
        errors.push("final.txt was not created by rename.");
      }
      return errors;
    },
  },
  {
    id: "batch_organize_pngs",
    query: "Create a folder called 'images' and move all .png files into it.",
    fixtures: {
      "photo1.png": "fake png 1",
      "photo2.png": "fake png 2",
      "readme.txt": "keep here",
    },
    validate: async (result, workspace) => {
      const errors: string[] = [];
      if (!result.toolNames.includes("make_directory")) {
        errors.push("Expected make_directory to be used.");
      }
      const moveCalls = findToolCalls(result, "move_path");
      if (moveCalls.length < 2) {
        errors.push(
          `Expected move_path to run twice, got ${moveCalls.length}.`,
        );
      }
      const destinations = moveCalls.map((call) =>
        normalizeWorkspaceToolPath(workspace, call.destinationPath)
      );
      for (const expected of ["images/photo1.png", "images/photo2.png"]) {
        if (!destinations.includes(expected)) {
          errors.push(
            `Expected move_path destination '${expected}', got ${
              JSON.stringify(destinations)
            }.`,
          );
        }
      }
      for (
        const expected of [
          "images",
          "images/photo1.png",
          "images/photo2.png",
          "readme.txt",
        ]
      ) {
        if (!(await existsInWorkspace(workspace, expected))) {
          errors.push(`Expected '${expected}' to exist after batch organize.`);
        }
      }
      if (await existsInWorkspace(workspace, "photo1.png")) {
        errors.push("photo1.png still exists at workspace root.");
      }
      if (await existsInWorkspace(workspace, "photo2.png")) {
        errors.push("photo2.png still exists at workspace root.");
      }
      return errors;
    },
  },
  {
    id: "selective_cleanup_preserves_originals",
    query:
      "Look at the files here. Delete any temporary or backup files, but keep the originals.",
    fixtures: {
      "report.docx": "original",
      "report.docx.bak": "backup",
      "data.csv": "original",
      "data.csv.tmp": "temp",
      "notes.txt": "original",
    },
    validate: async (result, workspace) => {
      const errors: string[] = [];
      if (!result.toolNames.includes("list_files")) {
        errors.push("Expected list_files to be used before cleanup.");
      }
      const trashCalls = findToolCalls(result, "move_to_trash");
      const paths = normalizeWorkspaceToolPathList(
        workspace,
        trashCalls[0]?.paths,
      );
      for (const expected of ["report.docx.bak", "data.csv.tmp"]) {
        if (!paths.includes(expected)) {
          errors.push(
            `Expected move_to_trash paths to include '${expected}', got ${
              JSON.stringify(paths)
            }.`,
          );
        }
      }
      for (const expected of ["report.docx", "data.csv", "notes.txt"]) {
        if (!(await existsInWorkspace(workspace, expected))) {
          errors.push(
            `Expected original '${expected}' to remain after cleanup.`,
          );
        }
      }
      for (const removed of ["report.docx.bak", "data.csv.tmp"]) {
        if (await existsInWorkspace(workspace, removed)) {
          errors.push(`Expected '${removed}' to be removed from workspace.`);
        }
      }
      return errors;
    },
  },
  {
    id: "archive_selected_files",
    query:
      "Create a zip archive called project-bundle.zip that contains notes.txt and report.txt.",
    fixtures: {
      "notes.txt": "meeting notes",
      "report.txt": "status report",
    },
    validate: async (result, workspace) => {
      const errors: string[] = [];
      if (!result.toolNames.includes("tool_search")) {
        errors.push(
          "Expected tool_search before archive_files because archive_files is deferred.",
        );
      }
      if (!result.toolNames.includes("archive_files")) {
        errors.push("Expected archive_files to be used.");
      }
      const calls = findToolCalls(result, "archive_files");
      const call = calls[0];
      const paths = normalizeWorkspaceToolPathList(workspace, call?.paths)
        .sort();
      if (
        JSON.stringify(paths) !== JSON.stringify(["notes.txt", "report.txt"])
      ) {
        errors.push(
          `Expected archive_files paths ['notes.txt','report.txt'], got ${
            JSON.stringify(paths)
          }.`,
        );
      }
      if (
        normalizeWorkspaceToolPath(workspace, call?.outputPath) !==
          "project-bundle.zip"
      ) {
        errors.push(
          `Expected archive_files outputPath=project-bundle.zip, got ${
            JSON.stringify(call?.outputPath ?? null)
          }.`,
        );
      }
      if (!(await existsInWorkspace(workspace, "project-bundle.zip"))) {
        errors.push(
          "Expected project-bundle.zip to exist after archive_files.",
        );
      }
      return errors;
    },
  },
  {
    id: "write_to_new_subdir",
    query: "Save the text 'Hello World' to a file at reports/2026/summary.txt.",
    fixtures: {},
    validate: async (result, workspace) => {
      const errors: string[] = [];
      if (!result.toolNames.includes("write_file")) {
        errors.push("Expected write_file to be used.");
      }
      const calls = findToolCalls(result, "write_file");
      const call = calls[0];
      if (
        normalizeWorkspaceToolPath(workspace, call?.path) !==
          "reports/2026/summary.txt"
      ) {
        errors.push(
          `Expected write_file path reports/2026/summary.txt, got ${
            JSON.stringify(call?.path ?? null)
          }.`,
        );
      }
      if (call?.createDirs !== true) {
        errors.push(
          `Expected write_file createDirs=true, got ${
            JSON.stringify(call?.createDirs ?? null)
          }.`,
        );
      }
      const outputPath = platform.path.join(
        workspace,
        "reports/2026/summary.txt",
      );
      if (!(await existsInWorkspace(workspace, "reports/2026/summary.txt"))) {
        errors.push("Expected reports/2026/summary.txt to exist.");
      } else {
        const content = await platform.fs.readTextFile(outputPath);
        if (content !== "Hello World") {
          errors.push(
            `Expected reports/2026/summary.txt to contain 'Hello World', got ${
              JSON.stringify(content)
            }.`,
          );
        }
      }
      return errors;
    },
  },
  {
    id: "copy_folder_backup_structure",
    query: "Copy the folder assets to assets-backup in this workspace.",
    fixtures: {
      "assets/logo.txt": "logo",
      "assets/icons/home.txt": "home",
    },
    validate: async (result, workspace) => {
      const errors: string[] = [];
      if (!result.toolNames.includes("copy_path")) {
        errors.push("Expected copy_path to be used.");
      }
      const calls = findToolCalls(result, "copy_path");
      const call = calls[0];
      if (
        normalizeWorkspaceToolPath(workspace, call?.sourcePath) !== "assets" ||
        normalizeWorkspaceToolPath(workspace, call?.destinationPath) !==
          "assets-backup"
      ) {
        errors.push(
          `Expected copy_path args sourcePath=assets destinationPath=assets-backup, got ${
            JSON.stringify(call ?? null)
          }.`,
        );
      }
      for (
        const expected of [
          "assets/logo.txt",
          "assets/icons/home.txt",
          "assets-backup/logo.txt",
          "assets-backup/icons/home.txt",
        ]
      ) {
        if (!(await existsInWorkspace(workspace, expected))) {
          errors.push(`Expected '${expected}' to exist after copy_path.`);
        }
      }
      return errors;
    },
  },
];

Deno.test({
  name:
    "E2E eval: Phase 1 postconditions verify exact file effects and raw tool args",
  ignore: !ENABLED,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const failures: string[] = [];

    await withFullyIsolatedEnv(async (workspace) => {
      for (const testCase of CASES) {
        await clearWorkspace(workspace).catch(() => {});
        await writeWorkspaceFiles(workspace, testCase.fixtures);

        const events: AgentUIEvent[] = [];
        const traces: TraceEvent[] = [];

        try {
          const { model, result } = await runSourceAgentWithCompatibleModel({
            models: MODEL_CANDIDATES,
            query: renderWorkspaceScopedQuery(testCase.query, workspace),
            workspace,
            querySource: REPL_MAIN_THREAD_QUERY_SOURCE,
            signal: AbortSignal.timeout(TIMEOUT_MS),
            permissionMode: "bypassPermissions",
            disablePersistentMemory: true,
            maxTokens: 2_000,
            callbacks: {
              onAgentEvent: (event) => events.push(event),
              onTrace: (event) => traces.push(event),
            },
          });

          const scenarioResult: ScenarioResult = {
            model,
            text: result.text.trim(),
            toolNames: collectToolNames(events),
            toolCalls: collectToolCalls(traces),
            workspaceEntries: await listWorkspaceEntries(workspace),
          };
          const errors = await testCase.validate(scenarioResult, workspace);
          if (errors.length > 0) {
            failures.push([
              `Case: ${testCase.id}`,
              `Model: ${scenarioResult.model}`,
              `Tools: ${scenarioResult.toolNames.join(", ") || "(none)"}`,
              `Workspace: ${JSON.stringify(scenarioResult.workspaceEntries)}`,
              `Response: ${scenarioResult.text.slice(0, 240)}`,
              ...errors.map((error) => `FAIL: ${error}`),
            ].join("\n"));
          }
        } catch (error) {
          failures.push(
            `Case: ${testCase.id} — ERROR: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    });

    assertEquals(
      failures,
      [],
      `Phase 1 postcondition eval failures:\n${failures.join("\n\n")}`,
    );
  },
});
