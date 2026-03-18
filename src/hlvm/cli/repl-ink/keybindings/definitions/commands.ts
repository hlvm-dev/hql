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
    id: "/status",
    display: "/status",
    label: "Show status",
    description: "Display AI/model/startup status",
    category: "Commands",
    action: { type: "SLASH_COMMAND", cmd: "/status" },
  },
  {
    id: "/tasks",
    display: "/tasks",
    label: "Background tasks",
    description: "Open the background task manager",
    category: "Commands",
    action: { type: "SLASH_COMMAND", cmd: "/tasks" },
  },
  {
    id: "/bg",
    display: "/bg",
    label: "Background current task",
    description: "Push the active evaluation into the background",
    category: "Commands",
    action: { type: "SLASH_COMMAND", cmd: "/bg" },
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
