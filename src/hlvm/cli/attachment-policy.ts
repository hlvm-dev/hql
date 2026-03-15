import type { ModelInfo } from "../providers/types.ts";
import { parseModelString } from "../providers/registry.ts";
import {
  type ConversationAttachmentKind,
  getConversationAttachmentKind,
  getConversationAttachmentMimeType,
} from "./repl/attachment.ts";
import { modelSupportsVision } from "./model-capabilities.ts";

const DEFAULT_MODEL_ATTACHMENT_KINDS: readonly ConversationAttachmentKind[] = [
  "image",
  "pdf",
  "audio",
  "video",
];

const PROVIDER_ATTACHMENT_KINDS: Record<
  string,
  readonly ConversationAttachmentKind[]
> = {
  anthropic: ["image", "pdf"],
  "claude-code": ["image", "pdf"],
  google: ["image", "pdf", "audio", "video"],
  openai: ["image", "pdf"],
};

export interface AttachmentSupportCheck {
  supported: boolean;
  supportedKinds: readonly ConversationAttachmentKind[];
  unsupportedKind?: ConversationAttachmentKind;
  unsupportedMimeType?: string;
  catalogFailed?: boolean;
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

export async function checkModelAttachmentPaths(
  modelName: string,
  attachmentPaths: readonly string[],
  modelInfo: ModelInfo | null,
): Promise<AttachmentSupportCheck> {
  return await checkModelAttachmentMimeTypes(
    modelName,
    attachmentPaths.map(getConversationAttachmentMimeType),
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
