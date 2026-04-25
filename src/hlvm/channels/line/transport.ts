import type { ChannelConfig } from "../../../common/config/types.ts";
import { ValidationError } from "../../../common/error.ts";
import { traceChannelDiagnostic } from "../core/trace.ts";
import type {
  ChannelMessage,
  ChannelReply,
  ChannelTransport,
  ChannelTransportContext,
} from "../core/types.ts";
import {
  createLineProvisioningBridgeClient,
  type LineProvisioningBridgeClient,
} from "./provisioning-bridge-client.ts";
import type { LineBridgeMessageEvent } from "./provisioning-bridge-protocol.ts";

interface LineTransportDependencies {
  bridgeClient?: LineProvisioningBridgeClient;
}

interface SseMessage {
  id?: string;
  event?: string;
  data: string;
}

const MAX_SEEN_EVENT_IDS = 1_000;

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function matchesDefaultPairCode(text: string, code: string): boolean {
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*HLVM-${escaped}\\b`, "i").test(text);
}

function traceLineTransport(
  event: string,
  data: Record<string, unknown>,
): void {
  traceChannelDiagnostic("line", "transport", event, data);
}

function toChannelMessage(event: LineBridgeMessageEvent): ChannelMessage {
  return {
    channel: "line",
    remoteId: event.userId,
    text: event.text,
    sender: {
      id: event.userId,
    },
    raw: event.raw ?? event,
  };
}

async function* readSseMessages(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<SseMessage, void, unknown> {
  const decoder = new TextDecoder();
  let buffer = "";
  let event: string | undefined;
  let id: string | undefined;
  let data = "";

  function flush(): SseMessage | null {
    if (!data) return null;
    const message = {
      ...(id ? { id } : {}),
      ...(event ? { event } : {}),
      data: data.endsWith("\n") ? data.slice(0, -1) : data,
    };
    event = undefined;
    id = undefined;
    data = "";
    return message;
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      const message = flush();
      if (message) yield message;
      return;
    }
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const rawLine = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (!line) {
        const message = flush();
        if (message) yield message;
        continue;
      }
      if (line.startsWith(":")) continue;
      const colonIndex = line.indexOf(":");
      const field = colonIndex >= 0 ? line.slice(0, colonIndex) : line;
      const rawValue = colonIndex >= 0 ? line.slice(colonIndex + 1) : "";
      const fieldValue = rawValue.startsWith(" ")
        ? rawValue.slice(1)
        : rawValue;
      if (field === "event") event = fieldValue;
      if (field === "id") id = fieldValue;
      if (field === "data") data += `${fieldValue}\n`;
    }
  }
}

function parseLineEvent(message: SseMessage): LineBridgeMessageEvent | null {
  if (message.event && message.event !== "line_message") return null;
  try {
    const parsed = JSON.parse(message.data) as LineBridgeMessageEvent;
    return parsed?.type === "message" && typeof parsed.userId === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function createLineTransport(
  config: ChannelConfig,
  dependencies: LineTransportDependencies = {},
): ChannelTransport {
  const bridgeUrl = trimString(config.transport?.bridgeUrl);
  const deviceId = trimString(config.transport?.deviceId);
  const clientToken = trimString(config.transport?.clientToken);
  const bridgeClient = dependencies.bridgeClient ??
    (bridgeUrl ? createLineProvisioningBridgeClient(bridgeUrl) : undefined);

  let abortController: AbortController | null = null;
  let streamTask: Promise<void> | null = null;
  const seenEventIds = new Set<string>();
  const seenEventOrder: string[] = [];

  function rememberEventId(id: string): boolean {
    if (seenEventIds.has(id)) return false;
    seenEventIds.add(id);
    seenEventOrder.push(id);
    while (seenEventOrder.length > MAX_SEEN_EVENT_IDS) {
      const oldest = seenEventOrder.shift();
      if (oldest) seenEventIds.delete(oldest);
    }
    return true;
  }

  async function runEventStream(
    context: ChannelTransportContext,
    signal: AbortSignal,
  ): Promise<void> {
    if (!bridgeClient) {
      throw new ValidationError(
        "LINE relay transport requires channels.line.transport.bridgeUrl.",
        "line_transport",
      );
    }
    const response = await bridgeClient.streamEvents(
      { deviceId, clientToken },
      signal,
    );
    const reader = response.body?.getReader();
    if (!reader) {
      throw new ValidationError(
        "LINE bridge returned no event stream.",
        "line_transport",
      );
    }

    try {
      context.setStatus({ state: "connected", lastError: null });
      traceLineTransport("stream-connected", { deviceId });
      for await (const message of readSseMessages(reader)) {
        if (signal.aborted) return;
        const event = parseLineEvent(message);
        if (!event) continue;
        if (!rememberEventId(event.id)) {
          traceLineTransport("duplicate-event-dropped", {
            id: event.id,
            userId: event.userId,
          });
          continue;
        }
        traceLineTransport("event-received", {
          id: event.id,
          userId: event.userId,
          textLength: event.text.length,
        });
        await context.receive(toChannelMessage(event));
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }

  return {
    channel: "line",

    matchesPairCode(message, code) {
      const matched = matchesDefaultPairCode(message.text, code);
      traceLineTransport(matched ? "pair-code-match" : "pair-code-miss", {
        remoteId: message.remoteId,
        textLength: message.text.length,
      });
      return matched;
    },

    async start(context: ChannelTransportContext): Promise<void> {
      if (config.transport?.mode !== "relay") {
        throw new ValidationError(
          'LINE transport currently supports only channels.line.transport.mode = "relay".',
          "line_transport",
        );
      }
      if (!bridgeUrl || !deviceId || !clientToken) {
        throw new ValidationError(
          "LINE relay transport requires bridgeUrl, deviceId, and clientToken.",
          "line_transport",
        );
      }

      traceLineTransport("start", { deviceId, bridgeConfigured: !!bridgeUrl });
      abortController = new AbortController();
      streamTask = runEventStream(context, abortController.signal).catch(
        (error) => {
          if (abortController?.signal.aborted) return;
          const detail = error instanceof Error ? error.message : String(error);
          context.setStatus({ state: "error", lastError: detail });
          traceLineTransport("stream-error", { detail });
        },
      );
    },

    async send(message: ChannelReply): Promise<void> {
      if (!bridgeClient) {
        throw new ValidationError(
          "LINE relay transport requires channels.line.transport.bridgeUrl.",
          "line_transport",
        );
      }
      traceLineTransport("send-start", {
        deviceId,
        remoteId: message.remoteId,
        textLength: message.text.length,
      });
      await bridgeClient.sendMessage({
        deviceId,
        clientToken,
        to: message.remoteId,
        text: message.text,
      });
      traceLineTransport("send-done", { deviceId, remoteId: message.remoteId });
    },

    async stop(): Promise<void> {
      traceLineTransport("stop", { deviceId });
      abortController?.abort();
      abortController = null;
      await streamTask?.catch(() => undefined);
      streamTask = null;
    },
  };
}
