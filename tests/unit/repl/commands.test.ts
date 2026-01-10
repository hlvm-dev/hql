/**
 * Unit tests for REPL slash commands
 */

import { assertEquals } from "jsr:@std/assert@1";
import { isCommand, commands } from "../../../src/cli/repl/commands.ts";

Deno.test("isCommand - slash prefix", () => {
  assertEquals(isCommand("/help"), true);
  assertEquals(isCommand("/clear"), true);
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

Deno.test("isCommand - edge cases", () => {
  assertEquals(isCommand("/"), true); // Just slash is technically a command
  assertEquals(isCommand("/ help"), true); // Slash with space
});

Deno.test("commands registry - has expected commands", () => {
  const expectedCommands = [
    "/help",
    "/clear",
    "/reset",
    "/exit",
    "/memory",
    "/forget",
    "/config",
  ];

  for (const cmd of expectedCommands) {
    assertEquals(cmd in commands, true, `Missing command: ${cmd}`);
  }
});

Deno.test("commands registry - YAGNI commands removed", () => {
  const removedCommands = ["/bindings", "/history", "/compact"];
  for (const cmd of removedCommands) {
    assertEquals(cmd in commands, false, `YAGNI command should be removed: ${cmd}`);
  }
});

Deno.test("commands registry - all have descriptions", () => {
  for (const [name, cmd] of Object.entries(commands)) {
    assertEquals(typeof cmd.description, "string", `${name} missing description`);
    assertEquals(cmd.description.length > 0, true, `${name} has empty description`);
  }
});

Deno.test("commands registry - all have handlers", () => {
  for (const [name, cmd] of Object.entries(commands)) {
    assertEquals(typeof cmd.handler, "function", `${name} missing handler`);
  }
});
