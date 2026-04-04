import type { ToolSet } from "ai";
import type { SdkProviderName } from "./sdk-runtime.ts";
export const NATIVE_WEB_SEARCH_TOOL_NAME = "web_search";
export const WEB_PAGE_READ_TOOL_NAME = "web_fetch";
export const REMOTE_CODE_EXECUTE_TOOL_NAME = "remote_code_execute";
export const NATIVE_COMPUTER_USE_TOOL_NAME = "computer";

export interface NativeProviderCapabilityAvailability {
  webSearch: boolean;
  webPageRead: boolean;
  remoteCodeExecution: boolean;
  audioAnalyze: boolean;
  computerUse: boolean;
}

export const EMPTY_NATIVE_PROVIDER_CAPABILITY_AVAILABILITY:
  NativeProviderCapabilityAvailability = {
    webSearch: false,
    webPageRead: false,
    remoteCodeExecution: false,
    audioAnalyze: false,
    computerUse: false,
  };

export function createNativeProviderTools(
  _providerName: SdkProviderName,
  _client: unknown,
): ToolSet {
  return {};
}

export function getNativeProviderCapabilityAvailability(
  tools: ToolSet,
): NativeProviderCapabilityAvailability {
  return {
    ...EMPTY_NATIVE_PROVIDER_CAPABILITY_AVAILABILITY,
    webSearch: NATIVE_WEB_SEARCH_TOOL_NAME in tools,
    webPageRead: WEB_PAGE_READ_TOOL_NAME in tools,
    remoteCodeExecution: REMOTE_CODE_EXECUTE_TOOL_NAME in tools,
    computerUse: NATIVE_COMPUTER_USE_TOOL_NAME in tools,
  };
}
