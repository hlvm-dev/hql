import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import React from "react";
import { Box, render, Text } from "ink";
import process from "node:process";
import { Writable } from "node:stream";
import { ThemeProvider } from "../../../src/hlvm/cli/theme/index.ts";
import { FullscreenLayout } from "../../../src/hlvm/cli/repl-ink/components/FullscreenLayout.tsx";
import { REPL_RENDER_OPTIONS } from "../../../src/hlvm/cli/repl-ink/render-options.ts";

function stripAnsi(text: string): string {
  return text
    // deno-lint-ignore no-control-regex -- ANSI stripping for terminal render output.
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    // deno-lint-ignore no-control-regex -- OSC escape stripping for terminal render output.
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\r/g, "");
}

function makeStdout(): {
  stdout: Writable & { columns: number; rows: number; isTTY: boolean };
  readOutput: () => string;
} {
  let output = "";
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  }) as Writable & { columns: number; rows: number; isTTY: boolean };
  stdout.columns = 48;
  stdout.rows = 10;
  stdout.isTTY = false;
  return { stdout, readOutput: () => output };
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 60));
}

Deno.test("REPL render options keep the terminal scrollback native", () => {
  assertEquals(REPL_RENDER_OPTIONS.alternateScreen, false);
  assertEquals(REPL_RENDER_OPTIONS.exitOnCtrlC, false);
});

Deno.test({
  name:
    "FullscreenLayout writes overflowing transcript content into normal scrollback",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { stdout, readOutput } = makeStdout();

    const instance = render(
      <ThemeProvider initialTheme="sicp">
        <Box flexDirection="column" width={48}>
          <FullscreenLayout
            scrollable={
              <Box flexDirection="column">
                {Array.from(
                  { length: 18 },
                  (_, index) => (
                    <React.Fragment key={index}>
                      <Text>row {index + 1}</Text>
                    </React.Fragment>
                  ),
                )}
              </Box>
            }
            bottom={
              <Box flexDirection="column">
                <Text>PROMPT-PINNED</Text>
                <Text>STATUS-PINNED</Text>
              </Box>
            }
          />
        </Box>
      </ThemeProvider>,
      {
        stdout: stdout as unknown as NodeJS.WriteStream,
        stdin: process.stdin,
        stderr: process.stderr,
        patchConsole: false,
        exitOnCtrlC: false,
      },
    );

    await nextPaint();
    instance.unmount();

    const rendered = stripAnsi(readOutput());
    assertStringIncludes(rendered, "row 1");
    assertStringIncludes(rendered, "row 18");
    assertStringIncludes(rendered, "PROMPT-PINNED");
    assertStringIncludes(rendered, "STATUS-PINNED");
  },
});
