/**
 * `/memory` slash command handler.
 *
 * Text-mode subset of CC's interactive Ink picker (CC: components/memory/
 * MemoryFileSelector.tsx). The user passes one of `user|project|auto` and
 * the command opens the corresponding file in $VISUAL/$EDITOR/vi.
 *
 * Compared to CC, this drops:
 *   - The interactive Ink dialog with selectable rows
 *   - The "Open auto-memory folder" action row
 *   - File existence indicators / "(new)" labels in a list
 *   - The auto-memory toggle / auto-dream status rows
 *   - Ink pause + alternate-screen handoff during editor spawn
 *
 * Reports back "Opened memory file at <path>" on clean exit (CC parity —
 * `Memory updated in ...` is reserved for model/tool writes, not manual
 * `/memory` edits).
 */

import { getPlatform } from "../../../platform/platform.ts";
import {
  getAutoMemEntrypoint,
  getProjectMemoryPath,
  getUserMemoryPath,
} from "../../memory/paths.ts";
import { editFileInEditor, resolveEditor } from "./edit-in-editor.ts";

interface CommandContext {
  output: (...args: unknown[]) => void;
}

interface MemoryRow {
  label: string;
  path: string;
  description: string;
}

function homeRelative(path: string): string {
  const home = getPlatform().env.get("HOME") ?? "";
  if (home && path.startsWith(home + "/")) return "~" + path.slice(home.length);
  return path;
}

async function listMemoryRows(): Promise<MemoryRow[]> {
  const platform = getPlatform();
  const cwd = platform.process.cwd();
  const userPath = getUserMemoryPath();
  const projectPath = getProjectMemoryPath(cwd);
  const autoPath = getAutoMemEntrypoint(cwd);

  async function exists(p: string): Promise<boolean> {
    try {
      return await platform.fs.exists(p);
    } catch {
      return false;
    }
  }

  return [
    {
      label: "User memory",
      path: userPath,
      description: `${homeRelative(userPath)}${
        (await exists(userPath)) ? "" : " (new)"
      }`,
    },
    {
      label: "Project memory",
      path: projectPath,
      description: `${homeRelative(projectPath)}${
        (await exists(projectPath)) ? "" : " (new)"
      }`,
    },
    {
      label: "Auto-memory MEMORY.md",
      path: autoPath,
      description: `${homeRelative(autoPath)}${
        (await exists(autoPath)) ? "" : " (new)"
      }`,
    },
  ];
}

async function ensureFileExists(path: string): Promise<void> {
  const platform = getPlatform();
  if (await platform.fs.exists(path)) return;
  // Create parent dir(s) and an empty file so the editor doesn't error.
  const dir = platform.path.dirname(path);
  try {
    await platform.fs.mkdir(dir, { recursive: true });
  } catch {
    // best effort
  }
  try {
    await platform.fs.writeTextFile(path, "");
  } catch {
    // editor will surface the error
  }
}

function pickByArg(arg: string, rows: MemoryRow[]): MemoryRow | null {
  const t = arg.trim().toLowerCase();
  if (!t) return null;
  if (t === "user" || t === "u") return rows[0];
  if (t === "project" || t === "p") return rows[1];
  if (t === "auto" || t === "a" || t === "memory" || t === "m") return rows[2];
  return null;
}

export async function handleMemoryCommand(
  args: string,
  context: CommandContext,
): Promise<void> {
  const rows = await listMemoryRows();

  // No interactive picker yet — pick by arg or default to "user".
  // Usage:
  //   /memory          → user
  //   /memory user     → ~/.hlvm/HLVM.md
  //   /memory project  → ./HLVM.md
  //   /memory auto     → ~/.hlvm/projects/<key>/memory/MEMORY.md
  let chosen = pickByArg(args, rows);
  if (!chosen) {
    if (args.trim()) {
      context.output(
        `Unknown memory target: ${args.trim()}\n` +
          `Use one of: user | project | auto\n` +
          rows.map((r) => `  ${r.label}: ${r.description}`).join("\n"),
      );
      return;
    }
    chosen = rows[0]; // default to user memory
  }

  await ensureFileExists(chosen.path);
  const { editor, source } = resolveEditor();
  context.output(
    `Opening ${homeRelative(chosen.path)} in ${editor}` +
      (source !== "default" ? ` ($${source})` : ""),
  );
  const result = await editFileInEditor(chosen.path);
  if (result.exitCode === 0) {
    context.output(`Opened memory file at ${homeRelative(chosen.path)}`);
  } else {
    context.output(
      `Editor exited with code ${result.exitCode} for ${homeRelative(chosen.path)}`,
    );
  }
}
