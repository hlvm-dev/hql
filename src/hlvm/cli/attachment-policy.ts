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

function describeAttachmentKind(
  kind: ConversationAttachmentKind | undefined,
  plural = false,
): string {
  switch (kind) {
    case "image":
      return plural ? "images" : "image";
    case "pdf":
      return plural ? "PDF files" : "PDF";
    case "audio":
      return plural ? "audio files" : "audio";
    case "video":
      return plural ? "video files" : "video";
    case "text":
      return plural ? "text files" : "text";
    default:
      return plural ? "attachments" : "attachment";
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

function normalizeModelId(modelName: string): string {
  const [, parsedModelName] = parseModelString(modelName);
  return parsedModelName.trim().toLowerCase();
}

function filterImageKinds(
  supportedKinds: readonly ConversationAttachmentKind[],
): readonly ConversationAttachmentKind[] {
  return supportedKinds.filter((kind) => kind !== "image");
}

function resolveExplicitAttachmentKinds(
  providerName: string | null,
  modelName: string,
  modelInfo: ModelInfo | null,
): readonly ConversationAttachmentKind[] | null {
  if (!providerName) return null;

  const normalizedModelId = normalizeModelId(modelName);
  const hasVisionCapability = modelInfo?.capabilities?.includes("vision") ===
    true;

  switch (providerName) {
    case "google":
      if (normalizedModelId.startsWith("gemini-2.5-flash")) {
        return PROVIDER_ATTACHMENT_KINDS.google;
      }
      if (normalizedModelId.startsWith("gemini")) {
        return hasVisionCapability
          ? PROVIDER_ATTACHMENT_KINDS.google
          : ["text"];
      }
      if (normalizedModelId.startsWith("gemma")) {
        return hasVisionCapability ? ["image", "text"] : ["text"];
      }
      return null;

    case "ollama":
      if (modelInfo?.capabilities) {
        return hasVisionCapability ? ["image", "text"] : ["text"];
      }
      return null;

    default:
      return null;
  }
}

export async function resolveSupportedAttachmentKindsForModel(
  modelName: string,
  modelInfo: ModelInfo | null,
): Promise<readonly ConversationAttachmentKind[]> {
  const providerName = resolveModelProviderName(modelName, modelInfo);
  const explicitKinds = resolveExplicitAttachmentKinds(
    providerName,
    modelName,
    modelInfo,
  );
  if (explicitKinds) {
    return explicitKinds;
  }

  const providerKinds = providerName
    ? PROVIDER_ATTACHMENT_KINDS[providerName] ?? DEFAULT_MODEL_ATTACHMENT_KINDS
    : DEFAULT_MODEL_ATTACHMENT_KINDS;

  if (!providerKinds.includes("image")) {
    return providerKinds;
  }

  if (modelInfo?.capabilities) {
    return modelInfo.capabilities.includes("vision")
      ? providerKinds
      : filterImageKinds(providerKinds);
  }

  if (!providerName) {
    return providerKinds;
  }

  const visionCheck = await modelSupportsVision(modelName, modelInfo);
  if (!visionCheck.supported) {
    return filterImageKinds(providerKinds);
  }

  return providerKinds;
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
  return formatList(kinds.map((k) => describeAttachmentKind(k, true)));
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
  const supportedKinds = await resolveSupportedAttachmentKindsForModel(
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

  return { supported: true, supportedKinds };
}

export async function checkModelAttachmentIds(
  modelName: string,
  attachmentIds: readonly string[],
  modelInfo: ModelInfo | null,
): Promise<AttachmentSupportCheck> {
  const supportedKinds = await resolveSupportedAttachmentKindsForModel(
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
    const supported = check.supportedKinds.map((k) => describeAttachmentKind(k)).join(
      ", ",
    );
    return `${modelName} does not support this attachment type (${kindLabel}). Supported: ${supported}.`;
  }

  if (check.unsupportedMimeType) {
    return `${modelName} does not support ${check.unsupportedMimeType} input. This model may lack vision/multimodal capabilities.`;
  }

  return `${modelName} does not support this attachment type.`;
}
