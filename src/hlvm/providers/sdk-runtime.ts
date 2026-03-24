/**
 * Provider SDK Runtime
 *
 * Shared AI SDK-backed runtime for provider text generation/chat/tool-calling.
 * This replaces provider-specific wire-format/SSE plumbing while keeping the
 * existing AIProvider interface and globalThis.ai contract unchanged.
 */

import { decodeBase64 } from "@std/encoding/base64";
import { generateText, jsonSchema, Output, streamText, tool } from "ai";
import type { LanguageModel, ModelMessage, ToolCallPart, ToolSet } from "ai";
import type {
  ChatOptions,
  ChatStructuredResponse,
  GenerateOptions,
  Message,
  ProviderToolCall,
  ToolDefinition,
} from "./types.ts";
import type { ConversationAttachmentPayload } from "../attachments/types.ts";
import { appendAttachmentPipelineTrace } from "../attachments/service.ts";
import { normalizeToolArgs } from "../agent/validation.ts";
import { generateToolCallId } from "../agent/tool-call.ts";
import { getPlatform } from "../../platform/platform.ts";
import { RuntimeError, ValidationError } from "../../common/error.ts";
import { getErrorMessage, isObjectValue } from "../../common/utils.ts";
import {
  classifyProviderErrorCode,
  formatProviderFailureMessage,
} from "./common.ts";
import {
  isProviderErrorCode as isProviderErrorFromDomain,
  ProviderErrorCode,
} from "../../common/error-codes.ts";
import {
  createNativeProviderTools,
  getNativeProviderCapabilityAvailability,
} from "./native-web-tools.ts";
import {
  EMPTY_NATIVE_PROVIDER_CAPABILITY_AVAILABILITY,
  type NativeProviderCapabilityAvailability,
} from "../agent/tool-capabilities.ts";

export type SdkProviderName =
  | "openai"
  | "anthropic"
  | "google"
  | "claude-code"
  | "ollama";

export interface SdkModelSpec {
  providerName: SdkProviderName;
  modelId: string;
  endpoint?: string;
  apiKey?: string;
}

export interface SdkProviderBundle {
  model: LanguageModel;
  nativeTools: ToolSet;
}

const SUPPORTED_SDK_PROVIDERS = new Set<SdkProviderName>([
  "openai",
  "anthropic",
  "google",
  "claude-code",
  "ollama",
]);

const REQUIRED_API_KEY_ENV_VARS: Partial<Record<SdkProviderName, string>> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_API_KEY",
};

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function withApiPathSuffix(
  endpoint: string | undefined,
  suffix: string,
): string | undefined {
  const base = toNonEmptyString(endpoint);
  if (!base) return undefined;
  const normalized = base.replace(/\/+$/, "");
  return normalized.endsWith(suffix) ? normalized : `${normalized}${suffix}`;
}

function getRequiredApiKey(
  providerName: SdkProviderName,
  explicitApiKey?: string,
): string {
  const configured = toNonEmptyString(explicitApiKey);
  if (configured) return configured;

  const envVar = REQUIRED_API_KEY_ENV_VARS[providerName];
  if (!envVar) return "";

  const envApiKey = toNonEmptyString(getPlatform().env.get(envVar));
  if (envApiKey) return envApiKey;

  throw new ValidationError(
    `${envVar} is not set. Export it to use ${providerName}/ models.`,
    "provider_sdk_runtime",
  );
}

export function assertSupportedSdkProvider(
  providerName: string,
): SdkProviderName {
  const normalized = providerName.toLowerCase() as SdkProviderName;
  if (SUPPORTED_SDK_PROVIDERS.has(normalized)) {
    return normalized;
  }
  const supported = [...SUPPORTED_SDK_PROVIDERS].join(", ");
  throw new ValidationError(
    `Unsupported SDK provider '${providerName}'. Supported providers: ${supported}`,
    "provider_sdk_runtime",
  );
}

function extractStatusCode(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  const direct = record.statusCode ?? record.status ?? record.status_code;
  if (typeof direct === "number") return direct;
  const nestedResponse = record.response;
  if (nestedResponse && typeof nestedResponse === "object") {
    const nested = nestedResponse as Record<string, unknown>;
    if (typeof nested.status === "number") return nested.status;
    if (typeof nested.statusCode === "number") return nested.statusCode;
  }
  return null;
}

