// Compat domain: transcript normalization adapter.
//
// Purpose: AgentUIEvents from the HLVM runtime are shaped for HLVM's own
// schema. The v2 renderer expects a normalized row shape (user/assistant/
// tool/thinking/system). This adapter is the single place where runtime
// events are translated into render rows — so a CC transplant can consume
// a stable row shape without learning HLVM's event wire.
//
// STATUS: scaffold. Production normalization still lives in
// `src/hlvm/tui-v2/transcript/adaptConversationItems.ts`; move / wrap it
// here as CC message slices are transplanted.

export type TranscriptRowKind =
  | "user"
  | "assistant"
  | "tool-call"
  | "tool-result"
  | "thinking"
  | "system"
  | "attachment";

export interface TranscriptRow {
  readonly id: string;
  readonly kind: TranscriptRowKind;
  readonly content: unknown;
}

export interface TranscriptAdapter {
  normalize(event: unknown): TranscriptRow | null;
}
