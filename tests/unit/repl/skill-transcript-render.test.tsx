import { assertStringIncludes } from "jsr:@std/assert@1";
import React from "react";
import { render } from "ink";
import process from "node:process";
import { Writable } from "node:stream";
import { resetHlvmDirCacheForTests } from "../../../src/common/paths.ts";
import { ThemeProvider } from "../../../src/hlvm/cli/theme/index.ts";
import type { ToolCallDisplay } from "../../../src/hlvm/cli/repl-ink/types.ts";

function stripAnsi(text: string): string {
  return text
    // deno-lint-ignore no-control-regex -- ANSI stripping for terminal render output.
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    // deno-lint-ignore no-control-regex -- OSC escape stripping for terminal render output.
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\r/g, "");
}

Deno.test({
  name: "skill transcript row renders with CC-style activity shape",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const previousTestRoot = Deno.env.get("HLVM_TEST_STATE_ROOT");
    const previousAllowTestRoot = Deno.env.get("HLVM_ALLOW_TEST_STATE_ROOT");
    const testRoot = await Deno.makeTempDir({ prefix: "hlvm-skill-render-" });
    Deno.env.set("HLVM_TEST_STATE_ROOT", testRoot);
    Deno.env.set("HLVM_ALLOW_TEST_STATE_ROOT", "1");
    resetHlvmDirCacheForTests();

    try {
      const { ToolCallItem } = await import(
        "../../../src/hlvm/cli/repl-ink/components/conversation/ToolCallItem.tsx"
      );

      let output = "";
      const stdout = new Writable({
        write(chunk, _encoding, callback) {
          output += chunk.toString();
          callback();
        },
      }) as Writable & { columns: number; rows: number; isTTY: boolean };
      stdout.columns = 80;
      stdout.rows = 24;
      stdout.isTTY = false;

      const skillTool: ToolCallDisplay = {
        id: "skill-1",
        name: "skill",
        displayName: "Skill(debug-flow)",
        argsSummary: "",
        status: "success",
        resultSummaryText: "Successfully loaded skill",
        resultDetailText: "Successfully loaded skill",
        resultText: "Successfully loaded skill",
        toolIndex: 1,
        toolTotal: 1,
      };

      const instance = render(
        <ThemeProvider initialTheme="sicp">
          <ToolCallItem tool={skillTool} width={80} />
        </ThemeProvider>,
        {
          stdout: stdout as unknown as NodeJS.WriteStream,
          stdin: process.stdin,
          stderr: process.stderr,
          patchConsole: false,
          exitOnCtrlC: false,
        },
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      instance.unmount();

      const rendered = stripAnsi(output);
      assertStringIncludes(rendered, "● Skill(debug-flow)");
      assertStringIncludes(rendered, "  ⎿  Successfully loaded skill");
    } finally {
      if (previousTestRoot === undefined) {
        Deno.env.delete("HLVM_TEST_STATE_ROOT");
      } else {
        Deno.env.set("HLVM_TEST_STATE_ROOT", previousTestRoot);
      }
      if (previousAllowTestRoot === undefined) {
        Deno.env.delete("HLVM_ALLOW_TEST_STATE_ROOT");
      } else {
        Deno.env.set("HLVM_ALLOW_TEST_STATE_ROOT", previousAllowTestRoot);
      }
      resetHlvmDirCacheForTests();
      await Deno.remove(testRoot, { recursive: true });
    }
  },
});