function extractResponseBodyText(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as Record<string, unknown>;
  const body = record.responseBody ?? record.body ??
    (isObjectValue(record.response)
      ? (record.response as Record<string, unknown>).body
      : undefined);

  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) {
    return new TextDecoder().decode(body);
  }
  if (body instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(body));
  }
  if (ArrayBuffer.isView(body)) {
    return new TextDecoder().decode(
      new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
    );
  }
  if (isObjectValue(body)) {
    try {
      return JSON.stringify(body);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function isNetworkFailure(message: string, error?: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") {
    return false;
  }
  return message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("dns") ||
    message.includes("econn") ||
    message.includes("enotfound") ||
    message.includes("econnreset") ||
    message.includes("fetch failed");
}

function classifyProviderError(
  error: unknown,
  providerName: string,
): ProviderErrorCode {
  if (
    error instanceof RuntimeError && error.code &&
    isProviderErrorFromDomain(error.code)
  ) {
    return error.code;
  }

  const status = extractStatusCode(error);
  const message = getErrorMessage(error);
  const lowerMessage = message.toLowerCase();

  if (isNetworkFailure(lowerMessage, error)) {
    return ProviderErrorCode.NETWORK_ERROR;
  }

  if (
    lowerMessage.includes("invalid json") ||
    lowerMessage.includes("unexpected token")
  ) {
    return ProviderErrorCode.STREAM_ERROR;
  }

  if (lowerMessage.includes("no output generated")) {
    return ProviderErrorCode.REQUEST_FAILED;
  }

  if (
    providerName === "claude-code" &&
    lowerMessage.includes("invalid tool") &&
    lowerMessage.includes("not supported")
  ) {
    return ProviderErrorCode.REQUEST_REJECTED;
  }

  const httpStatus = status ?? 0;
  return classifyProviderErrorCode(httpStatus, message);
}

function wrapProviderSdkError(
  error: unknown,
  providerName: string,
): never {
  const code = classifyProviderError(error, providerName);
  const message = formatProviderFailureMessage({
    providerName,
    code,
    status: extractStatusCode(error),
    responseBody: extractResponseBodyText(error),
    fallbackMessage: getErrorMessage(error),
  });
  throw new RuntimeError(
    message,
    {
      code,
      originalError: error instanceof Error ? error : undefined,
    },
  );
}

export async function maybeHandleSdkAuthError(
  providerName: SdkProviderName,
  error: unknown,
): Promise<void> {
  if (providerName !== "claude-code") return;
  const status = extractStatusCode(error);
  const message = getErrorMessage(error);
  const responseBody = extractResponseBodyText(error);

  // Token invalid / expired → clear cache so next attempt re-reads keychain
  if (status === 401 || status === 403) {
    const { clearTokenCache } = await import("./claude-code/auth.ts");
    clearTokenCache();
    return;
  }

  // Anthropic returns 400 with a generic "Error" message when an OAuth token
  // is not allowed to access a specific model (e.g. Sonnet/Opus blocked,
  // only Haiku permitted).  Surface a clear message instead of the silent
  // "I couldn't generate a response" fallback.
  if (
    status === 400 &&
    (/^error$/i.test(message.trim()) ||
      /^http( error)?:?\s*400\b/i.test(message.trim()) ||
      /^bad request$/i.test(message.trim())) &&
    responseBody
  ) {
    const body = responseBody;
    if (body.includes("invalid_request_error")) {
      throw new RuntimeError(
        "Claude Code OAuth: this model is not available with your current subscription. " +
          "Try a different model (e.g. claude-haiku-4-5-20251001) or use a console API key.",
        { code: ProviderErrorCode.AUTH_FAILED },
      );
    }
  }
}

function safeCreateNativeTools(factory: () => ToolSet): ToolSet {
  try {
    return factory();
  } catch {
    return {};
  }
}

export async function createSdkProviderBundle(
  spec: SdkModelSpec,
): Promise<SdkProviderBundle> {
  const providerName = assertSupportedSdkProvider(spec.providerName);
  const modelId = toNonEmptyString(spec.modelId);
  if (!modelId) {
    throw new ValidationError("Model id is required", "provider_sdk_runtime");
  }

  switch (providerName) {
    case "openai": {
      const apiKey = getRequiredApiKey(providerName, spec.apiKey);
      const { createOpenAI } = await import("@ai-sdk/openai");
      const baseURL = withApiPathSuffix(
        toNonEmptyString(spec.endpoint) ??
          getPlatform().env.get("OPENAI_BASE_URL"),
        "/v1",
      );
      const openai = createOpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
      return {
        model: openai(modelId),
        nativeTools: safeCreateNativeTools(() =>
          createNativeProviderTools(providerName, openai)
        ),
      };
    }

    case "anthropic": {
      const apiKey = getRequiredApiKey(providerName, spec.apiKey);
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      const baseURL = withApiPathSuffix(
        toNonEmptyString(spec.endpoint) ??
          getPlatform().env.get("ANTHROPIC_BASE_URL"),
        "/v1",
      );
      const anthropic = createAnthropic({
        apiKey,
        ...(baseURL ? { baseURL } : {}),
      });
      return {
        model: anthropic(modelId),
        nativeTools: safeCreateNativeTools(() =>
          createNativeProviderTools(providerName, anthropic)
        ),
      };
    }

    case "google": {
      const apiKey = getRequiredApiKey(providerName, spec.apiKey);
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      const baseURL = withApiPathSuffix(
        toNonEmptyString(spec.endpoint),
        "/v1beta",
      );
      const google = createGoogleGenerativeAI({
        apiKey,
        ...(baseURL ? { baseURL } : {}),
      });
      return {
        model: google(modelId),
        nativeTools: safeCreateNativeTools(() =>
          createNativeProviderTools(providerName, google)
        ),
      };
    }

    case "claude-code": {
      const { getClaudeCodeToken } = await import("./claude-code/auth.ts");
      const token = await getClaudeCodeToken();
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      const baseURL = withApiPathSuffix(
        toNonEmptyString(spec.endpoint) ??
          getPlatform().env.get("ANTHROPIC_BASE_URL"),
        "/v1",
      );
      const anthropic = createAnthropic({
        authToken: token,
        ...(baseURL ? { baseURL } : {}),
        headers: {
          "anthropic-beta": "oauth-2025-04-20",
        },
        name: "claude-code.messages",
      });
      return {
        model: anthropic(modelId),
        nativeTools: safeCreateNativeTools(() =>
          createNativeProviderTools(providerName, anthropic)
        ),
      };
    }

    case "ollama": {
      const { createOllama } = await import("ollama-ai-provider-v2");
      const baseURL = withApiPathSuffix(
        toNonEmptyString(spec.endpoint) ??
          getPlatform().env.get("OLLAMA_BASE_URL"),
        "/api",
      );
      const ollama = createOllama({ ...(baseURL ? { baseURL } : {}) });
      return {
        model: ollama(modelId),
        nativeTools: safeCreateNativeTools(() =>
          createNativeProviderTools(providerName, ollama)
        ),
      };
    }
  }
}

export async function createSdkLanguageModel(
  spec: SdkModelSpec,
): Promise<LanguageModel> {
  return (await createSdkProviderBundle(spec)).model;
}

export async function preflightProviderExecutionCapabilities(
  spec: SdkModelSpec,
): Promise<NativeProviderCapabilityAvailability> {
  try {
    const bundle = await createSdkProviderBundle(spec);
    return getNativeProviderCapabilityAvailability(bundle.nativeTools);
  } catch {
    return EMPTY_NATIVE_PROVIDER_CAPABILITY_AVAILABILITY;
  }
}

export function convertToolDefinitionsToSdk(
  defs?: ToolDefinition[],
): Record<string, ReturnType<typeof tool>> | undefined {
  if (!defs?.length) return undefined;
  const result: Record<string, ReturnType<typeof tool>> = {};
  for (const def of defs) {
    result[def.function.name] = tool({
      description: def.function.description ?? "",
      inputSchema: jsonSchema(def.function.parameters),
    });
  }
  return result;
}

type SdkTextPart = { type: "text"; text: string };
type SdkImagePart = { type: "image"; image: string };
type SdkFilePart = { type: "file"; data: string; mediaType: string };
type SdkAssistantPart = SdkTextPart | ToolCallPart;
type GoogleGenAIModule = typeof import("npm:@google/genai");
type GoogleGenAIClient = InstanceType<GoogleGenAIModule["GoogleGenAI"]>;
type GoogleContentPart = ReturnType<GoogleGenAIModule["createPartFromText"]>;
type GoogleContent = ReturnType<GoogleGenAIModule["createUserContent"]>;

interface GoogleFileRecord {
  name?: string;
  uri?: string;
  mimeType?: string;
  state?: string;
  error?: {
    message?: string;
  };
}

interface GoogleGenerateContentChunk {
  text?: string;
}

interface GoogleUploadedAttachment {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  kind: ConversationAttachmentPayload["kind"];
  size: number;
  conversationKind: ConversationAttachmentPayload["conversationKind"];
  uploadedName: string;
  uploadedUri: string;
}

/**
 * Message shape accepted by the universal SDK converter.
 * Both AgentMessage (camelCase) and ProviderMessage (snake_case) satisfy this.
 */
export interface SdkConvertibleMessage {
  role: string;
  content: string;
  /** Prepared attachments already normalized by the runtime attachment service. */
  attachments?: ConversationAttachmentPayload[];
  // AgentMessage convention (camelCase)
  toolCalls?: Array<
    { id?: string; function: { name: string; arguments: unknown } }
  >;
  toolName?: string;
  toolCallId?: string;
  // ProviderMessage convention (snake_case)
  tool_calls?: Array<
    { id?: string; function: { name: string; arguments: unknown } }
  >;
  tool_name?: string;
  tool_call_id?: string;
  /** SDK-native response messages for lossless reasoning passthrough. */
  _sdkResponseMessages?: unknown[];
}

async function traceProviderPackedAttachments(
  spec: SdkModelSpec,
  messages: readonly SdkConvertibleMessage[],
): Promise<void> {
  for (const msg of messages) {
    if (msg.role !== "user" || !msg.attachments?.length) continue;
    for (const attachment of msg.attachments) {
      await appendAttachmentPipelineTrace({
        stage: "provider_packed",
        attachmentId: attachment.attachmentId,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        kind: attachment.kind,
        size: attachment.size,
        providerName: spec.providerName,
        modelId: spec.modelId,
        conversationKind: attachment.conversationKind,
        attachmentMode: attachment.mode,
        textLength: attachment.mode === "text"
          ? attachment.text.length
          : undefined,
      });
    }
  }
}

function getUserBinaryAttachments(
  messages: readonly SdkConvertibleMessage[],
): ConversationAttachmentPayload[] {
  return messages.flatMap((message) => {
    if (message.role !== "user") return [];
    return (message.attachments ?? []).filter((attachment) =>
      attachment.mode === "binary"
    );
  });
}

function hasGoogleVideoAttachments(
  spec: SdkModelSpec,
  messages: readonly SdkConvertibleMessage[],
): boolean {
  if (spec.providerName !== "google") {
    return false;
  }
  return getUserBinaryAttachments(messages).some((attachment) =>
    attachment.conversationKind === "video"
  );
}

async function appendProviderAttachmentTrace(
  spec: SdkModelSpec,
  messages: readonly SdkConvertibleMessage[],
  stage:
    | "provider_request_started"
    | "provider_first_chunk"
    | "provider_completed"
    | "provider_failed",
  extras: Partial<{
    errorMessage: string;
  }> = {},
): Promise<void> {
  for (const attachment of getUserBinaryAttachments(messages)) {
    await appendAttachmentPipelineTrace({
      stage,
      attachmentId: attachment.attachmentId,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      kind: attachment.kind,
      size: attachment.size,
      providerName: spec.providerName,
      modelId: spec.modelId,
      conversationKind: attachment.conversationKind,
      attachmentMode: attachment.mode,
      errorMessage: extras.errorMessage,
    });
  }
}

async function appendGoogleFileTrace(
  spec: SdkModelSpec,
  attachment: ConversationAttachmentPayload,
  stage:
    | "google_file_upload_started"
    | "google_file_uploaded"
    | "google_file_ready",
  extras: Partial<{
    fileState: string;
    errorMessage: string;
  }> = {},
): Promise<void> {
  if (attachment.mode !== "binary") {
    return;
  }
  await appendAttachmentPipelineTrace({
    stage,
    attachmentId: attachment.attachmentId,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    kind: attachment.kind,
    size: attachment.size,
    providerName: spec.providerName,
    modelId: spec.modelId,
    conversationKind: attachment.conversationKind,
    attachmentMode: attachment.mode,
    fileState: extras.fileState,
    errorMessage: extras.errorMessage,
  });
}

function decodeAttachmentData(data: string): Uint8Array {
  return decodeBase64(data);
}

function getGoogleHttpOptions(
  spec: SdkModelSpec,
): { baseUrl?: string; apiVersion?: string } | undefined {
  const configuredBaseUrl = toNonEmptyString(spec.endpoint);
  if (!configuredBaseUrl) {
    return undefined;
  }

  const normalizedBaseUrl = configuredBaseUrl.replace(/\/+$/, "");
  const hasEmbeddedApiVersion = /\/v[0-9][a-z0-9.-]*$/i.test(
    normalizedBaseUrl,
  );
  return hasEmbeddedApiVersion
    ? { baseUrl: normalizedBaseUrl, apiVersion: "" }
    : { baseUrl: normalizedBaseUrl };
}

async function createGoogleNativeClient(
  spec: SdkModelSpec,
): Promise<{
  ai: GoogleGenAIClient;
  module: GoogleGenAIModule;
}> {
  const apiKey = getRequiredApiKey("google", spec.apiKey);
  const module = await import("npm:@google/genai");
  const httpOptions = getGoogleHttpOptions(spec);
  const ai = new module.GoogleGenAI({
    apiKey,
    ...(httpOptions ? { httpOptions } : {}),
  });
  return { ai, module };
}

function requireGoogleFileIdentity(
  attachment: ConversationAttachmentPayload,
  file: GoogleFileRecord,
): GoogleUploadedAttachment {
  if (attachment.mode !== "binary") {
    throw new ValidationError(
      "Google file uploads require binary attachments.",
      "provider_sdk_runtime",
    );
  }

  const uploadedName = toNonEmptyString(file.name);
  const uploadedUri = toNonEmptyString(file.uri);
  const uploadedMimeType = toNonEmptyString(file.mimeType) ??
    attachment.mimeType;

  if (!uploadedName || !uploadedUri) {
    throw new RuntimeError(
      `Google file upload returned an incomplete file record for ${attachment.fileName}.`,
      { code: ProviderErrorCode.REQUEST_FAILED },
    );
  }

  return {
    attachmentId: attachment.attachmentId,
    fileName: attachment.fileName,
    mimeType: uploadedMimeType,
    kind: attachment.kind,
    size: attachment.size,
    conversationKind: attachment.conversationKind,
    uploadedName,
    uploadedUri,
  };
}

async function waitForGoogleFileReady(
  spec: SdkModelSpec,
  ai: GoogleGenAIClient,
  module: GoogleGenAIModule,
  attachment: ConversationAttachmentPayload,
  uploadedFile: GoogleFileRecord,
  signal?: AbortSignal,
): Promise<GoogleUploadedAttachment> {
  const initialRecord = requireGoogleFileIdentity(attachment, uploadedFile);
  const activeState = module.FileState.ACTIVE;
  const failedState = module.FileState.FAILED;

  let currentFile = uploadedFile;
  for (let attempt = 0; attempt < 120; attempt++) {
    const currentState = currentFile.state;
    if (currentState === activeState || currentState === "ACTIVE") {
      await appendGoogleFileTrace(spec, attachment, "google_file_ready", {
        fileState: currentState,
      });
      return requireGoogleFileIdentity(attachment, currentFile);
    }
    if (currentState === failedState || currentState === "FAILED") {
      const errorMessage = toNonEmptyString(currentFile.error?.message) ??
        `Google rejected ${attachment.fileName} during file processing.`;
      await appendGoogleFileTrace(spec, attachment, "google_file_ready", {
        fileState: currentState,
        errorMessage,
      });
      throw new RuntimeError(
        errorMessage,
        { code: ProviderErrorCode.REQUEST_REJECTED },
      );
    }

    signal?.throwIfAborted();
    await new Promise((resolve) => setTimeout(resolve, 500));
    currentFile = await ai.files.get({
      name: initialRecord.uploadedName,
    }) as GoogleFileRecord;
  }

  throw new RuntimeError(
    `Timed out waiting for Google to finish processing ${attachment.fileName}.`,
    { code: ProviderErrorCode.REQUEST_FAILED },
  );
}

async function uploadGoogleAttachment(
  spec: SdkModelSpec,
  ai: GoogleGenAIClient,
  module: GoogleGenAIModule,
  attachment: ConversationAttachmentPayload,
  signal?: AbortSignal,
): Promise<GoogleUploadedAttachment> {
  if (attachment.mode !== "binary") {
    throw new ValidationError(
      "Google file uploads require binary attachments.",
      "provider_sdk_runtime",
    );
  }

  await appendGoogleFileTrace(spec, attachment, "google_file_upload_started");

  const bytes = decodeAttachmentData(attachment.data);
  const file = await ai.files.upload({
    file: new Blob([bytes], { type: attachment.mimeType }),
    config: {
      mimeType: attachment.mimeType,
      displayName: attachment.fileName,
      ...(signal ? { abortSignal: signal } : {}),
    },
  }) as GoogleFileRecord;

  await appendGoogleFileTrace(spec, attachment, "google_file_uploaded", {
    fileState: file.state,
  });

  return await waitForGoogleFileReady(
    spec,
    ai,
    module,
    attachment,
    file,
    signal,
  );
}

async function resolveGoogleUploadedAttachment(
  spec: SdkModelSpec,
  ai: GoogleGenAIClient,
  module: GoogleGenAIModule,
  attachment: ConversationAttachmentPayload,
  uploadCache: Map<string, Promise<GoogleUploadedAttachment>>,
  signal?: AbortSignal,
): Promise<GoogleUploadedAttachment> {
  const cached = uploadCache.get(attachment.attachmentId);
  if (cached) {
    return await cached;
  }
  const uploadPromise = uploadGoogleAttachment(
    spec,
    ai,
    module,
    attachment,
    signal,
  );
  uploadCache.set(attachment.attachmentId, uploadPromise);
  return await uploadPromise;
}

function formatTextAttachmentForPrompt(
  attachment: ConversationAttachmentPayload,
): string {
  if (attachment.mode !== "text") {
    throw new ValidationError(
      "Expected text attachment payload.",
      "provider_sdk_runtime",
    );
  }
  return `Attached file (${attachment.fileName}, ${attachment.mimeType}):\n${attachment.text}`;
}

function formatAssistantToolCalls(
  toolCalls: NonNullable<SdkConvertibleMessage["toolCalls"]>,
): string {
  return toolCalls.map((toolCall) =>
    `Tool call: ${toolCall.function.name}\nArguments: ${
      JSON.stringify(normalizeToolArgs(toolCall.function.arguments))
    }`
  ).join("\n\n");
}

function formatToolResultMessage(message: SdkConvertibleMessage): string {
  const toolName = message.toolName ?? message.tool_name ?? "tool";
  const toolContent = message.content.trim();
  return toolContent.length > 0
    ? `Tool result (${toolName}):\n${toolContent}`
    : `Tool result (${toolName})`;
}

async function buildGoogleContents(
  spec: SdkModelSpec,
  ai: GoogleGenAIClient,
  module: GoogleGenAIModule,
  messages: readonly SdkConvertibleMessage[],
  signal?: AbortSignal,
): Promise<{
  contents: GoogleContent[];
  systemInstruction?: string;
}> {
  const uploadCache = new Map<string, Promise<GoogleUploadedAttachment>>();
  const systemParts: string[] = [];
  const contents: GoogleContent[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      if (message.content) {
        systemParts.push(message.content);
      }
      continue;
    }

    if (message.role === "user") {
      const parts: GoogleContentPart[] = [];
      if (message.content) {
        parts.push(module.createPartFromText(message.content));
      }
      for (const attachment of message.attachments ?? []) {
        if (attachment.mode === "text") {
          parts.push(
            module.createPartFromText(
              formatTextAttachmentForPrompt(attachment),
            ),
          );
          continue;
        }
        if (attachment.mimeType.startsWith("image/")) {
          parts.push(
            module.createPartFromBase64(attachment.data, attachment.mimeType),
          );
          continue;
        }
        const uploadedAttachment = await resolveGoogleUploadedAttachment(
          spec,
          ai,
          module,
          attachment,
          uploadCache,
          signal,
        );
        parts.push(
          module.createPartFromUri(
            uploadedAttachment.uploadedUri,
            uploadedAttachment.mimeType,
          ),
        );
      }
      if (parts.length > 0) {
        contents.push(module.createUserContent(parts));
      }
      continue;
    }

    if (message.role === "assistant") {
      const parts: GoogleContentPart[] = [];
      if (message.content) {
        parts.push(module.createPartFromText(message.content));
      }
      const toolCalls = message.toolCalls ?? message.tool_calls;
      if (toolCalls?.length) {
        parts.push(
          module.createPartFromText(formatAssistantToolCalls(toolCalls)),
        );
      }
      if (parts.length > 0) {
        contents.push(module.createModelContent(parts));
      }
      continue;
    }

    contents.push(
      module.createUserContent(
        [module.createPartFromText(formatToolResultMessage(message))],
      ),
    );
  }

  return {
    contents,
    ...(systemParts.length > 0
      ? { systemInstruction: systemParts.join("\n\n") }
      : {}),
  };
}

