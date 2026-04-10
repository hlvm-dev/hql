/**
 * Opt-in general-purpose local agent evaluation.
 *
 * Purpose:
 * - Validate that HLVM handles non-coding local tasks as first-class work
 * - Verify the binary prefers semantic local tools over crude shell commands
 * - Grade by tool selection, not just final text output
 * - Ensure prompt/description changes produce real behavior improvement
 *
 * Run:
 *   HLVM_E2E_GENERAL_PURPOSE=1 \
 *   HLVM_LIVE_AGENT_MODEL=google/gemini-2.5-flash \
 *   deno test --allow-all tests/e2e/general-purpose-eval.test.ts
 *
 * Single case:
 *   HLVM_E2E_GENERAL_PURPOSE=1 \
 *   HLVM_E2E_GP_CASE=cleanup_old_files \
 *   deno test --allow-all tests/e2e/general-purpose-eval.test.ts
 */

import { assertEquals } from "jsr:@std/assert";
import type { AgentUIEvent } from "../../src/hlvm/agent/orchestrator.ts";
import { getPlatform } from "../../src/platform/platform.ts";
import {
  runSourceAgentWithCompatibleModel,
  withFullyIsolatedEnv,
} from "./native-provider-smoke-helpers.ts";

const platform = getPlatform();
const ENABLED = platform.env.get("HLVM_E2E_GENERAL_PURPOSE") === "1";
const CASE_FILTER = platform.env.get("HLVM_E2E_GP_CASE")?.trim() ?? "";
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
];
const liveModel = platform.env.get("HLVM_LIVE_AGENT_MODEL")?.trim() ?? "";
const MODEL_CANDIDATES = [
  ...new Set(
    [liveModel, ...DEFAULT_MODEL_CANDIDATES].filter((v) => v.length > 0),
  ),
];

// ============================================================
// Types
// ============================================================

interface GeneralPurposeCase {
  id: string;
  /** Human-readable description of what this case tests. */
  description: string;
  /** User query sent to the agent. */
  query: string;
  /** Files to create in the workspace before running the agent. */
  fixtures?: Record<string, string>;
  /** Tools the agent is allowed to use (restricts scope for cleaner eval). */
  toolAllowlist?: string[];
  /** Validate the result; return string[] of errors (empty = pass). */
  validate: (result: GeneralPurposeResult) => string[];
}

interface GeneralPurposeResult {
  /** Final text response from the agent. */
  text: string;
  /** Ordered list of tool names used during execution. */
  toolNames: string[];
  /** Tool args summaries for deeper inspection. */
  toolArgs: Array<{ name: string; args: string }>;
}

function renderWorkspaceScopedQuery(query: string, workspace: string): string {
  return [
    query,
    "",
    `Current workspace: ${workspace}`,
    "Use only the current workspace for this task unless an explicit path says otherwise.",
    "If a file mentioned in the request has no path, assume it is in the current workspace.",
    "Do not ask me to choose another directory when the current workspace is sufficient.",
  ].join("\n");
}

// ============================================================
// Helpers
// ============================================================

function collectToolInfo(events: AgentUIEvent[]): {
  names: string[];
  args: Array<{ name: string; args: string }>;
} {
  const names: string[] = [];
  const args: Array<{ name: string; args: string }> = [];
  for (const event of events) {
    if (event.type === "tool_end") {
      names.push(event.name);
    }
    if (event.type === "tool_start") {
      args.push({ name: event.name, args: event.argsSummary ?? "" });
    }
  }
  return { names, args };
}

/** Check that specific tools were used at least once. */
function expectToolsUsed(
  result: GeneralPurposeResult,
  expectedTools: string[],
): string[] {
  return expectedTools
    .filter((tool) => !result.toolNames.includes(tool))
    .map((tool) => `Expected tool '${tool}' to be used but it was not.`);
}

/** Check that specific tools were NOT used. */
function expectToolsNotUsed(
  result: GeneralPurposeResult,
  forbiddenTools: string[],
): string[] {
  return forbiddenTools
    .filter((tool) => result.toolNames.includes(tool))
    .map((tool) =>
      `Tool '${tool}' was used but should not have been. Tools used: ${
        result.toolNames.join(", ")
      }`
    );
}

