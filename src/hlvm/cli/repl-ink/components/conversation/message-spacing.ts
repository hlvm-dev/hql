export interface LiveConversationSpacing {
  pendingTurnMarginTop: number;
  userMessageMarginTop: number;
  userMessageMarginBottom: number;
  waitingIndicatorMarginBottom: number;
}

const DEFAULT_LIVE_CONVERSATION_SPACING: LiveConversationSpacing = {
  pendingTurnMarginTop: 1,
  userMessageMarginTop: 1,
  userMessageMarginBottom: 1,
  waitingIndicatorMarginBottom: 1,
};

const COMPACT_LIVE_CONVERSATION_SPACING: LiveConversationSpacing = {
  pendingTurnMarginTop: 0,
  userMessageMarginTop: 0,
  userMessageMarginBottom: 0,
  waitingIndicatorMarginBottom: 1,
};

export function getLiveConversationSpacing(
  compactSpacing: boolean,
): LiveConversationSpacing {
  return compactSpacing
    ? COMPACT_LIVE_CONVERSATION_SPACING
    : DEFAULT_LIVE_CONVERSATION_SPACING;
}
