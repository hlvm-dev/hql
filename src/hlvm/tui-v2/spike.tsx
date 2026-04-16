/**
 * TUI v2 Spike — Validate CC's Ink fork works on Deno
 *
 * Run: deno run --allow-all src/hlvm/tui-v2/spike.tsx
 *
 * Expected: renders a bordered box with "Hello HLVM" and exits.
 * If this works, the Ink fork is viable on Deno.
 */

import React from "react";
import { renderSync } from "./ink/root.ts";
import Box from "./ink/components/Box.tsx";
import Text from "./ink/components/Text.tsx";

function App() {
  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Test 1: Basic rendering */}
      <Box borderStyle="round" paddingX={1}>
        <Text>Test 1: Hello HLVM — Ink fork spike on Deno</Text>
      </Box>

      {/* Test 2: Text wrapping — the #1 bug fix */}
      <Box borderStyle="round" paddingX={1} width={50}>
        <Text wrap="wrap">
          Test 2: This is a long text that should wrap correctly within the box
          boundary without breaking mid-word or creating spurious newlines. The
          fix is Math.min(getMaxWidth(yogaNode), output.width - x).
        </Text>
      </Box>

      {/* Test 3: CJK / Korean text — wide character handling */}
      <Box borderStyle="round" paddingX={1} width={50}>
        <Text>Test 3: 한국어 테스트 — 넓은 문자 처리 확인</Text>
      </Box>

      {/* Test 4: Nested layout */}
      <Box borderStyle="round" paddingX={1}>
        <Box marginRight={1}>
          <Text color="green">❯</Text>
        </Box>
        <Text>Test 4: Nested boxes with colors</Text>
      </Box>

      {/* Test 5: Multiple text styles */}
      <Box borderStyle="round" paddingX={1}>
        <Text bold>Bold</Text>
        <Text> | </Text>
        <Text italic>Italic</Text>
        <Text> | </Text>
        <Text color="cyan">Cyan</Text>
        <Text> | </Text>
        <Text dimColor>Dim</Text>
      </Box>
    </Box>
  );
}

const { unmount, waitUntilExit } = renderSync(<App />, {
  patchConsole: false,
});

setTimeout(() => {
  unmount();
}, 3000);

await waitUntilExit();
