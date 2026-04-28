/**
 * `/memory` slash command — text-mode handler.
 *
 * Used as the non-Ink fallback path. The Ink REPL uses
 * `MemoryPickerOverlay.tsx` instead. HLVM is global-only; rows are:
 *   - User memory (~/.hlvm/HLVM.md)
 *   - Auto-memory MEMORY.md (~/.hlvm/memory/MEMORY.md)
 *
 * Reports back "Opened memory file at <path>" on clean exit. The
 * "Memory updated in ..." inline notification is reserved for model/tool
 * writes via `write_file` / `edit_file`.
 */

import { getPlatform } from "../../../platform/platform.ts";
import {
  getAutoMemEntrypoint,
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
  const userPath = getUserMemoryPath();
  const autoPath = getAutoMemEntrypoint();

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
  if (t === "auto" || t === "a" || t === "memory" || t === "m") return rows[1];
  return null;
}

export async function handleMemoryCommand(
  args: string,
  context: CommandContext,
): Promise<void> {
  const rows = await listMemoryRows();

  // Usage:
  //   /memory          → user
  //   /memory user     → ~/.hlvm/HLVM.md
  //   /memory auto     → ~/.hlvm/memory/MEMORY.md
  let chosen = pickByArg(args, rows);
  if (!chosen) {
    if (args.trim()) {
      context.output(
        `Unknown memory target: ${args.trim()}\n` +
          `Use one of: user | auto\n` +
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