async function* streamGoogleVideoRequest(
  spec: SdkModelSpec,
  messages: Message[],
  options?: ChatOptions,
  signal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  try {
    const { ai, module } = await createGoogleNativeClient(spec);
    const { contents, systemInstruction } = await buildGoogleContents(
      spec,
      ai,
      module,
      messages,
      signal,
    );
    const request = {
      model: spec.modelId,
      contents,
      config: {
        ...(systemInstruction ? { systemInstruction } : {}),
        ...(typeof options?.temperature === "number"
          ? { temperature: options.temperature }
          : {}),
        ...(typeof options?.maxTokens === "number"
          ? { maxOutputTokens: options.maxTokens }
          : {}),
        ...(options?.stop?.length ? { stopSequences: options.stop } : {}),
        ...(signal ? { abortSignal: signal } : {}),
      },
    };

    await appendProviderAttachmentTrace(
      spec,
      messages,
      "provider_request_started",
    );

    const stream = await ai.models.generateContentStream(
      request,
    ) as AsyncGenerator<GoogleGenerateContentChunk>;
    let sawFirstChunk = false;

    for await (const chunk of stream) {
      const text = typeof chunk.text === "string" ? chunk.text : "";
      if (!text) {
        continue;
      }
      if (!sawFirstChunk) {
        sawFirstChunk = true;
        await appendProviderAttachmentTrace(
          spec,
          messages,
          "provider_first_chunk",
        );
      }
      yield text;
    }

    await appendProviderAttachmentTrace(
      spec,
      messages,
      "provider_completed",
    );
  } catch (error) {
    await appendProviderAttachmentTrace(
      spec,
      messages,
      "provider_failed",
      { errorMessage: getErrorMessage(error) },
    );
    wrapProviderSdkError(error, spec.providerName);
  }
}

