export const CUSTOM_WEB_SEARCH_TOOL_NAME = "search_web";
export const NATIVE_WEB_SEARCH_TOOL_NAME = "web_search";
export const WEB_PAGE_READ_TOOL_NAME = "web_fetch";
export const RAW_URL_FETCH_TOOL_NAME = "fetch_url";
export const REMOTE_CODE_EXECUTE_TOOL_NAME = "remote_code_execute";

const WEB_TOOL_NAMES = new Set<string>([
  CUSTOM_WEB_SEARCH_TOOL_NAME,
  NATIVE_WEB_SEARCH_TOOL_NAME,
  WEB_PAGE_READ_TOOL_NAME,
  RAW_URL_FETCH_TOOL_NAME,
]);

const CITATION_BACKED_WEB_TOOL_NAMES = new Set<string>([
  CUSTOM_WEB_SEARCH_TOOL_NAME,
  NATIVE_WEB_SEARCH_TOOL_NAME,
  WEB_PAGE_READ_TOOL_NAME,
  RAW_URL_FETCH_TOOL_NAME,
]);

const RAW_PAYLOAD_CITATION_WEB_TOOL_NAMES = new Set<string>([
  CUSTOM_WEB_SEARCH_TOOL_NAME,
  WEB_PAGE_READ_TOOL_NAME,
  RAW_URL_FETCH_TOOL_NAME,
]);

export function isWebCapabilityToolName(toolName: string): boolean {
  return WEB_TOOL_NAMES.has(toolName);
}

export function isCitationBackedWebToolName(toolName: string): boolean {
  return CITATION_BACKED_WEB_TOOL_NAMES.has(toolName);
}

export function isRawPayloadCitationWebToolName(toolName: string): boolean {
  return RAW_PAYLOAD_CITATION_WEB_TOOL_NAMES.has(toolName);
}
