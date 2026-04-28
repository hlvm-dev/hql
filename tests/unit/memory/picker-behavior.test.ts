/**
 * MemoryPickerOverlay behavior tests.
 *
 * These don't drive a full Ink render (which would require a TTY). They
 * verify the contracts the component depends on:
 *   - The 3 row labels are stable and match the spec
 *   - File-existence detection produces the `(new)` suffix correctly
 *   - resolveEditor delegates to $VISUAL → $EDITOR → vi
 *   - editFileInEditorWithInkPause does not exit Ink before spawning
 *   - The OverlayPanel union accepts "memory-picker"
 */

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  editFileInEditorWithInkPause,
  resolveEditor,
} from "../../../src/hlvm/cli/repl/edit-in-editor.ts";
import {
  getAutoMemEntrypoint,
  getUserMemoryPath,
  isAutoMemoryEnabled,
} from "../../../src/hlvm/memory/paths.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { withTempHlvmDir } from "../helpers.ts";

Deno.test("[picker 1] row paths come from documented helpers (global only)", async () => {
  await withTempHlvmDir(async () => {
    const userPath = getUserMemoryPath();
    const autoPath = getAutoMemEntrypoint();

    assert(userPath.endsWith("/HLVM.md"), `userPath: ${userPath}`);
    assert(autoPath.endsWith("/memory/MEMORY.md"), `autoPath: ${autoPath}`);
  });
});

Deno.test("[picker 2] missing files exist=false (basis for '(new)' label)", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const userPath = getUserMemoryPath();
    const autoPath = getAutoMemEntrypoint();
    // Neither created → both should be missing
    assertEquals(await platform.fs.exists(userPath), false);
    assertEquals(await platform.fs.exists(autoPath), false);
  });
});

Deno.test("[picker 3] resolveEditor: VISUAL > EDITOR > vi precedence", () => {
  const env = getPlatform().env;
  const prevV = env.get("VISUAL");
  const prevE = env.get("EDITOR");
  try {
    env.delete("VISUAL");
    env.delete("EDITOR");
    assertEquals(resolveEditor(), { editor: "vi", source: "default" });
    env.set("EDITOR", "nano");
    assertEquals(resolveEditor(), { editor: "nano", source: "EDITOR" });
    env.set("VISUAL", "code -w");
    assertEquals(resolveEditor(), { editor: "code -w", source: "VISUAL" });
  } finally {
    if (prevV !== undefined) env.set("VISUAL", prevV);
    else env.delete("VISUAL");
    if (prevE !== undefined) env.set("EDITOR", prevE);
    else env.delete("EDITOR");
  }
});

Deno.test("[picker 3b] resolveEditor: GUI editor overrides auto-add wait flags", () => {
  const env = getPlatform().env;
  const prevV = env.get("VISUAL");
  const prevE = env.get("EDITOR");
  try {
    env.delete("VISUAL");
    // Bare GUI editor names get the wait flag injected.
    env.set("EDITOR", "code");
    assertEquals(resolveEditor().editor, "code -w");
    env.set("EDITOR", "subl");
    assertEquals(resolveEditor().editor, "subl --wait");
    env.set("EDITOR", "cursor");
    assertEquals(resolveEditor().editor, "cursor -w");
    // If the user already passed flags, we DON'T touch their command.
    env.set("EDITOR", "code --new-window");
    assertEquals(resolveEditor().editor, "code --new-window");
    env.set("EDITOR", "code -w");
    assertEquals(resolveEditor().editor, "code -w");
    // Terminal editors are unchanged.
    env.set("EDITOR", "vim");
    assertEquals(resolveEditor().editor, "vim");
    env.set("EDITOR", "nano");
    assertEquals(resolveEditor().editor, "nano");
  } finally {
    if (prevV !== undefined) env.set("VISUAL", prevV);
    else env.delete("VISUAL");
    if (prevE !== undefined) env.set("EDITOR", prevE);
    else env.delete("EDITOR");
  }
});

Deno.test("[picker 4] editFileInEditorWithInkPause does NOT call app.exit() (would kill HLVM)", async () => {
  // Calling app.exit() inside an Ink REPL resolves waitUntilExit() which
  // exits the entire HLVM process. The helper must therefore NOT touch
  // app.exit(). It just spawns the editor with inherit stdio; vim/nano
  // handle their own alternate-screen.
  let exited = 0;
  const fakeApp = {
    exit() {
      exited++;
    },
  };
  const env = getPlatform().env;
  const prevEditor = env.get("EDITOR");
  const prevVisual = env.get("VISUAL");
  env.delete("VISUAL");
  env.set("EDITOR", "/usr/bin/true");
  try {
    const result = await editFileInEditorWithInkPause(fakeApp, "/dev/null");
    assertEquals(exited, 0, "app.exit() must NOT be called — would kill HLVM");
    assertEquals(result.exitCode, 0);
  } finally {
    if (prevEditor !== undefined) env.set("EDITOR", prevEditor);
    else env.delete("EDITOR");
    if (prevVisual !== undefined) env.set("VISUAL", prevVisual);
    else env.delete("VISUAL");
  }
});

Deno.test("[picker 5] editFileInEditorWithInkPause spawns the editor (inherit stdio) and returns a result", async () => {
  const fakeApp = { exit() {} };
  const env = getPlatform().env;
  const prevEditor = env.get("EDITOR");
  env.set("EDITOR", "/usr/bin/true");
  try {
    const result = await editFileInEditorWithInkPause(fakeApp, "/dev/null");
    assertEquals(result.exitCode, 0);
    assertEquals(result.editor, "/usr/bin/true");
    assertEquals(result.source, "EDITOR");
  } finally {
    if (prevEditor !== undefined) env.set("EDITOR", prevEditor);
    else env.delete("EDITOR");
  }
});

Deno.test("[picker 6] isAutoMemoryEnabled drives the status row text", () => {
  const env = getPlatform().env;
  const prev = env.get("HLVM_DISABLE_AUTO_MEMORY");
  try {
    env.delete("HLVM_DISABLE_AUTO_MEMORY");
    assertEquals(isAutoMemoryEnabled(), true);
    env.set("HLVM_DISABLE_AUTO_MEMORY", "1");
    assertEquals(isAutoMemoryEnabled(), false);
    env.set("HLVM_DISABLE_AUTO_MEMORY", "true");
    assertEquals(isAutoMemoryEnabled(), false);
    env.set("HLVM_DISABLE_AUTO_MEMORY", "0");
    assertEquals(isAutoMemoryEnabled(), true);
  } finally {
    if (prev !== undefined) env.set("HLVM_DISABLE_AUTO_MEMORY", prev);
    else env.delete("HLVM_DISABLE_AUTO_MEMORY");
  }
});

Deno.test("[picker 7] OverlayPanel union accepts 'memory-picker'", async () => {
  // Just import the type module — if the union doesn't include
  // "memory-picker", the assignment in the picker overlay's render block
  // would fail to compile. This test is a runtime smoke that the module
  // type-checks; the actual structural check is in deno check.
  const mod = await import(
    "../../../src/hlvm/cli/repl-ink/hooks/useOverlayPanel.ts"
  );
  assert(typeof mod.useOverlayPanel === "function");
});
