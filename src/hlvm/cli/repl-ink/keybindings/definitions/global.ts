/**
 * Global Keybindings - App-level shortcuts
 */

import type { Keybinding } from "../types.ts";
import { HandlerIds } from "../handler-registry.ts";

export const globalKeybindings: Keybinding[] = [
  {
    id: "ctrl+c",
    display: "Ctrl+C",
    label: "Exit",
    category: "Global",
    action: { type: "HANDLER", id: HandlerIds.APP_EXIT },
  },
  {
    id: "ctrl+l",
    display: "Ctrl+L",
    label: "Clear screen",
    category: "Global",
    action: { type: "HANDLER", id: HandlerIds.APP_CLEAR },
  },
  {
    id: "cmd+k",
    display: "Cmd+K",
    label: "Clear screen",
    description:
      "Clear the app surface and start fresh when the terminal forwards Cmd+K",
    category: "Global",
    action: { type: "HANDLER", id: HandlerIds.APP_CLEAR },
  },
  {
    id: "ctrl+p",
    display: "Ctrl+P",
    label: "Command palette",
    description: "Open searchable command palette",
    category: "Global",
    action: { type: "HANDLER", id: HandlerIds.APP_PALETTE },
  },
  {
    id: "ctrl+b",
    display: "Ctrl+B",
    label: "Background tasks",
    description: "Open background tasks overlay",
    category: "Global",
    action: { type: "HANDLER", id: HandlerIds.APP_TASKS },
  },
  {
    id: "ctrl+t",
    display: "Ctrl+T",
    label: "Team dashboard",
    description: "Open team dashboard overlay",
    category: "Global",
    action: { type: "HANDLER", id: HandlerIds.APP_TEAM_DASHBOARD },
  },
  {
    id: "esc-global",
    display: "Esc",
    label: "Cancel or close",
    description: "Cancel the running agent or close the current overlay",
    category: "Global",
    action: { type: "INFO" },
  },
];
