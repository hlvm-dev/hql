import {
  assert,
  assertEquals,
} from "jsr:@std/assert@1";
import React from "react";
import { Box, render, Text } from "ink";
import process from "node:process";
import { Writable } from "node:stream";
import { ThemeProvider } from "../../../src/hlvm/cli/theme/index.ts";
import { FullscreenLayout } from "../../../src/hlvm/cli/repl-ink/components/FullscreenLayout.tsx";
import type {
  ScrollBoxHandle,
  ScrollBoxSnapshot,
} from "../../../src/hlvm/cli/repl-ink/components/ScrollBox.tsx";

function makeStdout(): {
  stdout: Writable & { columns: number; rows: number; isTTY: boolean };
} {
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      void chunk;
      callback();
    },
  }) as Writable & { columns: number; rows: number; isTTY: boolean };
  stdout.columns = 48;
  stdout.rows = 10;
  stdout.isTTY = false;
  return { stdout };
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 60));
}

Deno.test({
  name: "FullscreenLayout keeps bottom chrome pinned while transcript scrolls",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const scrollRef = React.createRef<ScrollBoxHandle>();
    const snapshots: ScrollBoxSnapshot[] = [];
    const { stdout } = makeStdout();

    const instance = render(
      <ThemeProvider initialTheme="sicp">
        <Box flexDirection="column" width={48} height={10}>
          <FullscreenLayout
            scrollRef={scrollRef}
            onScrollStateChange={(snapshot) => snapshots.push(snapshot)}
            scrollable={
              <Box flexDirection="column">
                {Array.from({ length: 18 }, (_, index) => (
                  <React.Fragment key={index}>
                    <Text>row {index + 1}</Text>
                  </React.Fragment>
                ))}
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
    scrollRef.current?.scrollTo(0);
    await nextPaint();

    const topSnapshot = snapshots.at(-1);
    assert(topSnapshot, "expected ScrollBox to emit a snapshot");
    assertEquals(topSnapshot.scrollTop, 0);
    assert(
      topSnapshot.linesBelow > 0,
      `expected transcript content below viewport: ${
        JSON.stringify(topSnapshot)
      }`,
    );

    scrollRef.current?.scrollToBottom();
    await nextPaint();

    const bottomSnapshot = snapshots.at(-1);
    assert(bottomSnapshot, "expected ScrollBox to emit bottom snapshot");
    assertEquals(bottomSnapshot.linesBelow, 0);
    assertEquals(bottomSnapshot.isSticky, true);

    instance.unmount();
  },
});
