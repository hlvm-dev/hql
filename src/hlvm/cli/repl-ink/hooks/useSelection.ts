// Stock ink@7 does not expose renderer-owned mouse selection. HLVM leaves
// text selection to the terminal, so the app has no selection state to report.

export function useHasSelection(): boolean {
  return false;
}