/**
 * Universal converter: internal messages → AI SDK ModelMessage[].
 * Handles both AgentMessage (camelCase) and ProviderMessage (snake_case) field names.
 * Single source of truth — used by both engine-sdk.ts and sdk-runtime.ts.
 */
export function convertToSdkMessages(
  messages: SdkConvertibleMessage[],
): ModelMessage[] {
  // Consolidate all system messages into a single message at position 0.
  // Providers reject interleaved system messages (e.g. system, user, system).
  const systemParts: string[] = [];
  const nonSystemMessages: SdkConvertibleMessage[] = [];
  for (const msg of messages) {
    if (msg.role === "system") {
      if (msg.content) systemParts.push(msg.content);
    } else {
      nonSystemMessages.push(msg);
    }
  }

  const result: ModelMessage[] = [];
  let pendingToolCalls: Array<{ id: string; name: string }> = [];
  if (systemParts.length > 0) {
    result.push({ role: "system", content: systemParts.join("\n\n") });
  }

  for (const msg of nonSystemMessages) {
    if (msg.role === "user") {
      pendingToolCalls = [];
      if (!msg.attachments?.length) {
        result.push({ role: "user", content: msg.content });
        continue;
      }
      const content: Array<SdkTextPart | SdkImagePart | SdkFilePart> = [];
      if (msg.content) {
        content.push({ type: "text", text: msg.content });
      }
      for (const attachment of msg.attachments) {
        if (attachment.mode === "text") {
          content.push({
            type: "text",
            text:
              `Attached file (${attachment.fileName}, ${attachment.mimeType}):\n${attachment.text}`,
          });
        } else if (attachment.mimeType.startsWith("image/")) {
          content.push({ type: "image", image: attachment.data });
        } else {
          // PDF, audio, and video are represented as binary file parts.
          content.push({
            type: "file",
            data: attachment.data,
            mediaType: attachment.mimeType,
          });
        }
      }
      result.push({ role: "user", content });
      continue;
    }

    if (msg.role === "assistant") {
      // Prefer SDK-native messages when available (preserves ReasoningPart)
      if (msg._sdkResponseMessages?.length) {
        const sdkMessages = msg._sdkResponseMessages as ModelMessage[];
        const sdkAssistant = sdkMessages.find((m) => m.role === "assistant");
        if (sdkAssistant) {
          // Extract pendingToolCalls for subsequent tool-result correlation
          if (Array.isArray(sdkAssistant.content)) {
            pendingToolCalls = [];
            for (const part of sdkAssistant.content) {
              if (
                part && typeof part === "object" && "type" in part &&
                part.type === "tool-call"
              ) {
                const tcPart = part as {
                  toolCallId: string;
                  toolName: string;
                };
                pendingToolCalls.push({
                  id: tcPart.toolCallId,
                  name: tcPart.toolName,
                });
              }
            }
          } else {
            pendingToolCalls = [];
          }
          result.push(sdkAssistant);
          continue;
        }
      }
      // Fallback: reconstruct from HLVM fields (transcript load, legacy engine)
      const toolCalls = msg.toolCalls ?? msg.tool_calls;
      if (toolCalls?.length) {
        const parts: SdkAssistantPart[] = [];
        const resolvedToolCalls: Array<{ id: string; name: string }> = [];
        if (msg.content) {
          parts.push({ type: "text", text: msg.content });
        }
        for (const tc of toolCalls) {
          const toolCallId = tc.id ?? generateToolCallId();
          resolvedToolCalls.push({ id: toolCallId, name: tc.function.name });
          parts.push({
            type: "tool-call",
            toolCallId,
            toolName: tc.function.name,
            input: normalizeToolArgs(tc.function.arguments),
          });
        }
        pendingToolCalls = resolvedToolCalls;
        result.push({ role: "assistant", content: parts });
      } else {
        pendingToolCalls = [];
        result.push({ role: "assistant", content: msg.content });
      }
      continue;
    }

    // role === "tool"
    const toolName = msg.toolName ?? msg.tool_name;
    let toolCallId = msg.toolCallId ?? msg.tool_call_id;
    if (
      !toolCallId &&
      pendingToolCalls.length === 1 &&
      (typeof toolName !== "string" || pendingToolCalls[0].name === toolName)
    ) {
      toolCallId = pendingToolCalls[0].id;
    }
    if (!toolCallId && pendingToolCalls.length > 1) {
      const sameNameMatches = typeof toolName === "string"
        ? pendingToolCalls.filter((call) => call.name === toolName)
        : [];
      if (sameNameMatches.length === 1) {
        toolCallId = sameNameMatches[0].id;
      }
    }
    if (!toolCallId) {
      continue;
    }
    const pendingIndex = pendingToolCalls.findIndex((call) =>
      call.id === toolCallId
    );
    if (pendingIndex < 0) {
      continue;
    }
    pendingToolCalls = pendingToolCalls.filter((call) =>
      call.id !== toolCallId
    );

    const toolResultPart = {
      type: "tool-result" as const,
      toolCallId,
      toolName: toolName ?? "unknown",
      output: { type: "text" as const, value: msg.content },
    };
    const previous = result[result.length - 1];
    if (previous?.role === "tool" && Array.isArray(previous.content)) {
      previous.content.push(toolResultPart);
    } else {
      result.push({
        role: "tool",
        content: [toolResultPart],
      });
    }
  }

  return result;
}

