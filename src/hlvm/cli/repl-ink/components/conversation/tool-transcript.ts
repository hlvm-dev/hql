import {
  getTool,
  hasTool,
  type FormattedToolTranscriptResult,
  type ToolProgressTone,
  type ToolTranscriptAdapter,
  type ToolTranscriptCallSummary,
  type ToolTranscriptProgressEvent,
  type ToolTranscriptResultEvent,
} from "../../../../agent/registry.ts";
import {
  FETCH_URL_TRANSCRIPT_ADAPTER,
  WEB_FETCH_TRANSCRIPT_ADAPTER,
  WEB_SEARCH_TRANSCRIPT_ADAPTER,
} from "../../../../agent/tools/web-tools.ts";

type InvocationToolLike = {
  name: string;
  displayName?: string;
  argsSummary: string;
};

const FALLBACK_TRANSCRIPT_ADAPTERS = new Map<string, ToolTranscriptAdapter>([
  ["search_web", WEB_SEARCH_TRANSCRIPT_ADAPTER],
  ["web_fetch", WEB_FETCH_TRANSCRIPT_ADAPTER],
  ["fetch_url", FETCH_URL_TRANSCRIPT_ADAPTER],
]);

function getTranscriptAdapter(
  toolName: string,
  ownerId?: string,
): ToolTranscriptAdapter | undefined {
  if (hasTool(toolName, ownerId)) {
    return getTool(toolName, ownerId).transcript;
  }
  return FALLBACK_TRANSCRIPT_ADAPTERS.get(toolName);
}

function resolveAdapterDisplayName(
  adapter: ToolTranscriptAdapter | undefined,
): string | undefined {
  const displayName = adapter?.displayName;
  if (typeof displayName === "function") {
    const resolved = displayName(undefined);
    return resolved?.trim() ? resolved.trim() : undefined;
  }
  return displayName?.trim() ? displayName.trim() : undefined;
}

function sanitizeQuotedArg(value: string): string {
  return value.replaceAll('"', "'");
}

export function resolveToolTranscriptDisplayName(
  toolName: string,
  ownerId?: string,
): string {
  return resolveAdapterDisplayName(getTranscriptAdapter(toolName, ownerId)) ??
    toolName;
}

export function buildToolTranscriptInvocationLabel(
  tool: InvocationToolLike,
): string {
  const displayName = tool.displayName?.trim() || tool.name;
  const argsSummary = tool.argsSummary.trim();
  if (!argsSummary) return displayName;

  if (
    tool.name === "search_web" ||
    tool.name === "web_fetch" ||
    tool.name === "fetch_url"
  ) {
    return `${displayName}("${sanitizeQuotedArg(argsSummary)}")`;
  }

  return `${displayName} ${argsSummary}`;
}

export function resolveToolTranscriptProgress(
  toolName: string,
  event: ToolTranscriptProgressEvent,
  ownerId?: string,
): { message: string; tone: ToolProgressTone } | undefined {
  const adapter = getTranscriptAdapter(toolName, ownerId);
  const formatted = adapter?.formatProgress?.(event) ?? null;
  if (formatted?.message?.trim()) {
    return {
      message: formatted.message.trim(),
      tone: formatted.tone ?? event.tone,
    };
  }
  const fallbackMessage = event.message.trim();
  return fallbackMessage
    ? { message: fallbackMessage, tone: event.tone }
    : undefined;
}

export function resolveToolTranscriptResult(
  toolName: string,
  event: ToolTranscriptResultEvent,
  ownerId?: string,
): FormattedToolTranscriptResult {
  const adapter = getTranscriptAdapter(toolName, ownerId);
  const formatted = adapter?.formatResult?.(event) ?? null;
  if (formatted) {
    return {
      summaryText: formatted.summaryText ?? event.summary ?? event.content,
      detailText: formatted.detailText ?? event.content,
    };
  }
  return {
    summaryText: event.summary ?? event.content,
    detailText: event.content,
  };
}

export function resolveToolTranscriptGroupSummary(
  toolName: string,
  calls: readonly ToolTranscriptCallSummary[],
  ownerId?: string,
): string | undefined {
  const adapter = getTranscriptAdapter(toolName, ownerId);
  const summary = adapter?.formatGroupSummary?.(calls) ?? null;
  return summary?.trim() ? summary.trim() : undefined;
}
