/**
 * Spawn the user's terminal editor against a file path.
 *
 * Resolution order matches CC's `editFileInEditor` (utils/promptEditor.ts):
 *   $VISUAL → $EDITOR → vi
 *
 * Used by the `/memory` slash command. Must use HLVM platform shim — no
 * direct subprocess via `Deno.Command`.
 */

import { getPlatform } from "../../../platform/platform.ts";

export interface EditFileInEditorResult {
  /** Editor command that was actually invoked (e.g. "vim", "code -w"). */
  editor: string;
  /** Source of the editor choice: "VISUAL" | "EDITOR" | "default". */
  source: "VISUAL" | "EDITOR" | "default";
  /** Editor process exit code. 0 on clean exit. */
  exitCode: number;
}

const DEFAULT_EDITOR = "vi";

/** Resolve the editor command + source. Exported for the `/memory` notice. */
export function resolveEditor(): { editor: string; source: "VISUAL" | "EDITOR" | "default" } {
  const env = getPlatform().env;
  const visual = env.get("VISUAL")?.trim();
  if (visual) return { editor: visual, source: "VISUAL" };
  const editor = env.get("EDITOR")?.trim();
  if (editor) return { editor, source: "EDITOR" };
  return { editor: DEFAULT_EDITOR, source: "default" };
}

/**
 * Spawn the resolved editor against `filePath` and wait for exit.
 *
 * The editor command may include arguments (e.g. "code -w"), which we
 * split on whitespace before spawning. stdio is inherited so the editor
 * takes over the terminal.
 */
export async function editFileInEditor(
  filePath: string,
): Promise<EditFileInEditorResult> {
  const { editor, source } = resolveEditor();
  // Split editor command into argv. Simple split on whitespace —
  // matches Bash $EDITOR convention (e.g. "code -w", "emacs -nw").
  const parts = editor.split(/\s+/).filter((p) => p.length > 0);
  if (parts.length === 0) {
    return { editor, source, exitCode: 1 };
  }
  const cmd = [...parts, filePath];

  const platform = getPlatform();
  try {
    const result = await platform.command.output({
      cmd,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    return { editor, source, exitCode: result.code };
  } catch {
    return { editor, source, exitCode: 1 };
  }
}

/**
 * Editor handoff variant for Ink callers.
 *
 * IMPORTANT: this does NOT pause Ink — Ink doesn't expose a
 * pause/suspend primitive, and calling `useApp().exit()` here would
 * unmount the entire app, which in turn resolves `waitUntilExit()` in
 * `startInkRepl` and exits the HLVM process. (We learned this the hard
 * way; tests previously asserted the wrong contract.)
 *
 * The current pragmatic approach: leave Ink mounted and spawn the
 * editor with `inherit` stdio. The editor (vim/nano/etc) takes the
 * alternate screen via its own terminal control codes; on quit the
 * terminal restores Ink's prior render state. This isn't pixel-perfect
 * — Ink's render loop is still running in the background — but the
 * REPL survives the round-trip, which is what matters.
 *
 * The `app` parameter is accepted but currently unused; it's kept on
 * the signature so callers don't have to change when we eventually
 * implement a real Ink suspend (likely via custom alternate-screen
 * helpers).
 */
export async function editFileInEditorWithInkPause(
  _app: { exit: (error?: Error) => void },
  filePath: string,
): Promise<EditFileInEditorResult> {
  return await editFileInEditor(filePath);
}
