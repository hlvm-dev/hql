import type { ModelInfo } from "../providers/types.ts";
import { parseModelString } from "../providers/registry.ts";
import {
  type ConversationAttachmentKind,
  getConversationAttachmentKind,
} from "./repl/attachment.ts";
import {
  getAttachmentRecords,
  materializeConversationAttachment,
} from "../attachments/service.ts";
import {
  AttachmentServiceError,
  type ConversationAttachmentMaterializationOptions,
} from "../attachments/types.ts";
import { modelSupportsVision } from "./model-capabilities.ts";

const DEFAULT_MODEL_ATTACHMENT_KINDS: readonly ConversationAttachmentKind[] = [
  "image",
  "pdf",
  "audio",
  "video",
  "text",
];

const PROVIDER_ATTACHMENT_KINDS: Record<
  string,
  readonly ConversationAttachmentKind[]
> = {
  anthropic: ["image", "pdf", "text"],
  "claude-code": ["image", "pdf", "text"],
  google: ["image", "pdf", "audio", "video", "text"],
  ollama: ["image", "text"],
  openai: ["image", "pdf", "text"],
};

export interface AttachmentSupportCheck {
  supported: boolean;
  supportedKinds: readonly ConversationAttachmentKind[];
  unsupportedKind?: ConversationAttachmentKind;
  unsupportedMimeType?: string;
  missingAttachmentId?: string;
  catalogFailed?: boolean;
  validationError?: string;
}

function describeAttachmentKindForInput(
  kind: ConversationAttachmentKind,
): string {
  switch (kind) {
    case "image":
      return "images";
    case "pdf":
      return "PDF files";
    case "audio":
      return "audio files";
    case "video":
      return "video files";
    case "text":
      return "text files";
    default:
      return "attachments";
  }
}

function formatList(items: readonly string[]): string {
  if (items.length === 0) return "attachments";
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function resolveModelProviderName(
  modelName: string,
  modelInfo: ModelInfo | null,
): string | null {
  const [providerName] = parseModelString(modelName);
  if (providerName) return providerName;
  const metadataProvider = modelInfo?.metadata?.provider;
  return typeof metadataProvider === "string" ? metadataProvider : null;
}

export function getSupportedAttachmentKindsForModel(
  modelName: string,
  modelInfo: ModelInfo | null,
): readonly ConversationAttachmentKind[] {
  const providerName = resolveModelProviderName(modelName, modelInfo);
  return providerName
    ? PROVIDER_ATTACHMENT_KINDS[providerName] ??
      DEFAULT_MODEL_ATTACHMENT_KINDS
    : DEFAULT_MODEL_ATTACHMENT_KINDS;
}

export function describeSupportedAttachmentInputs(
  kinds: readonly ConversationAttachmentKind[] = DEFAULT_MODEL_ATTACHMENT_KINDS,
): string {
  return formatList(kinds.map(describeAttachmentKindForInput));
}

export function describeConversationAttachmentMimeTypeError(
  mimeType: string,
): string {
  return `Attachment unsupported: ${mimeType}. Supported inputs are ${describeSupportedAttachmentInputs()}.`;
}

export function getConversationMaterializationOptionsForModel(
  modelName: string,
  modelInfo: ModelInfo | null,
): ConversationAttachmentMaterializationOptions {
  const supportedKinds = getSupportedAttachmentKindsForModel(
    modelName,
    modelInfo,
  );
  const preferTextKinds: Array<Exclude<ConversationAttachmentKind, "text">> =
    [];
  if (!supportedKinds.includes("pdf") && supportedKinds.includes("text")) {
    preferTextKinds.push("pdf");
  }
  return preferTextKinds.length > 0 ? { preferTextKinds } : {};
}

export async function checkModelAttachmentMimeTypes(
  modelName: string,
  mimeTypes: readonly string[],
  modelInfo: ModelInfo | null,
): Promise<AttachmentSupportCheck> {
  const supportedKinds = getSupportedAttachmentKindsForModel(
    modelName,
    modelInfo,
  );

  for (const mimeType of mimeTypes) {
    const kind = getConversationAttachmentKind(mimeType);
    if (!kind || !supportedKinds.includes(kind)) {
      return {
        supported: false,
        supportedKinds,
        unsupportedKind: kind ?? undefined,
        unsupportedMimeType: mimeType,
      };
    }
  }

  const requiresVision = mimeTypes.some((mimeType) => {
    const kind = getConversationAttachmentKind(mimeType);
    return kind !== null && kind !== "text";
  });

  if (!requiresVision) {
    return { supported: true, supportedKinds };
  }

  const visionCheck = await modelSupportsVision(modelName, modelInfo);
  if (!visionCheck.supported) {
    return {
      supported: false,
      supportedKinds,
      catalogFailed: visionCheck.catalogFailed,
    };
  }

  return { supported: true, supportedKinds };
}

export async function checkModelAttachmentIds(
  modelName: string,
  attachmentIds: readonly string[],
  modelInfo: ModelInfo | null,
): Promise<AttachmentSupportCheck> {
  const supportedKinds = getSupportedAttachmentKindsForModel(
    modelName,
    modelInfo,
  );
  const records = await getAttachmentRecords(attachmentIds);
  if (records.length !== attachmentIds.length) {
    const knownIds = new Set(records.map((record) => record.id));
    const missingAttachmentId = attachmentIds.find((id) => !knownIds.has(id));
    return {
      supported: false,
      supportedKinds,
      missingAttachmentId,
    };
  }
  const resolvedMimeTypes: string[] = [];
  const materializationOptions = getConversationMaterializationOptionsForModel(
    modelName,
    modelInfo,
  );
  for (const record of records) {
    try {
      const materialized = await materializeConversationAttachment(
        record.id,
        materializationOptions,
      );
      resolvedMimeTypes.push(
        materialized.mode === "text" ? "text/plain" : materialized.mimeType,
      );
    } catch (error) {
      if (
        error instanceof AttachmentServiceError &&
        error.code === "unsupported_type"
      ) {
        return {
          supported: false,
          supportedKinds,
          unsupportedMimeType: record.mimeType,
          validationError: error.message,
        };
      }
      throw error;
    }
  }
  return await checkModelAttachmentMimeTypes(
    modelName,
    resolvedMimeTypes,
    modelInfo,
  );
}

/** User-facing description of why an attachment was rejected. */
export function describeAttachmentFailure(
  check: AttachmentSupportCheck,
  modelName: string,
): string {
  if (check.supported) return "";

  if (check.catalogFailed) {
    return `Could not verify if ${modelName} supports this type. Try proceeding anyway.`;
  }

  if (check.validationError) {
    return check.validationError;
  }

  if (check.missingAttachmentId) {
    return `Attachment not found: ${check.missingAttachmentId}`;
  }

  if (check.unsupportedKind) {
    const kindLabel = describeAttachmentKind(check.unsupportedKind);
    const supported = check.supportedKinds.map(describeAttachmentKind).join(
      ", ",
    );
    return `${modelName} does not support ${kindLabel} attachments. Supported: ${supported}.`;
  }

  if (check.unsupportedMimeType) {
    return `${modelName} does not support ${check.unsupportedMimeType} input. This model may lack vision/multimodal capabilities.`;
  }

  return `${modelName} does not support this attachment type.`;
}

function describeAttachmentKind(
  kind: ConversationAttachmentKind | undefined,
): string {
  switch (kind) {
    case "image":
      return "image";
    case "pdf":
      return "PDF";
    case "audio":
      return "audio";
    case "video":
      return "video";
    case "text":
      return "text";
    default:
      return "attachment";
  }
}
