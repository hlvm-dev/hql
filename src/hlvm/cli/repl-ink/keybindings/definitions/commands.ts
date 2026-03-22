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
    id: "/flush",
    display: "/flush",
    label: "Flush screen",
    description: "Clear visible screen output while keeping the current session",
    category: "Commands",
    action: { type: "SLASH_COMMAND", cmd: "/flush" },
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
    id: "/model",
    display: "/model",
    label: "Model picker",
    description: "Open model picker or set the default model",
    category: "Commands",
    action: { type: "SLASH_COMMAND", cmd: "/model" },
  },
  {
    id: "/tasks",
    display: "/tasks",
    label: "List background tasks",
    description: "Show background task status",
    category: "Commands",
    action: { type: "SLASH_COMMAND", cmd: "/tasks" },
  },
  {
    id: "/mcp",
    display: "/mcp",
    label: "MCP servers",
    description: "List configured MCP servers",
    category: "Commands",
    action: { type: "SLASH_COMMAND", cmd: "/mcp" },
  },
  {
    id: "/exit",
    display: "/exit",
    label: "Exit",
    category: "Commands",
    action: { type: "SLASH_COMMAND", cmd: "/exit" },
  },
];