/** Check that shell_exec was not used for a pattern that has a dedicated tool. */
function expectNoShellFor(
  result: GeneralPurposeResult,
  shellPatterns: RegExp[],
): string[] {
  const errors: string[] = [];
  for (const entry of result.toolArgs) {
    if (entry.name !== "shell_exec") continue;
    for (const pattern of shellPatterns) {
      if (pattern.test(entry.args)) {
        errors.push(
          `shell_exec was used with '${entry.args}' — a dedicated tool should handle this instead.`,
        );
      }
    }
  }
  return errors;
}

/** Check that the response text contains all expected substrings (case-insensitive). */
function expectTextContains(
  text: string,
  substrings: string[],
): string[] {
  const lower = text.toLowerCase();
  return substrings
    .filter((s) => !lower.includes(s.toLowerCase()))
    .map((s) => `Expected response to contain '${s}' but it did not.`);
}

/** Check that the response text has minimum length (agent actually did work). */
function expectMinLength(text: string, minLength: number): string[] {
  if (text.trim().length < minLength) {
    return [
      `Expected response of at least ${minLength} chars, got ${text.trim().length}.`,
    ];
  }
  return [];
}

// ============================================================
// Eval Cases
// ============================================================

const CASES: GeneralPurposeCase[] = [
  // ── Case 1: File cleanup should use list_files + move_to_trash ──
  {
    id: "cleanup_old_files",
    description:
      "Agent should discover .dmg files via list_files and trash them via move_to_trash, not shell rm",
    query: "Find all .dmg files in this directory and move them to the Trash.",
    fixtures: {
      "installer-v1.dmg": "fake dmg 1",
      "installer-v2.dmg": "fake dmg 2",
      "important.txt": "keep this",
      "notes.md": "keep this too",
    },
    toolAllowlist: [
      "list_files",
      "read_file",
      "move_to_trash",
      "shell_exec",
      "ask_user",
    ],
    validate: (result) => [
      ...expectToolsUsed(result, ["list_files", "move_to_trash"]),
      ...expectToolsNotUsed(result, ["shell_exec"]),
      ...expectMinLength(result.text, 20),
    ],
  },

  // ── Case 2: Reveal path should use reveal_path, not shell open -R ──
  {
    id: "reveal_file",
    description:
      "Agent should use reveal_path to show a file in Finder, not shell_exec 'open -R'",
    query: "Show me where notes.txt is located in Finder.",
    fixtures: {
      "notes.txt": "my important notes",
    },
    toolAllowlist: [
      "reveal_path",
      "open_path",
      "read_file",
      "list_files",
      "shell_exec",
      "ask_user",
    ],
    validate: (result) => [
      ...expectToolsUsed(result, ["reveal_path"]),
      ...expectNoShellFor(result, [/open\s+-R/i, /explorer.*\/select/i]),
      ...expectMinLength(result.text, 10),
    ],
  },

  // ── Case 3: Read a note should use read_file, not shell cat ──
  {
    id: "read_local_note",
    description:
      "Agent should use read_file to inspect a personal note, not shell cat/head/tail",
    query:
      "Read the file called todo.txt in the current workspace and summarize its contents.",
    fixtures: {
      "todo.txt":
        "1. Buy groceries\n2. Call dentist\n3. Finish report\n4. Water plants",
    },
    toolAllowlist: [
      "read_file",
      "list_files",
      "shell_exec",
      "ask_user",
    ],
    validate: (result) => [
      ...expectToolsUsed(result, ["read_file"]),
      ...expectToolsNotUsed(result, ["shell_exec"]),
      ...expectTextContains(result.text, ["groceries", "dentist"]),
    ],
  },

  // ── Case 4: List files by type should use list_files with pattern ──
  {
    id: "list_pdfs",
    description:
      "Agent should use list_files with a pattern, not shell find/ls | grep",
    query: "List all PDF files in this folder.",
    fixtures: {
      "report.pdf": "fake pdf",
      "slides.pdf": "fake pdf",
      "notes.txt": "text file",
      "photo.jpg": "fake image",
    },
    toolAllowlist: [
      "list_files",
      "read_file",
      "shell_exec",
      "ask_user",
    ],
    validate: (result) => [
      ...expectToolsUsed(result, ["list_files"]),
      ...expectToolsNotUsed(result, ["shell_exec"]),
      ...expectTextContains(result.text, ["report.pdf", "slides.pdf"]),
    ],
  },

  // ── Case 5: Local text search should use search_code, not shell grep ──
  {
    id: "search_local_text",
    description:
      "Agent should use search_code for plain-text local search, not shell_exec grep/rg",
    query:
      "Search the local text files here for the phrase 'dentist appointment' and tell me which file contains it.",
    fixtures: {
      "notes.txt": "Dentist appointment on Tuesday at 3pm.",
      "journal.md": "Morning walk and coffee.",
      "work.log": "deploy completed successfully",
    },
    toolAllowlist: [
      "search_code",
      "read_file",
      "list_files",
      "shell_exec",
      "ask_user",
    ],
    validate: (result) => [
      ...expectToolsUsed(result, ["search_code"]),
      ...expectToolsNotUsed(result, ["shell_exec"]),
      ...expectTextContains(result.text, ["notes.txt", "dentist appointment"]),
    ],
  },

  // ── Case 6: General knowledge should not invoke any tools ──
  {
    id: "general_knowledge",
    description:
      "Agent should answer from knowledge, not reach for tools on a general question",
    query: "What is the capital of Japan?",
    fixtures: {},
    toolAllowlist: [
      "read_file",
      "list_files",
      "search_web",
      "shell_exec",
      "ask_user",
    ],
    validate: (result) => [
      ...expectToolsNotUsed(result, [
        "read_file",
        "list_files",
        "search_web",
        "shell_exec",
      ]),
      ...expectTextContains(result.text, ["Tokyo"]),
    ],
  },

  // ── Case 7: File comparison should use read_file, not shell diff ──
  {
    id: "compare_files",
    description:
      "Agent should use read_file to read both files and compare, not shell diff",
    query:
      "Compare config-old.json and config-new.json and tell me what changed.",
    fixtures: {
      "config-old.json": JSON.stringify(
        { port: 3000, debug: false, name: "myapp" },
        null,
        2,
      ),
      "config-new.json": JSON.stringify(
        { port: 8080, debug: true, name: "myapp" },
        null,
        2,
      ),
    },
    toolAllowlist: [
      "read_file",
      "list_files",
      "shell_exec",
      "ask_user",
    ],
    validate: (result) => {
      const readCount = result.toolNames.filter((n) => n === "read_file")
        .length;
      const errors: string[] = [];
      if (readCount < 2) {
        errors.push(
          `Expected read_file to be called at least twice, got ${readCount}.`,
        );
      }
      errors.push(...expectToolsNotUsed(result, ["shell_exec"]));
      errors.push(
        ...expectTextContains(result.text, ["port", "debug"]),
      );
      return errors;
    },
  },

  // ── Case 8: Write a note should use write_file ──
  {
    id: "write_note",
    description:
      "Agent should use write_file to create a note, not shell echo/cat",
    query:
      "Create a file called meeting-notes.txt with the following: 'Meeting with team on Monday at 10am. Discuss Q3 roadmap.'",
    fixtures: {},
    toolAllowlist: [
      "write_file",
      "read_file",
      "list_files",
      "shell_exec",
      "ask_user",
    ],
    validate: (result) => [
      ...expectToolsUsed(result, ["write_file"]),
      ...expectToolsNotUsed(result, ["shell_exec"]),
      ...expectMinLength(result.text, 10),
    ],
  },

  // ── Case 9: Edit a note should use edit_file, not shell text munging ──
  {
    id: "edit_local_note",
    description:
      "Agent should use edit_file to update a local note in place, not shell sed/perl/python",
    query:
      "In agenda.txt, replace 'Tuesday' with 'Wednesday' and keep everything else the same.",
    fixtures: {
      "agenda.txt": "Team lunch on Tuesday.\nBring the updated slides.\n",
    },
    toolAllowlist: [
      "edit_file",
      "read_file",
      "list_files",
      "shell_exec",
      "ask_user",
    ],
    validate: (result) => [
      ...expectToolsUsed(result, ["edit_file"]),
      ...expectNoShellFor(result, [/\bsed\b/i, /\bperl\b/i, /\bpython\b/i]),
      ...expectTextContains(result.text, ["Wednesday"]),
    ],
  },

  // ── Case 10: Open a file should use open_path, not shell open ──
  {
    id: "open_file",
    description:
      "Agent should use open_path to open a file, not shell_exec 'open'",
    query:
      "There is a file called readme.md in this directory. Open it with the default application.",
    fixtures: {
      "readme.md": "# My Project\n\nThis is a project readme.",
    },
    toolAllowlist: [
      "open_path",
      "reveal_path",
      "read_file",
      "list_files",
      "shell_exec",
      "ask_user",
    ],
    validate: (result) => [
      ...expectToolsUsed(result, ["open_path"]),
      ...expectNoShellFor(result, [/^open\s/i]),
      ...expectMinLength(result.text, 5),
    ],
  },

  // ── Case 11: File metadata should use file_metadata, not shell stat ──
  {
    id: "check_file_sizes",
    description:
      "Agent should use file_metadata to check file sizes, not shell_exec stat/ls -l",
    query:
      "Which file is larger: report.pdf or backup.zip? Tell me their sizes.",
    fixtures: {
      "report.pdf": "x".repeat(5000),
      "backup.zip": "y".repeat(12000),
    },
    toolAllowlist: [
      "file_metadata",
      "list_files",
      "read_file",
      "shell_exec",
      "ask_user",
    ],
    validate: (result) => [
      ...expectToolsUsed(result, ["file_metadata"]),
      ...expectToolsNotUsed(result, ["shell_exec"]),
      ...expectTextContains(result.text, ["backup.zip"]),
      ...expectMinLength(result.text, 20),
    ],
  },

  // ── Case 12: Folder organization should use make_directory + move_path ──
  {
    id: "organize_file_into_folder",
    description:
      "Agent should create a folder and move a file into it using semantic file tools",
    query: "Create a folder called Archive here and move report.txt into it.",
    fixtures: {
      "report.txt": "quarterly report draft",
    },
    toolAllowlist: [
      "make_directory",
      "move_path",
      "list_files",
      "shell_exec",
      "ask_user",
    ],
    validate: (result) => [
      ...expectToolsUsed(result, ["make_directory", "move_path"]),
      ...expectToolsNotUsed(result, ["shell_exec"]),
      ...expectTextContains(result.text, ["Archive", "report.txt"]),
    ],
  },

  // ── Case 13: Rename should use move_path, not shell mv ──
  {
    id: "rename_file",
    description:
      "Agent should use move_path to rename a file, not shell_exec mv",
    query: "Rename draft.txt to final.txt in this folder.",
    fixtures: {
      "draft.txt": "working draft",
    },
    toolAllowlist: [
      "move_path",
      "list_files",
      "shell_exec",
      "ask_user",
    ],
    validate: (result) => [
      ...expectToolsUsed(result, ["move_path"]),
      ...expectToolsNotUsed(result, ["shell_exec"]),
      ...expectTextContains(result.text, ["final.txt"]),
    ],
  },

  // ── Case 14: Copying should use copy_path, not shell cp ──
  {
    id: "copy_file_backup",
    description:
      "Agent should duplicate a file with copy_path, not shell_exec cp",
    query:
      "Make a backup copy of notes.txt called notes-backup.txt in this folder.",
    fixtures: {
      "notes.txt": "draft notes that should stay unchanged",
    },
    toolAllowlist: [
      "copy_path",
      "list_files",
      "shell_exec",
      "ask_user",
    ],
    validate: (result) => [
      ...expectToolsUsed(result, ["copy_path"]),
      ...expectToolsNotUsed(result, ["shell_exec"]),
      ...expectTextContains(result.text, ["notes-backup.txt"]),
    ],
  },

  // ── Case 15: Directory copy should use copy_path recursively ──
  {
    id: "copy_folder_backup",
    description:
      "Agent should copy a folder tree with copy_path, not shell_exec cp -R",
    query: "Copy the folder assets to assets-backup in this workspace.",
    fixtures: {
      "assets/logo.txt": "brand asset",
      "assets/icons/icon-a.txt": "icon asset",
    },
    toolAllowlist: [
      "copy_path",
      "list_files",
      "shell_exec",
      "ask_user",
    ],
    validate: (result) => [
      ...expectToolsUsed(result, ["copy_path"]),
      ...expectNoShellFor(result, [/\bcp\b/i, /\brsync\b/i]),
      ...expectTextContains(result.text, ["assets-backup"]),
    ],
  },

  // ── Case 16: Archiving should use archive_files, not shell zip/tar ──
  {
    id: "archive_selected_files",
    description:
      "Agent should create an archive with archive_files, not shell zip/tar",
    query:
      "Create a zip archive called project-bundle.zip that contains notes.txt and report.txt.",
    fixtures: {
      "notes.txt": "meeting notes",
      "report.txt": "quarterly report",
    },
    toolAllowlist: [
      "archive_files",
      "list_files",
      "shell_exec",
      "ask_user",
    ],
    validate: (result) => [
      ...expectToolsUsed(result, ["archive_files"]),
      ...expectNoShellFor(result, [/\bzip\b/i, /\btar\b/i]),
      ...expectTextContains(result.text, ["project-bundle.zip"]),
    ],
  },

  // ── Case 17: Multi-step cleanup reasoning ──
  {
    id: "selective_cleanup",
    description:
      "Agent should list files, reason about which to keep, and trash only the right ones",
    query:
      "Look at the files here. Delete any temporary or backup files, but keep the originals.",
    fixtures: {
      "report.docx": "original report",
      "report.docx.bak": "backup of report",
      "data.csv": "original data",
      "data.csv.tmp": "temp data file",
      "notes.txt": "original notes",
      ".DS_Store": "mac metadata",
    },
    toolAllowlist: [
      "list_files",
      "read_file",
      "move_to_trash",
      "shell_exec",
      "ask_user",
    ],
    validate: (result) => {
      const errors: string[] = [];
      errors.push(
        ...expectToolsUsed(result, ["list_files", "move_to_trash"]),
      );
      errors.push(...expectToolsNotUsed(result, ["shell_exec"]));

      // Check that the agent's response mentions keeping the originals
      const text = result.text.toLowerCase();
      const mentionsOriginals = ["report.docx", "data.csv", "notes.txt"]
        .some((f) => text.includes(f));
      if (!mentionsOriginals) {
        errors.push(
          "Expected response to mention the original files that were kept.",
        );
      }
      return errors;
    },
  },
];

