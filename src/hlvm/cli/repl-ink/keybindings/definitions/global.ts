/**
 * Global Keybindings - App-level shortcuts
 */

import type { Keybinding } from "../types.ts";
import { HandlerIds } from "../handler-registry.ts";

export const globalKeybindings: Keybinding[] = [
  {
    id: "ctrl+c",
    display: "Ctrl+C",
    label: "Clear input / Exit",
    description: "Clear the current draft, or exit when the composer is empty",
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
    label: "Push to background",
    description: "Push the current evaluation to background",
    category: "Global",
    action: { type: "HANDLER", id: HandlerIds.APP_BACKGROUND },
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
    id: "shift+down",
    display: "Shift+Down",
    label: "Cycle teammate",
    description: "Cycle through active teammates in in-process mode",
    category: "Global",
    action: { type: "HANDLER", id: HandlerIds.APP_CYCLE_TEAMMATE },
  },
  {
    id: "ctrl+j",
    display: "Ctrl+J",
    label: "Background tasks",
    description: "Open background tasks overlay",
    category: "Global",
    action: { type: "HANDLER", id: HandlerIds.APP_TASK_OVERLAY },
  },
  {
    id: "ctrl+f",
    display: "Ctrl+F",
    label: "Cancel all tasks",
    description: "Double-press within 3s to cancel all background tasks",
    category: "Global",
    action: { type: "HANDLER", id: HandlerIds.APP_KILL_ALL },
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
