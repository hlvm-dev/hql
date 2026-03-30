import type { ToolSet } from "ai";
import type { SdkProviderName } from "./sdk-runtime.ts";
import {
  NATIVE_WEB_SEARCH_TOOL_NAME,
  type NativeProviderCapabilityAvailability,
  REMOTE_CODE_EXECUTE_TOOL_NAME,
  WEB_PAGE_READ_TOOL_NAME,
} from "../agent/tool-capabilities.ts";

export const NATIVE_COMPUTER_USE_TOOL_NAME = "computer";

type ToolFactoryResult = ToolSet[string];
type EmptyOptionsFactory = (options?: Record<string, never>) => ToolFactoryResult;

type OpenAiToolClient = {
  tools?: {
    webSearch?: (
      options?: { searchContextSize?: "low" | "medium" | "high" },
    ) => ToolFactoryResult;
  };
};

type AnthropicToolClient = {
  tools?: {
    webSearch_20250305?: (
      options?: { maxUses?: number },
    ) => ToolFactoryResult;
    codeExecution_20250522?: () => ToolFactoryResult;
    computer_20250124?: (
      options: { displayWidthPx: number; displayHeightPx: number },
    ) => ToolFactoryResult;
  };
};

type GoogleToolClient = {
  tools?: {
    googleSearch?: EmptyOptionsFactory;
    urlContext?: () => ToolFactoryResult;
    codeExecution?: () => ToolFactoryResult;
  };
};

function safeToolSet(
  toolName: string,
  factory: () => ToolFactoryResult | undefined,
): ToolSet {
  try {
    const tool = factory();
    return tool ? { [toolName]: tool } : {};
  } catch {
    return {};
  }
}

function mergeToolSets(...sets: ToolSet[]): ToolSet {
  return Object.assign({}, ...sets);
}

function createOpenAiNativeTools(client: OpenAiToolClient): ToolSet {
  return safeToolSet(
    NATIVE_WEB_SEARCH_TOOL_NAME,
    () =>
      client.tools?.webSearch?.({
        searchContextSize: "medium",
      }),
  );
}

function createAnthropicNativeTools(client: AnthropicToolClient): ToolSet {
  return mergeToolSets(
    safeToolSet(
      NATIVE_WEB_SEARCH_TOOL_NAME,
      () =>
        client.tools?.webSearch_20250305?.({
          maxUses: 5,
        }),
    ),
    safeToolSet(
      REMOTE_CODE_EXECUTE_TOOL_NAME,
      () => client.tools?.codeExecution_20250522?.(),
    ),
    safeToolSet(
      NATIVE_COMPUTER_USE_TOOL_NAME,
      () =>
        client.tools?.computer_20250124?.({
          displayWidthPx: 1920,
          displayHeightPx: 1080,
        }),
    ),
  );
}

function createGoogleNativeTools(client: GoogleToolClient): ToolSet {
  const urlContextFactory = client.tools?.urlContext as
    | EmptyOptionsFactory
    | undefined;
  const codeExecutionFactory = client.tools?.codeExecution as
    | EmptyOptionsFactory
    | undefined;
  return mergeToolSets(
    safeToolSet(
      NATIVE_WEB_SEARCH_TOOL_NAME,
      () => client.tools?.googleSearch?.({}),
    ),
    safeToolSet(
      WEB_PAGE_READ_TOOL_NAME,
      () => urlContextFactory?.({}),
    ),
    safeToolSet(
      REMOTE_CODE_EXECUTE_TOOL_NAME,
      () => codeExecutionFactory?.({}),
    ),
  );
}

export function createNativeProviderTools(
  providerName: SdkProviderName,
  client: unknown,
): ToolSet {
  switch (providerName) {
    case "openai":
      return createOpenAiNativeTools(client as OpenAiToolClient);
    case "anthropic":
    case "claude-code":
      return createAnthropicNativeTools(client as AnthropicToolClient);
    case "google":
      return createGoogleNativeTools(client as GoogleToolClient);
    default:
      return {};
  }
}

export function getNativeProviderCapabilityAvailability(
  tools: ToolSet,
): NativeProviderCapabilityAvailability {
  return {
    webSearch: NATIVE_WEB_SEARCH_TOOL_NAME in tools,
    webPageRead: WEB_PAGE_READ_TOOL_NAME in tools,
    remoteCodeExecution: REMOTE_CODE_EXECUTE_TOOL_NAME in tools,
    audioAnalyze: false, // Populated from provider capabilities at routing layer
    computerUse: NATIVE_COMPUTER_USE_TOOL_NAME in tools,
  };
}
