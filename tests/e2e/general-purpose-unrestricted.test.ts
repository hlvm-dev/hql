/**
 * Unrestricted general-purpose eval — NO toolAllowlist.
 *
 * Tests the same queries but with the full standard-tier tool set visible (~23 tools).
 * This is the honest test: does the agent pick the right tool when ALL tools are available?
 *
 * Run:
 *   HLVM_E2E_GP_UNRESTRICTED=1 \
 *   HLVM_LIVE_AGENT_MODEL=ollama/gemma4:e4b \
 *   deno test --allow-all tests/e2e/general-purpose-unrestricted.test.ts
 */

import { assertEquals } from "jsr:@std/assert";
import type { AgentUIEvent } from "../../src/hlvm/agent/orchestrator.ts";
import { getPlatform } from "../../src/platform/platform.ts";
import {
  runSourceAgentWithCompatibleModel,
  withFullyIsolatedEnv,
} from "./native-provider-smoke-helpers.ts";

const platform = getPlatform();
const ENABLED = platform.env.get("HLVM_E2E_GP_UNRESTRICTED") === "1";
const CASE_FILTER = platform.env.get("HLVM_E2E_GP_CASE")?.trim() ?? "";
const TIMEOUT_MS = 600_000;

const DEFAULT_MODEL_CANDIDATES = [
  "claude-code/claude-haiku-4-5-20251001",
  "claude-code/claude-haiku-4-5-20251001:agent",
  "claude-haiku-4.5",
  "claude-haiku-4-5-20251001",
  "claude-haiku-4-5-20251001:agent",
];
const liveModel = platform.env.get("HLVM_LIVE_AGENT_MODEL")?.trim() ?? "";
const MODEL_CANDIDATES = [
  ...new Set(
    [liveModel, ...DEFAULT_MODEL_CANDIDATES].filter((v) => v.length > 0),
  ),
];

interface UnrestrictedCase {
  id: string;
  description: string;
  query: string;
  fixtures?: Record<string, string>;
  validate: (result: {
    text: string;
    toolNames: string[];
    toolArgs: Array<{ name: string; args: string }>;
  }) => string[];
}

function collectToolInfo(events: AgentUIEvent[]): {
  names: string[];
  args: Array<{ name: string; args: string }>;
} {
  const names: string[] = [];
  const args: Array<{ name: string; args: string }> = [];
  for (const event of events) {
    if (event.type === "tool_end") names.push(event.name);
    if (event.type === "tool_start") {
      args.push({ name: event.name, args: event.argsSummary ?? "" });
    }
  }
  return { names, args };
}

