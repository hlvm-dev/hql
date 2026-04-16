// Stubs for CC's utils/* that the Ink fork imports

import { getPlatform } from "../../../platform/platform.ts";
import { isMouseClicksDisabled as donorMouseClicksDisabled } from "../utils/fullscreen.ts";

export function stopCapturingEarlyInput(): void {}

export function isEnvTruthy(val: string | undefined): boolean {
  return val === "1" || val === "true" || val === "yes";
}

export function isMouseClicksDisabled(): boolean {
  return donorMouseClicksDisabled();
}

export function getGraphemeSegmenter(): Intl.Segmenter {
  return new Intl.Segmenter(undefined, { granularity: "grapheme" });
}

export const env = new Proxy({} as Record<string, string | undefined>, {
  get(_target, prop: string) {
    try {
      return getPlatform().env.get(prop);
    } catch {
      return undefined;
    }
  },
});

export function gte(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) return true;
    if (va < vb) return false;
  }
  return true;
}

export function execFileNoThrow(
  _cmd: string,
  _args?: string[],
): { stdout: string; stderr: string; exitCode: number | null } {
  return { stdout: "", stderr: "", exitCode: 1 };
}
