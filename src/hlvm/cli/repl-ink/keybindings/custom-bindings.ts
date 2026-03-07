import type { KeybindingsConfig } from "../../../../common/config/types.ts";

let customBindingsSnapshot: KeybindingsConfig = {};

export function getCustomKeybindingsSnapshot(): KeybindingsConfig {
  return { ...customBindingsSnapshot };
}

export function setCustomKeybindingsSnapshot(
  bindings: KeybindingsConfig | undefined,
): void {
  customBindingsSnapshot = { ...(bindings ?? {}) };
}
