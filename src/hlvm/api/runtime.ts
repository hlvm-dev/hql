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

const EMPTY_STRING_MAP: ReadonlyMap<string, string> = Object.freeze(new Map());
const EMPTY_STRING_ARRAY_MAP: ReadonlyMap<string, string[]> = Object.freeze(
  new Map(),
);

function createRuntimeApi() {
  return {
    get abortSignal(): AbortSignal | null {
      return abortSignal;
    },
    setAbortSignal,
    get media(): readonly unknown[] {
      return runtimeState.getMedia ? runtimeState.getMedia() : [];
    },
    get docstrings(): ReadonlyMap<string, string> {
      return runtimeState.getDocstrings
        ? runtimeState.getDocstrings()
        : EMPTY_STRING_MAP;
    },
    get signatures(): ReadonlyMap<string, string[]> {
      return runtimeState.getSignatures
        ? runtimeState.getSignatures()
        : EMPTY_STRING_ARRAY_MAP;
    },
  };
}

export const runtime = createRuntimeApi();
