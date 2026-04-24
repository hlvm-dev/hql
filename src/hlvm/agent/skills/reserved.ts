const RESERVED_SLASH_COMMAND_NAMES = new Set([
  "help",
  "flush",
  "exit",
  "config",
  "model",
  "tasks",
  "mcp",
  "doctor",
]);

export function isReservedSkillName(name: string): boolean {
  return RESERVED_SLASH_COMMAND_NAMES.has(name);
}