// No toolAllowlist on any case — agent sees full standard-tier set (~23 tools)
const CASES: UnrestrictedCase[] = [
  {
    id: "cleanup_dmgs",
    description: "Trash .dmg files with full tool set visible",
    query: "Find all .dmg files in this directory and move them to the Trash.",
    fixtures: {
      "installer-v1.dmg": "fake dmg 1",
      "installer-v2.dmg": "fake dmg 2",
      "important.txt": "keep this",
    },
    validate: (result) => {
      const errors: string[] = [];
      if (!result.toolNames.includes("move_to_trash")) {
        errors.push(
          `Expected move_to_trash but got: ${result.toolNames.join(", ")}`,
        );
      }
      if (result.toolNames.includes("shell_exec")) {
        errors.push("Used shell_exec when move_to_trash was available.");
      }
      return errors;
    },
  },
  {
    id: "reveal_in_finder",
    description: "Reveal file in Finder with full tool set",
    query:
      "There is a file called notes.txt in this directory. Reveal it in Finder.",
    fixtures: { "notes.txt": "my notes" },
    validate: (result) => {
      const errors: string[] = [];
      if (!result.toolNames.includes("reveal_path")) {
        errors.push(
          `Expected reveal_path but got: ${result.toolNames.join(", ")}`,
        );
      }
      return errors;
    },
  },
  {
    id: "read_note",
    description: "Read a note file with full tool set",
    query:
      "Read the file called todo.txt in the current workspace and summarize its contents.",
    fixtures: {
      "todo.txt": "1. Buy groceries\n2. Call dentist\n3. Finish report",
    },
    validate: (result) => {
      const errors: string[] = [];
      if (!result.toolNames.includes("read_file")) {
        errors.push(
          `Expected read_file but got: ${result.toolNames.join(", ")}`,
        );
      }
      if (result.toolNames.includes("shell_exec")) {
        errors.push("Used shell_exec when read_file was available.");
      }
      if (!result.text.toLowerCase().includes("groceries")) {
        errors.push("Response missing 'groceries' from file content.");
      }
      return errors;
    },
  },
  {
    id: "compare_configs",
    description: "Compare two files with full tool set",
    query:
      "Compare config-old.json and config-new.json and tell me what changed.",
    fixtures: {
      "config-old.json": JSON.stringify(
        { port: 3000, debug: false },
        null,
        2,
      ),
      "config-new.json": JSON.stringify(
        { port: 8080, debug: true },
        null,
        2,
      ),
    },
    validate: (result) => {
      const errors: string[] = [];
      const readCount = result.toolNames.filter((n) => n === "read_file")
        .length;
      if (readCount < 2) {
        errors.push(`Expected read_file x2, got ${readCount}.`);
      }
      if (result.toolNames.includes("shell_exec")) {
        errors.push("Used shell_exec (diff) when read_file was available.");
      }
      if (!result.text.toLowerCase().includes("port")) {
        errors.push("Response missing 'port' change.");
      }
      return errors;
    },
  },
  {
    id: "check_sizes",
    description: "Check file sizes with full tool set",
    query:
      "In this directory, which file is larger: report.pdf or backup.zip? Tell me their sizes.",
    fixtures: {
      "report.pdf": "x".repeat(5000),
      "backup.zip": "y".repeat(12000),
    },
    validate: (result) => {
      const errors: string[] = [];
      const usedSizeTool = result.toolNames.includes("file_metadata") ||
        result.toolNames.includes("list_files");
      if (!usedSizeTool) {
        errors.push(
          `Expected file_metadata or list_files, got: ${result.toolNames.join(", ")}`,
        );
      }
      if (result.toolNames.includes("shell_exec")) {
        errors.push("Used shell_exec (stat/ls) when semantic tools available.");
      }
      if (!result.text.toLowerCase().includes("backup.zip")) {
        errors.push("Response missing 'backup.zip' as the larger file.");
      }
      return errors;
    },
  },
  {
    id: "general_knowledge",
    description: "Answer without tools when full set is visible",
    query: "What is the capital of Japan?",
    fixtures: {},
    validate: (result) => {
      const errors: string[] = [];
      const badTools = result.toolNames.filter(
        (n) => n !== "tool_search" && n !== "ask_user",
      );
      if (badTools.length > 0) {
        errors.push(
          `Used tools for general knowledge: ${badTools.join(", ")}`,
        );
      }
      if (!result.text.toLowerCase().includes("tokyo")) {
        errors.push("Response missing 'Tokyo'.");
      }
      return errors;
    },
  },
  {
    id: "rename_file",
    description: "Rename a file with full tool set",
    query: "Rename draft.txt to final.txt in this folder.",
    fixtures: { "draft.txt": "working draft" },
    validate: (result) => {
      const errors: string[] = [];
      if (!result.toolNames.includes("move_path")) {
        errors.push(
          `Expected move_path but got: ${result.toolNames.join(", ")}`,
        );
      }
      if (result.toolNames.includes("shell_exec")) {
        errors.push("Used shell_exec (mv) when move_path was available.");
      }
      return errors;
    },
  },
  {
    id: "selective_cleanup",
    description: "Multi-step reasoning with full tool set",
    query:
      "Look at the files here. Delete any temporary or backup files, but keep the originals.",
    fixtures: {
      "report.docx": "original",
      "report.docx.bak": "backup",
      "data.csv": "original",
      "data.csv.tmp": "temp",
      "notes.txt": "original",
    },
    validate: (result) => {
      const errors: string[] = [];
      if (!result.toolNames.includes("move_to_trash")) {
        errors.push(
          `Expected move_to_trash but got: ${result.toolNames.join(", ")}`,
        );
      }
      if (result.toolNames.includes("shell_exec")) {
        errors.push("Used shell_exec (rm) when move_to_trash was available.");
      }
      return errors;
    },
  },
  {
    id: "batch_organize_pngs",
    description: "Multi-tool chain with full tool set",
    query:
      "Create a folder called 'images' and move all .png files into it.",
    fixtures: {
      "photo1.png": "fake png 1",
      "photo2.png": "fake png 2",
      "readme.txt": "keep here",
    },
    validate: (result) => {
      const errors: string[] = [];
      if (!result.toolNames.includes("move_path")) {
        errors.push(
          `Expected move_path but got: ${result.toolNames.join(", ")}`,
        );
      }
      if (result.toolNames.includes("shell_exec")) {
        errors.push("Used shell_exec (mv/mkdir) when semantic tools available.");
      }
      return errors;
    },
  },
  {
    id: "open_readme",
    description: "Open a file with full tool set",
    query:
      "There is a file called readme.md in this directory. Open it with the default application.",
    fixtures: { "readme.md": "# My Project" },
    validate: (result) => {
      const errors: string[] = [];
      if (!result.toolNames.includes("open_path")) {
        errors.push(
          `Expected open_path but got: ${result.toolNames.join(", ")}`,
        );
      }
      if (
        result.toolArgs.some(
          (a) => a.name === "shell_exec" && /\bopen\b/i.test(a.args),
        )
      ) {
        errors.push("Used shell_exec 'open' when open_path was available.");
      }
      return errors;
    },
  },
  {
    id: "write_note",
    description: "Write a note with full tool set",
    query:
      "Create a file called meeting-notes.txt with the following: 'Meeting with team on Monday at 10am. Discuss Q3 roadmap.'",
    fixtures: {},
    validate: (result) => {
      const errors: string[] = [];
      if (!result.toolNames.includes("write_file")) {
        errors.push(
          `Expected write_file but got: ${result.toolNames.join(", ")}`,
        );
      }
      if (result.toolNames.includes("shell_exec")) {
        errors.push("Used shell_exec when write_file was available.");
      }
      return errors;
    },
  },
  {
    id: "edit_note",
    description: "Edit a note with full tool set",
    query:
      "In agenda.txt, replace 'Tuesday' with 'Wednesday' and keep everything else the same.",
    fixtures: {
      "agenda.txt": "Team lunch on Tuesday.\nBring the updated slides.\n",
    },
    validate: (result) => {
      const errors: string[] = [];
      if (!result.toolNames.includes("edit_file")) {
        errors.push(
          `Expected edit_file but got: ${result.toolNames.join(", ")}`,
        );
      }
      if (result.toolNames.includes("shell_exec")) {
        errors.push("Used shell_exec (sed) when edit_file was available.");
      }
      return errors;
    },
  },
  {
    id: "copy_backup",
    description: "Copy a file with full tool set",
    query:
      "Make a backup copy of notes.txt called notes-backup.txt in this folder.",
    fixtures: { "notes.txt": "draft notes" },
    validate: (result) => {
      const errors: string[] = [];
      if (!result.toolNames.includes("copy_path")) {
        errors.push(
          `Expected copy_path but got: ${result.toolNames.join(", ")}`,
        );
      }
      if (result.toolNames.includes("shell_exec")) {
        errors.push("Used shell_exec (cp) when copy_path was available.");
      }
      return errors;
    },
  },
  {
    id: "search_text",
    description: "Search non-code text with full tool set",
    query:
      "Search the files here for the phrase 'dentist appointment' and tell me which file contains it.",
    fixtures: {
      "notes.txt": "Dentist appointment on Tuesday at 3pm.",
      "journal.md": "Morning walk and coffee.",
    },
    validate: (result) => {
      const errors: string[] = [];
      if (!result.toolNames.includes("search_code")) {
        errors.push(
          `Expected search_code but got: ${result.toolNames.join(", ")}`,
        );
      }
      if (result.toolNames.includes("shell_exec")) {
        errors.push("Used shell_exec (grep) when search_code was available.");
      }
      if (!result.text.toLowerCase().includes("notes.txt")) {
        errors.push("Response missing 'notes.txt' as the matching file.");
      }
      return errors;
    },
  },
  {
    id: "archive_bundle",
    description: "Archive files with full tool set",
    query:
      "Create a zip archive called bundle.zip that contains notes.txt and report.txt.",
    fixtures: {
      "notes.txt": "meeting notes",
      "report.txt": "quarterly report",
    },
    validate: (result) => {
      const errors: string[] = [];
      if (!result.toolNames.includes("archive_files")) {
        errors.push(
          `Expected archive_files but got: ${result.toolNames.join(", ")}`,
        );
      }
      if (
        result.toolArgs.some(
          (a) => a.name === "shell_exec" && /\b(zip|tar)\b/i.test(a.args),
        )
      ) {
        errors.push(
          "Used shell_exec (zip/tar) when archive_files was available.",
        );
      }
      return errors;
    },
  },
];

