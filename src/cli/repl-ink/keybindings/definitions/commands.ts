/**
 * Command Keybindings - Slash commands
 * Source: commands.ts
 */

import type { Keybinding } from "../types.ts";

export const commandKeybindings: Keybinding[] = [
  {
    id: "/help",
    display: "/help",
    label: "Show help",
    description: "Display help message with all commands",
    category: "Commands",
    action: { type: "SLASH_COMMAND", cmd: "/help" },
  },
  {
    id: "/config",
    display: "/config",
    label: "Configuration panel",
    description: "Open interactive configuration settings",
    category: "Commands",
    action: { type: "SLASH_COMMAND", cmd: "/config" },
  },
  {
    id: "/clear",
    display: "/clear",
    label: "Clear screen",
    description: "Clear terminal output",
    category: "Commands",
    action: { type: "SLASH_COMMAND", cmd: "/clear" },
  },
  {
    id: "/reset",
    display: "/reset",
    label: "Reset REPL state",
    description: "Clear all bindings and memory",
    category: "Commands",
    action: { type: "SLASH_COMMAND", cmd: "/reset" },
  },
  {
    id: "/memory",
    display: "/memory",
    label: "Show memory",
    description: "Display persisted definitions",
    category: "Commands",
    action: { type: "SLASH_COMMAND", cmd: "/memory" },
  },
  {
    id: "/forget",
    display: "/forget <name>",
    label: "Forget definition",
    description: "Remove a definition from memory",
    category: "Commands",
    action: { type: "SLASH_COMMAND", cmd: "/forget " },
  },
  {
    id: "/resume",
    display: "/resume",
    label: "Resume session",
    description: "Resume a previous session",
    category: "Commands",
    action: { type: "SLASH_COMMAND", cmd: "/resume" },
  },
  {
    id: "/exit",
    display: "/exit",
    label: "Exit REPL",
    category: "Commands",
    action: { type: "SLASH_COMMAND", cmd: "/exit" },
  },
];
