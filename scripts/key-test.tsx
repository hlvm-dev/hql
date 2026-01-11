/**
 * Key Tester - Debug what keys the terminal is actually sending
 * Run with: deno run --allow-all scripts/key-test.tsx
 */
import React, { useState } from "npm:react@18";
import { render, useInput, useApp, Text, Box } from "npm:ink@5";

function KeyTester() {
  const { exit } = useApp();
  const [history, setHistory] = useState<string[]>(["Press any key to see what the terminal sends..."]);

  useInput((input, key) => {
    const parts: string[] = [];
    if (key.ctrl) parts.push("Ctrl");
    if (key.shift) parts.push("Shift");
    if (key.meta) parts.push("Meta");
    if (key.escape) parts.push("Esc");

    const charCodes = [...input].map(c => c.charCodeAt(0)).join(",");
    const keyInfo = `input="${input}" codes=[${charCodes}]`;
    const modifiers = parts.length > 0 ? parts.join("+") + " + " : "";

    // Special keys
    const specials: string[] = [];
    if (key.upArrow) specials.push("upArrow");
    if (key.downArrow) specials.push("downArrow");
    if (key.leftArrow) specials.push("leftArrow");
    if (key.rightArrow) specials.push("rightArrow");
    if (key.return) specials.push("return");
    if (key.backspace) specials.push("backspace");
    if (key.delete) specials.push("delete");
    if (key.tab) specials.push("tab");

    const specialStr = specials.length > 0 ? ` [${specials.join(", ")}]` : "";

    const newEntry = `${modifiers}${keyInfo}${specialStr}`;
    setHistory(prev => [...prev.slice(-10), newEntry]);

    if (input === "q" && !key.ctrl && !key.shift && !key.meta) {
      exit();
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">═══ Key Tester ═══</Text>
      <Text>Press keys to see what the terminal sends.</Text>
      <Text>Press 'q' alone to quit.</Text>
      <Text> </Text>
      <Text bold>Try these paredit shortcuts:</Text>
      <Text>  • Ctrl+Shift+) (should show: Ctrl+Shift + input=")")</Text>
      <Text>  • Alt+( (should show: Meta + input="(")</Text>
      <Text>  • Alt+s (should show: Meta + input="s")</Text>
      <Text> </Text>
      <Text bold color="yellow">Recent keys:</Text>
      {history.map((entry, i) => (
        <Text key={i} color={i === history.length - 1 ? "green" : "white"}>
          {i === history.length - 1 ? "→ " : "  "}{entry}
        </Text>
      ))}
    </Box>
  );
}

render(<KeyTester />);
