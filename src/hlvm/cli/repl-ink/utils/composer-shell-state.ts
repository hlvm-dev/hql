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
    previous.hasSubmitText === next.hasSubmitText &&
    previous.queuedDraftCount === next.queuedDraftCount &&
    previous.queuePreviewRows === next.queuePreviewRows &&
    previous.submitAction === next.submitAction
  ) {
    return previous;
  }
  return {
    ...next,
    version: previous.version + 1,
  };
}
