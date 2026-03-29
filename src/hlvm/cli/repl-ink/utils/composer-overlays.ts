export type ActiveComposerSurface =
  | "history"
  | "placeholder"
  | "completion"
  | "none";

export interface ResolveActiveComposerSurfaceOptions {
  hasCompletion: boolean;
  hasPlaceholderMode: boolean;
  isHistorySearching: boolean;
}

export function resolveActiveComposerSurface({
  hasCompletion,
  hasPlaceholderMode,
  isHistorySearching,
}: ResolveActiveComposerSurfaceOptions): ActiveComposerSurface {
  if (isHistorySearching) {
    return "history";
  }
  if (hasPlaceholderMode) {
    return "placeholder";
  }
  if (hasCompletion) {
    return "completion";
  }
  return "none";
}

export function canOpenComposerSurface(
  activeSurface: ActiveComposerSurface,
  nextSurface: Exclude<ActiveComposerSurface, "none">,
): boolean {
  return activeSurface === "none" || activeSurface === nextSurface;
}
