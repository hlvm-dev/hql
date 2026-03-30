import type {
  ConversationAttachmentKind,
  ConversationAttachmentPayload,
} from "../attachments/types.ts";

export type VisionEligibleAttachmentKind = "image" | "pdf";
export type AudioEligibleAttachmentKind = "audio";

export interface ExecutionTurnContext {
  attachmentCount: number;
  attachmentKinds: ConversationAttachmentKind[];
  visionEligibleAttachmentCount: number;
  visionEligibleKinds: VisionEligibleAttachmentKind[];
  audioEligibleAttachmentCount: number;
  audioEligibleKinds: AudioEligibleAttachmentKind[];
}

export const EMPTY_EXECUTION_TURN_CONTEXT: ExecutionTurnContext = {
  attachmentCount: 0,
  attachmentKinds: [],
  visionEligibleAttachmentCount: 0,
  visionEligibleKinds: [],
  audioEligibleAttachmentCount: 0,
  audioEligibleKinds: [],
};

function isConversationAttachmentKind(
  value: unknown,
): value is ConversationAttachmentKind {
  return value === "image" ||
    value === "audio" ||
    value === "video" ||
    value === "pdf" ||
    value === "text";
}

function isVisionEligibleAttachmentKind(
  value: unknown,
): value is VisionEligibleAttachmentKind {
  return value === "image" || value === "pdf";
}

function isAudioEligibleAttachmentKind(
  value: unknown,
): value is AudioEligibleAttachmentKind {
  return value === "audio";
}

function uniqueSortedKinds<T extends string>(items: readonly T[]): T[] {
  return [...new Set(items)].sort();
}

export function deriveExecutionTurnContextFromAttachments(
  attachments: readonly ConversationAttachmentPayload[] | undefined,
): ExecutionTurnContext {
  if (!attachments?.length) {
    return { ...EMPTY_EXECUTION_TURN_CONTEXT };
  }

  const attachmentKinds = uniqueSortedKinds(
    attachments.map((attachment) => attachment.conversationKind),
  );
  const visionEligibleKinds = uniqueSortedKinds(
    attachments.flatMap((attachment) =>
      attachment.mode === "binary" &&
          (attachment.conversationKind === "image" ||
            attachment.conversationKind === "pdf")
        ? [attachment.conversationKind]
        : []
    ),
  );
  const visionEligibleAttachmentCount = attachments.filter((attachment) =>
    attachment.mode === "binary" &&
    (
      attachment.conversationKind === "image" ||
      attachment.conversationKind === "pdf"
    )
  ).length;
  const audioEligibleKinds = uniqueSortedKinds(
    attachments.flatMap((attachment) =>
      attachment.mode === "binary" && attachment.conversationKind === "audio"
        ? [attachment.conversationKind as AudioEligibleAttachmentKind]
        : []
    ),
  );
  const audioEligibleAttachmentCount = attachments.filter((attachment) =>
    attachment.mode === "binary" && attachment.conversationKind === "audio"
  ).length;

  return {
    attachmentCount: attachments.length,
    attachmentKinds,
    visionEligibleAttachmentCount,
    visionEligibleKinds,
    audioEligibleAttachmentCount,
    audioEligibleKinds,
  };
}

export function normalizeExecutionTurnContext(
  value: unknown,
): ExecutionTurnContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...EMPTY_EXECUTION_TURN_CONTEXT };
  }

  const record = value as Record<string, unknown>;
  const attachmentKinds = Array.isArray(record.attachmentKinds)
    ? uniqueSortedKinds(
      record.attachmentKinds.filter(isConversationAttachmentKind),
    )
    : [];
  const visionEligibleKinds = Array.isArray(record.visionEligibleKinds)
    ? uniqueSortedKinds(
      record.visionEligibleKinds.filter(isVisionEligibleAttachmentKind),
    )
    : [];
  const attachmentCount = typeof record.attachmentCount === "number" &&
      Number.isFinite(record.attachmentCount) &&
      record.attachmentCount >= 0
    ? Math.trunc(record.attachmentCount)
    : attachmentKinds.length;
  const visionEligibleAttachmentCount =
    typeof record.visionEligibleAttachmentCount === "number" &&
        Number.isFinite(record.visionEligibleAttachmentCount) &&
        record.visionEligibleAttachmentCount >= 0
      ? Math.trunc(record.visionEligibleAttachmentCount)
      : visionEligibleKinds.length;
  const audioEligibleKinds = Array.isArray(record.audioEligibleKinds)
    ? uniqueSortedKinds(
      record.audioEligibleKinds.filter(isAudioEligibleAttachmentKind),
    )
    : [];
  const audioEligibleAttachmentCount =
    typeof record.audioEligibleAttachmentCount === "number" &&
        Number.isFinite(record.audioEligibleAttachmentCount) &&
        record.audioEligibleAttachmentCount >= 0
      ? Math.trunc(record.audioEligibleAttachmentCount)
      : audioEligibleKinds.length;

  return {
    attachmentCount,
    attachmentKinds,
    visionEligibleAttachmentCount,
    visionEligibleKinds,
    audioEligibleAttachmentCount,
    audioEligibleKinds,
  };
}

export function summarizeExecutionTurnContext(
  context: ExecutionTurnContext | undefined,
): string {
  if (!context || context.attachmentCount === 0) {
    return "no attachments on the last auto turn";
  }

  const attachmentKinds = context.attachmentKinds.length > 0
    ? context.attachmentKinds.join(", ")
    : "unknown";
  const visionKinds = context.visionEligibleKinds.length > 0
    ? context.visionEligibleKinds.join(", ")
    : "none";

  const audioKinds = context.audioEligibleKinds.length > 0
    ? context.audioEligibleKinds.join(", ")
    : "none";

  return `${context.attachmentCount} attachment(s) · kinds=${attachmentKinds} · vision-eligible=${context.visionEligibleAttachmentCount} (${visionKinds}) · audio-eligible=${context.audioEligibleAttachmentCount} (${audioKinds})`;
}

export function hasVisionRelevantTurnContext(
  context: ExecutionTurnContext | undefined,
): boolean {
  return (context?.attachmentCount ?? 0) > 0;
}

export function hasAudioRelevantTurnContext(
  context: ExecutionTurnContext | undefined,
): boolean {
  return (context?.audioEligibleAttachmentCount ?? 0) > 0;
}
