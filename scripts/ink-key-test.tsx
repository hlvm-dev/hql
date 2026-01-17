#!/usr/bin/env -S deno run --allow-all
/**
 * Test what Ink's useInput actually receives
 * This matches exactly how Input.tsx gets key events
 */
import React, { useState } from "npm:react@18";
import { render, useInput, useApp, Text, Box } from "npm:ink@5";

function InkKeyTest() {
  const { exit } = useApp();
  const [log, setLog] = useState<string[]>([
    "Testing Ink's useInput - this is exactly how the REPL sees keys",
    "Press 'Q' (uppercase) to quit",
    "─".repeat(60),
  ]);

  useInput((input, key) => {
    const parts: string[] = [];

    // Log all modifier flags
    if (key.ctrl) parts.push("ctrl");
    if (key.shift) parts.push("shift");
    if (key.meta) parts.push("meta");
    if (key.escape) parts.push("escape");
    if (key.upArrow) parts.push("↑");
    if (key.downArrow) parts.push("↓");
    if (key.leftArrow) parts.push("←");
    if (key.rightArrow) parts.push("→");
    if (key.return) parts.push("return");
    if (key.backspace) parts.push("backspace");
    if (key.tab) parts.push("tab");
    if (key.delete) parts.push("delete");

    // Get char codes
    const codes = [...input].map(c => c.charCodeAt(0));

    // Build display
    const modStr = parts.length > 0 ? `[${parts.join("+")}]` : "[no mods]";
    const inputStr = input.length > 0
      // deno-lint-ignore no-control-regex
      ? `input="${input.replace(/[\x00-\x1f]/g, c => `\\x${c.charCodeAt(0).toString(16).padStart(2,'0')}`)}"`
      : 'input=""';
    const codeStr = codes.length > 0 ? `codes=[${codes.join(",")}]` : "codes=[]";

    const entry = `${modStr} ${inputStr} ${codeStr}`;
    setLog(prev => [...prev.slice(-12), entry]);

    if (input === "Q") exit();
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">═══ INK useInput TEST ═══</Text>
      <Text> </Text>
      <Text bold>Test these paredit shortcuts:</Text>
      <Text color="yellow">  Ctrl+]  → Need: codes=[29] or ctrl + "]"</Text>
      <Text color="yellow">  Ctrl+\  → Need: codes=[28] or ctrl + "\"</Text>
      <Text color="yellow">  ESC     → Need: [escape] flag</Text>
      <Text color="yellow">  Alt+s   → Need: [meta] + "s"</Text>
      <Text> </Text>
      <Text bold color="green">What Ink receives:</Text>
      {log.map((entry, i) => (
        <Text key={i} color={i === log.length - 1 ? "white" : "gray"}>
          {i === log.length - 1 ? "→ " : "  "}{entry}
        </Text>
      ))}
    </Box>
  );
}

render(<InkKeyTest />);