export function mapSdkUsage(
  usage?: { inputTokens: number | undefined; outputTokens: number | undefined },
): { inputTokens: number; outputTokens: number } | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
  };
}

function toProviderToolCalls(
  calls: Array<{ toolCallId: string; toolName: string; input: unknown }>,
): ProviderToolCall[] {
  return calls.map((call): ProviderToolCall => ({
    id: call.toolCallId,
    type: "function",
    function: {
      name: call.toolName,
      arguments: normalizeToolArgs(call.input),
    },
  }));
}

export function normalizeProviderMetadata(
  value: unknown,
): Record<string, unknown> | undefined {
  return isObjectValue(value) ? value as Record<string, unknown> : undefined;
}

interface SdkSourceShape {
  type: "source";
  sourceType: "url" | "document";
  id: string;
  url?: string;
  title?: string;
  mediaType?: string;
  filename?: string;
  providerMetadata?: unknown;
}

export function mapSdkSources(
  sources: SdkSourceShape[] | undefined,
): ChatStructuredResponse["sources"] | undefined {
  if (!Array.isArray(sources) || sources.length === 0) return undefined;

  const mapped: NonNullable<ChatStructuredResponse["sources"]> = [];
  for (const source of sources) {
    if (!source || source.type !== "source") continue;
    if (source.sourceType === "url") {
      mapped.push({
        id: source.id,
        sourceType: "url" as const,
        url: source.url,
        title: source.title,
        providerMetadata: normalizeProviderMetadata(source.providerMetadata),
      });
      continue;
    }
    if (source.sourceType === "document") {
      mapped.push({
        id: source.id,
        sourceType: "document" as const,
        title: source.title,
        mediaType: source.mediaType,
        filename: source.filename,
        providerMetadata: normalizeProviderMetadata(source.providerMetadata),
      });
    }
  }

  return mapped.length > 0 ? mapped : undefined;
}

