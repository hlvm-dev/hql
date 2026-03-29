export const COMPLETION_PANEL_MIN_WIDTH = 24;
export const COMPLETION_PANEL_MAX_WIDTH = 64;
export const COMPLETION_PANEL_CHROME_WIDTH = 4;

export interface CompletionPanelLayout {
  marginLeft: number;
  maxWidth: number;
}

export function measureCompletionPanelWidth(
  {
    rowWidths,
    helpText,
    previewLines = [],
    maxWidth,
  }: {
    rowWidths: readonly number[];
    helpText?: string;
    previewLines?: readonly string[];
    maxWidth?: number;
  },
): number {
  const widthLimit = Math.max(
    1,
    Math.min(
      maxWidth ?? COMPLETION_PANEL_MAX_WIDTH,
      COMPLETION_PANEL_MAX_WIDTH,
    ),
  );
  const preferredInnerWidth = Math.max(
    0,
    helpText?.length ?? 0,
    ...previewLines.map((line: string) => line.length),
    ...rowWidths,
  );
  const preferredPanelWidth = preferredInnerWidth +
    COMPLETION_PANEL_CHROME_WIDTH;

  if (widthLimit <= COMPLETION_PANEL_MIN_WIDTH) {
    return widthLimit;
  }

  return Math.max(
    COMPLETION_PANEL_MIN_WIDTH,
    Math.min(preferredPanelWidth, widthLimit),
  );
}

export function resolveCompletionPanelLayout(
  {
    terminalWidth,
    promptPrefixWidth,
    anchorColumn,
  }: {
    terminalWidth: number;
    promptPrefixWidth: number;
    anchorColumn: number;
  },
): CompletionPanelLayout {
  const safeTerminalWidth = Math.max(1, terminalWidth);
  const minimumPanelWidth = Math.min(
    COMPLETION_PANEL_MIN_WIDTH,
    safeTerminalWidth,
  );
  const marginLeft = Math.max(
    0,
    Math.min(
      promptPrefixWidth + anchorColumn,
      Math.max(0, safeTerminalWidth - minimumPanelWidth),
    ),
  );

  return {
    marginLeft,
    maxWidth: Math.max(1, safeTerminalWidth - marginLeft),
  };
}
