export type ModifierKey = "shift" | "command" | "control" | "option";

let prewarmed = false;

export function prewarmModifiers(): void {
  if (prewarmed || process.platform !== "darwin") {
    return;
  }
  prewarmed = true;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("modifiers-napi") as { prewarm?: () => void };
    mod.prewarm?.();
  } catch {
    // Optional native dependency. Falling back to key sequence handling is fine.
  }
}

export function isModifierPressed(modifier: ModifierKey): boolean {
  if (process.platform !== "darwin") {
    return false;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("modifiers-napi") as {
      isModifierPressed?: (name: string) => boolean;
    };
    return mod.isModifierPressed?.(modifier) ?? false;
  } catch {
    return false;
  }
}