function resolveNumCtx(options?: GenerateOptions): number | undefined {
  const rawValue = options?.raw?.num_ctx;
  if (
    typeof rawValue === "number" &&
    Number.isFinite(rawValue) &&
    rawValue > 0
  ) {
    return Math.floor(rawValue);
  }
  return undefined;
}

function buildCommonSettings(
  spec: SdkModelSpec,
  model: LanguageModel,
  messages: ModelMessage[],
  options: ChatOptions | undefined,
  signal: AbortSignal | undefined,
) {
  const numCtx = spec.providerName === "ollama"
    ? resolveNumCtx(options)
    : undefined;
  const tools = convertToolDefinitionsToSdk(options?.tools);
  return {
    model,
    messages,
    ...(tools ? { tools } : {}),
    temperature: options?.temperature ?? 0.0,
    maxTokens: options?.maxTokens,
    stopSequences: options?.stop,
    abortSignal: signal,
    ...(numCtx ? { providerOptions: { ollama: { num_ctx: numCtx } } } : {}),
  };
}

export async function* generateWithSdk(
  spec: SdkModelSpec,
  prompt: string,
  options?: GenerateOptions,
  signal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  const messages: Message[] = [];
  if (options?.system) {
    messages.push({ role: "system", content: options.system });
  }
  messages.push({
    role: "user",
    content: prompt,
    ...(options?.attachments?.length
      ? { attachments: options.attachments }
      : {}),
  });
  yield* chatWithSdk(
    spec,
    messages,
    options as ChatOptions | undefined,
    signal,
  );
}

