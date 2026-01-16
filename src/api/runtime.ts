/**
 * Runtime API Object
 *
 * Provides access to ephemeral REPL runtime state (signals, media, metadata).
 * Designed to be registered on globalThis for shared SSOT access.
 */

export interface RuntimeState {
  getMedia?: () => readonly unknown[];
  getDocstrings?: () => ReadonlyMap<string, string>;
  getSignatures?: () => ReadonlyMap<string, string[]>;
}

let runtimeState: RuntimeState = {};
let abortSignal: AbortSignal | null = null;

export function setRuntimeState(state: RuntimeState): void {
  runtimeState = state;
}

export function setAbortSignal(signal?: AbortSignal | null): void {
  abortSignal = signal ?? null;
}

export function getAbortSignal(): AbortSignal | null {
  return abortSignal;
}

export function createRuntimeApi() {
  return {
    get abortSignal(): AbortSignal | null {
      return abortSignal;
    },
    setAbortSignal,
    get media(): readonly unknown[] {
      return runtimeState.getMedia ? runtimeState.getMedia() : [];
    },
    get docstrings(): ReadonlyMap<string, string> {
      return runtimeState.getDocstrings ? runtimeState.getDocstrings() : new Map();
    },
    get signatures(): ReadonlyMap<string, string[]> {
      return runtimeState.getSignatures ? runtimeState.getSignatures() : new Map();
    },
  };
}

export const runtime = createRuntimeApi();
