#!/usr/bin/env -S deno run --allow-all
/**
 * Debug what keys your terminal actually sends
 * Run: deno run --allow-all scripts/debug-keys.ts
 * Or:  ./scripts/debug-keys.ts
 */

import React, { useState } from "npm:react@18";
import { render, useInput, useApp, Text, Box } from "npm:ink@5";

function KeyDebugger() {
  const { exit } = useApp();
  const [log, setLog] = useState<string[]>([
    "Press keys to see what the terminal sends...",
    "Press 'Q' (uppercase) to quit",
    "",
  ]);

  useInput((input, key) => {
    // Build detailed key info
    const mods: string[] = [];
    if (key.ctrl) mods.push("ctrl");
    if (key.shift) mods.push("shift");
    if (key.meta) mods.push("meta");
    if (key.escape) mods.push("escape");

    const charCodes = [...input].map(c => c.charCodeAt(0));
    const charCodeStr = charCodes.length > 0 ? charCodes.join(",") : "none";

    const specials: string[] = [];
    if (key.upArrow) specials.push("↑");
    if (key.downArrow) specials.push("↓");
    if (key.leftArrow) specials.push("←");
    if (key.rightArrow) specials.push("→");
    if (key.return) specials.push("⏎");
    if (key.backspace) specials.push("⌫");
    if (key.delete) specials.push("⌦");
    if (key.tab) specials.push("⇥");

    const modStr = mods.length > 0 ? `[${mods.join("+")}] ` : "";
    const specialStr = specials.length > 0 ? ` special=[${specials.join("")}]` : "";
    const inputDisplay = input.length > 0 ? `"${input}"` : '""';

    const entry = `${modStr}input=${inputDisplay} codes=[${charCodeStr}]${specialStr}`;

    setLog(prev => [...prev.slice(-15), entry]);

    // Exit on uppercase Q
    if (input === "Q") {
      exit();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">╔══════════════════════════════════════════════════════════╗</Text>
      <Text bold color="cyan">║              KEY DEBUG - What does your terminal send?    ║</Text>
      <Text bold color="cyan">╚══════════════════════════════════════════════════════════╝</Text>
      <Text> </Text>
      <Text bold>Try these paredit shortcuts and see what appears:</Text>
      <Text color="yellow">  • Ctrl+]  → should show: [ctrl] input="]" or codes=[29]</Text>
      <Text color="yellow">  • Ctrl+.  → should show: [ctrl] input="."</Text>
      <Text color="yellow">  • ESC then s → should show: [escape] then input="s"</Text>
      <Text color="yellow">  • Alt+s   → should show: [meta] input="s"</Text>
      <Text> </Text>
      <Text bold color="green">Key Log:</Text>
      {log.map((entry, i) => (
        <Text key={i} color={i === log.length - 1 ? "white" : "gray"}>
          {entry}
        </Text>
      ))}
    </Box>
  );
}

render(<KeyDebugger />);