const ACTIVE_CASES = CASE_FILTER
  ? CASES.filter((c) =>
    CASE_FILTER.split(",").map((s) => s.trim()).includes(c.id)
  )
  : CASES;

Deno.test({
  name:
    "E2E eval: unrestricted tool set — agent picks right tools from full standard-tier set",
  ignore: !ENABLED,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const failures: string[] = [];

    try {
      await withFullyIsolatedEnv(async (workspace) => {
        for (const testCase of ACTIVE_CASES) {
          if (testCase.fixtures) {
            for (const [name, content] of Object.entries(testCase.fixtures)) {
              const filePath = `${workspace}/${name}`;
              const dir = platform.path.dirname(filePath);
              await platform.fs.mkdir(dir, { recursive: true });
              await platform.fs.writeTextFile(filePath, content);
            }
          }

          const events: AgentUIEvent[] = [];
          let caseModel = "(none)";

          try {
            const { model, result } =
              await runSourceAgentWithCompatibleModel({
                models: MODEL_CANDIDATES,
                query: testCase.query,
                workspace,
                signal: controller.signal,
                disablePersistentMemory: true,
                permissionMode: "bypassPermissions",
                // NO toolAllowlist — full standard-tier set
                maxTokens: 2_000,
                callbacks: {
                  onAgentEvent: (event) => events.push(event),
                },
              });
            caseModel = model;

            const { names, args } = collectToolInfo(events);
            // Always log internal behavior for inspection
            console.log(`\n── ${testCase.id} (${caseModel}) ──`);
            for (const a of args) console.log(`  CALL: ${a.name}(${a.args})`);
            console.log(`  RESPONSE: ${result.text.trim().slice(0, 300)}`);

            const errors = testCase.validate({
              text: result.text.trim(),
              toolNames: names,
              toolArgs: args,
            });

            if (errors.length > 0) {
              failures.push(
                [
                  `  Case: ${testCase.id} (${testCase.description})`,
                  `  Model: ${caseModel}`,
                  `  Tools used: ${names.join(", ") || "(none)"}`,
                  `  Response (first 200): ${result.text.slice(0, 200)}`,
                  ...errors.map((err) => `  FAIL: ${err}`),
                ].join("\n"),
              );
            }
          } catch (error) {
            failures.push(
              `  Case: ${testCase.id} — ERROR: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }

          // Full workspace cleanup between cases
          try {
            for await (const entry of platform.fs.readDir(workspace)) {
              await platform.fs.remove(`${workspace}/${entry.name}`, {
                recursive: true,
              });
            }
          } catch {
            // Best-effort cleanup
          }
        }
      });
    } finally {
      clearTimeout(timeout);
    }

    if (failures.length > 0) {
      const report = [
        `\n${"=".repeat(60)}`,
        `UNRESTRICTED EVAL: ${failures.length}/${ACTIVE_CASES.length} cases failed`,
        `${"=".repeat(60)}`,
        ...failures,
        `${"=".repeat(60)}`,
      ].join("\n");
      console.error(report);
    }

    assertEquals(
      failures.length,
      0,
      `${failures.length}/${ACTIVE_CASES.length} unrestricted eval cases failed.`,
    );
  },
});
