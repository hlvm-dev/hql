import type { ComposerSurfaceUiState } from "../components/ComposerSurface.tsx";

export interface ComposerShellState extends ComposerSurfaceUiState {
  version: number;
}

export function advanceComposerShellState(
  previous: ComposerShellState,
  next: ComposerSurfaceUiState,
): ComposerShellState {
  if (
    previous.hasDraftInput === next.hasDraftInput &&
    previous.queuedDraftCount === next.queuedDraftCount &&
    previous.queuePreviewRows === next.queuePreviewRows
  ) {
    return previous;
  }
  return {
    ...next,
    version: previous.version + 1,
  };
}
