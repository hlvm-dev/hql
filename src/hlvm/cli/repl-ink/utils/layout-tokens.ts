export const SHELL_LAYOUT = Object.freeze({
  contentMinWidth: 20,
  gutterX: 2,
  bannerTopGap: 1,
  bannerBottomGap: 1,
  transcriptToComposerGap: 2,
  composerToFooterGap: 0,
});

export const TRANSCRIPT_LAYOUT = Object.freeze({
  assistantBulletWidth: 2,
  detailIndent: 2,
  pickerDetailIndent: 5,
  dividerMarginTop: 1,
  dividerMarginBottom: 0,
  dividerChar: "─",
});

export interface LiveConversationSpacing {
  pendingTurnMarginTop: number;
  userMessageMarginTop: number;
  userMessageMarginBottom: number;
  assistantMessageMarginBottom: number;
  waitingIndicatorMarginBottom: number;
}

const LIVE_TRANSCRIPT_SPACING: LiveConversationSpacing = Object.freeze({
  pendingTurnMarginTop: 0,
  userMessageMarginTop: 0,
  userMessageMarginBottom: 1,
  assistantMessageMarginBottom: 1,
  waitingIndicatorMarginBottom: 1,
});

export function getShellContentWidth(terminalWidth: number): number {
  return Math.max(
    SHELL_LAYOUT.contentMinWidth,
    terminalWidth - (SHELL_LAYOUT.gutterX * 2),
  );
}

export function getLiveConversationSpacing(
  _compactSpacing?: boolean,
): LiveConversationSpacing {
  return LIVE_TRANSCRIPT_SPACING;
}

export function shouldRenderTranscriptDividerBeforeIndex(
  items: ReadonlyArray<{ type: string }>,
  index: number,
  showLeadingDivider = false,
): boolean {
  const item = items[index];
  if (!item || (item.type !== "user" && item.type !== "hql_eval")) {
    return false;
  }
  return index > 0 || showLeadingDivider;
}

export function buildTranscriptDivider(width: number): string {
  return TRANSCRIPT_LAYOUT.dividerChar.repeat(Math.max(1, width));
}
