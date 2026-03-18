/**
 * Unit tests for REPL slash commands
 */

import { assertEquals } from "jsr:@std/assert@1";
import { isCommand, commands } from "../../../src/hlvm/cli/repl/commands.ts";

Deno.test("isCommand - slash prefix", () => {
  assertEquals(isCommand("/help"), true);
  assertEquals(isCommand("/unknown"), true);
  assertEquals(isCommand("  /help  "), true); // With whitespace
});

Deno.test("isCommand - not a command", () => {
  assertEquals(isCommand("help"), false);
  assertEquals(isCommand("(+ 1 2)"), false);
  assertEquals(isCommand(""), false);
  assertEquals(isCommand("   "), false);
  assertEquals(isCommand(".help"), false); // Dot prefix is not a command
  assertEquals(isCommand("..spread"), false);
  assertEquals(isCommand("...rest"), false);
});

Deno.test("commands registry - has expected commands", () => {
  const expectedCommands = [
    "/help",
    "/flush",
    "/exit",
    "/config",
    "/model",
    "/status",
    "/mcp",
  ];

  for (const cmd of expectedCommands) {
    assertEquals(cmd in commands, true, `Missing command: ${cmd}`);
  }
});

Deno.test("commands registry - omits removed commands", () => {
  const removedCommands = [
    "/clear",
    "/reset",
    "/bindings",
    "/unbind",
    "/models",
    "/undo",
    "/clear-history",
    "/quickstart",
    "/warnings",
    "/new",
    "/resume",
  ];

  for (const cmd of removedCommands) {
    assertEquals(cmd in commands, false, `Unexpected command: ${cmd}`);
  }
});