export async function* chatWithSdk(
  spec: SdkModelSpec,
  messages: Message[],
  options?: ChatOptions,
  signal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  await traceProviderPackedAttachments(spec, messages);
  if (hasGoogleVideoAttachments(spec, messages)) {
    yield* streamGoogleVideoRequest(spec, messages, options, signal);
    return;
  }
  const model = await createSdkLanguageModel(spec);
  const sdkMessages = convertToSdkMessages(messages);
  const settings = buildCommonSettings(
    spec,
    model,
    sdkMessages,
    options,
    signal,
  );

  try {
    const result = streamText(settings);
    for await (const chunk of result.textStream) {
      yield chunk;
    }
    await result.text;
  } catch (error) {
    await maybeHandleSdkAuthError(spec.providerName, error);
    // "No output generated" retry is handled by the agent engine layer
    // (engine-sdk.ts) which has richer recovery (tool calls, usage tracking).
    // Re-throwing here avoids a double retry that wastes latency.
    wrapProviderSdkError(error, spec.providerName);
  }
}

export async function chatStructuredWithSdk(
  spec: SdkModelSpec,
  messages: Message[],
  options?: ChatOptions,
  signal?: AbortSignal,
): Promise<ChatStructuredResponse> {
  await traceProviderPackedAttachments(spec, messages);
  if (hasGoogleVideoAttachments(spec, messages)) {
    const onToken = options?.onToken;
    let content = "";
    for await (
      const chunk of streamGoogleVideoRequest(
        spec,
        messages,
        options,
        signal,
      )
    ) {
      content += chunk;
      onToken?.(chunk);
    }
    return {
      content,
    };
  }
  const model = await createSdkLanguageModel(spec);
  const sdkMessages = convertToSdkMessages(messages);
  const settings = buildCommonSettings(
    spec,
    model,
    sdkMessages,
    options,
    signal,
  );
  const onToken = options?.onToken;

  try {
    if (typeof onToken === "function") {
      const result = streamText(settings);
      const contentChunks: string[] = [];
      for await (const chunk of result.textStream) {
        contentChunks.push(chunk);
        onToken(chunk);
      }

      const [text, toolCalls, usage, sources, providerMetadata] = await Promise
        .all([
          result.text,
          result.toolCalls,
          result.usage,
          result.sources,
          result.providerMetadata,
        ]);

      return {
        content: contentChunks.join("") || text || "",
        toolCalls: toProviderToolCalls(toolCalls),
        usage: mapSdkUsage(usage),
        sources: mapSdkSources(sources),
        providerMetadata: normalizeProviderMetadata(providerMetadata),
      };
    }

    const result = await generateText(settings);
    return {
      content: result.text || "",
      toolCalls: toProviderToolCalls(result.toolCalls),
      usage: mapSdkUsage(result.usage),
      sources: mapSdkSources(result.sources),
      providerMetadata: normalizeProviderMetadata(result.providerMetadata),
    };
  } catch (error) {
    await maybeHandleSdkAuthError(spec.providerName, error);
    wrapProviderSdkError(error, spec.providerName);
  }
}

export async function generateStructuredWithSdk(
  spec: SdkModelSpec,
  messages: SdkConvertibleMessage[],
  schema: Record<string, unknown>,
  options?: { signal?: AbortSignal; temperature?: number },
): Promise<unknown> {
  const model = await createSdkLanguageModel(spec);
  const sdkMessages = convertToSdkMessages(messages);
  try {
    const { output } = await generateText({
      model,
      messages: sdkMessages,
      output: Output.object({ schema: jsonSchema(schema) }),
      temperature: options?.temperature ?? 0.0,
      abortSignal: options?.signal,
    });
    return output;
  } catch (error) {
    await maybeHandleSdkAuthError(spec.providerName, error);
    wrapProviderSdkError(error, spec.providerName);
  }
}