// ============================================================
// Test Runner
// ============================================================

const ACTIVE_CASES = CASE_FILTER
  ? CASES.filter((c) =>
    CASE_FILTER.split(",").map((s) => s.trim()).includes(c.id)
  )
  : CASES;

Deno.test({
  name:
    "E2E eval: general-purpose local agent tasks graded by tool selection and answer quality",
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
          // Set up workspace fixtures
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
            const { model, result } = await runSourceAgentWithCompatibleModel({
              models: MODEL_CANDIDATES,
              query: renderWorkspaceScopedQuery(testCase.query, workspace),
              workspace,
              signal: controller.signal,
              disablePersistentMemory: true,
              permissionMode: "bypassPermissions",
              toolAllowlist: testCase.toolAllowlist,
              maxTokens: 2_000,
              callbacks: {
                onAgentEvent: (event) => events.push(event),
              },
            });
            caseModel = model;

            const { names, args } = collectToolInfo(events);
            const semanticResult: GeneralPurposeResult = {
              text: result.text.trim(),
              toolNames: names,
              toolArgs: args,
            };

            const errors = testCase.validate(semanticResult);
            if (errors.length > 0) {
              const detail = [
                `  Case: ${testCase.id} (${testCase.description})`,
                `  Model: ${caseModel}`,
                `  Tools used: ${names.join(", ") || "(none)"}`,
                `  Response (first 200): ${result.text.slice(0, 200)}`,
                ...errors.map((err) => `  FAIL: ${err}`),
              ].join("\n");
              failures.push(detail);
            }
          } catch (error) {
            failures.push(
              `  Case: ${testCase.id} — ERROR: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }

          // Clean workspace completely between cases (remove all files/dirs)
          try {
            for await (const entry of platform.fs.readDir(workspace)) {
              await platform.fs.remove(
                `${workspace}/${entry.name}`,
                { recursive: true },
              );
            }
          } catch {
            // Best-effort cleanup only.
          }
        }
      });
    } finally {
      clearTimeout(timeout);
    }

    if (failures.length > 0) {
      const report = [
        `\n${"=".repeat(60)}`,
        `GENERAL-PURPOSE EVAL: ${failures.length}/${ACTIVE_CASES.length} cases failed`,
        `${"=".repeat(60)}`,
        ...failures,
        `${"=".repeat(60)}`,
      ].join("\n");
      console.error(report);
    }

    assertEquals(
      failures.length,
      0,
      `${failures.length}/${ACTIVE_CASES.length} general-purpose eval cases failed. See output above.`,
    );
  },
});
