import { type ChannelConfig } from "../../../common/config/types.ts";
import { loadConfig } from "../../../common/config/storage.ts";
import { config } from "../../api/config.ts";
import { log } from "../../api/log.ts";
import type { AgentExecutionMode } from "../../agent/execution-mode.ts";
import { runChatViaHost } from "../../runtime/host-client.ts";
import { createSessionQueue } from "./queue.ts";
import { formatChannelSessionId } from "./session-key.ts";
import type {
  ChannelMessage,
  ChannelRuntimeDependencies,
  ChannelStatus,
  ChannelTransport,
  ChannelTransportFactory,
} from "./types.ts";

function cloneChannelStatus(status: ChannelStatus): ChannelStatus {
  return {
    ...status,
    allowedIds: [...status.allowedIds],
  };
}

function buildChannelStatus(
  channel: string,
  config: ChannelConfig | undefined,
): ChannelStatus {
  const enabled = config?.enabled === true;
  return {
    channel,
    configured: config !== undefined,
    enabled,
    state: enabled ? "unsupported" : "disabled",
    mode: config?.transport?.mode,
    allowedIds: [...(config?.allowedIds ?? [])],
    lastError: null,
  };
}

function resolveRemotePermissionMode(
  configuredMode: AgentExecutionMode | undefined,
): AgentExecutionMode {
  switch (configuredMode) {
    case "plan":
    case "dontAsk":
    case "default":
      return configuredMode;
    default:
      return "default";
  }
}

function traceChannelRuntime(
  event: string,
  data: Record<string, unknown>,
): void {
  log.ns("channels").debug(`[runtime] ${event} ${JSON.stringify(data)}`);
}

export function createChannelRuntime(
  transportFactories: Record<string, ChannelTransportFactory> = {},
  dependencies: Partial<ChannelRuntimeDependencies> = {},
) {
  const queue = createSessionQueue();
  const statuses = new Map<string, ChannelStatus>();
  const transports = new Map<string, ChannelTransport>();
  // In-memory only — a fresh onboarding window always generates a new
  // code, and server restart should invalidate any armed code.
  const pairingCodes = new Map<string, string>();
  const loadRuntimeConfig = dependencies.loadConfig ?? loadConfig;
  const patchConfig = dependencies.patchConfig ?? config.patch;
  const runQuery = dependencies.runQuery ?? (async (options) => {
    const result = await runChatViaHost({
      mode: "chat",
      querySource: options.querySource,
      messages: [{
        role: "user",
        content: options.query,
        client_turn_id: crypto.randomUUID(),
      }],
      permissionMode: options.permissionMode,
      callbacks: {},
    });
    return { text: result.text };
  });

  type StatusListener = (statuses: ChannelStatus[]) => void;
  const listeners = new Set<StatusListener>();

  function snapshotStatuses(): ChannelStatus[] {
    return [...statuses.values()]
      .map(cloneChannelStatus)
      .sort((left, right) => left.channel.localeCompare(right.channel));
  }

  function emitChange(): void {
    if (listeners.size === 0) return;
    const snapshot = snapshotStatuses();
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        log.warn?.(`reachability listener threw: ${detail}`);
      }
    }
  }

  function setStatus(
    channel: string,
    patch: Partial<ChannelStatus> & Pick<ChannelStatus, "state">,
  ): void {
    const next = {
      ...buildChannelStatus(channel, undefined),
      ...statuses.get(channel),
      ...patch,
    };
    statuses.set(channel, next);
    emitChange();
  }

  function defaultPairPattern(code: string): RegExp {
    const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^\\s*HLVM-${escaped}\\b`);
  }

  async function matchesPairCode(
    transport: ChannelTransport,
    message: ChannelMessage,
    code: string,
  ): Promise<boolean> {
    if (transport.matchesPairCode) {
      return await transport.matchesPairCode(message, code);
    }
    return defaultPairPattern(code).test(message.text);
  }

  async function performPairing(
    transport: ChannelTransport,
    channel: string,
    message: ChannelMessage,
    senderId: string,
  ): Promise<void> {
    try {
      traceChannelRuntime("pair-code-accepted", {
        channel,
        remoteId: message.remoteId,
        senderId,
      });
      await patchConfig({
        channels: {
          [channel]: {
            allowedIds: [senderId],
          },
        },
      });
      pairingCodes.delete(channel);
      // Triggers the reachability SSE snapshot so the onboarding window
      // sees the channel flip to connected with a populated allowlist.
      setStatus(channel, { state: "connected", lastError: null });
      // Canned confirmation reply — short-circuits runAgentQuery so the
      // pair-code message doesn't burn an agent turn. The real
      // conversation starts on the user's next message.
      await transport.send({
        channel,
        remoteId: message.remoteId,
        sessionId: formatChannelSessionId(channel, message.remoteId),
        text: "✨ You're in. Text me anytime.",
        replyTo: message.raw,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setStatus(channel, { state: "error", lastError: detail });
      log.warn?.(`Channel ${channel} pair-code handling failed: ${detail}`);
    }
  }

  async function handleInboundMessage(
    transport: ChannelTransport,
    message: ChannelMessage,
  ): Promise<void> {
    const channel = message.channel || transport.channel;
    const trimmedText = message.text.trim();

    const config = await loadRuntimeConfig();
    const allowed = config.channels?.[channel]?.allowedIds ?? [];
    const senderId = message.sender?.id ?? message.remoteId;

    traceChannelRuntime("inbound-received", {
      channel,
      remoteId: message.remoteId,
      senderId,
      allowedCount: allowed.length,
      hasText: trimmedText.length > 0,
      textLength: message.text.length,
    });

    // Pair-code short-circuit: only runs when allowlist is empty AND a
    // code is armed. A populated allowlist always wins even if a code
    // happens to be armed — this prevents an old code from bypassing
    // the allowlist.
    if (allowed.length === 0) {
      const armedCode = pairingCodes.get(channel);
      if (armedCode) {
        try {
          if (await matchesPairCode(transport, message, armedCode)) {
            await performPairing(transport, channel, message, senderId);
            return;
          }
          traceChannelRuntime("pair-code-rejected", {
            channel,
            remoteId: message.remoteId,
            senderId,
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          setStatus(channel, { state: "error", lastError: detail });
          log.warn?.(`Channel ${channel} pair-code match failed: ${detail}`);
          return;
        }
      }
      if (!trimmedText) {
        traceChannelRuntime("inbound-dropped", {
          channel,
          remoteId: message.remoteId,
          senderId,
          reason: "empty_text_unpaired",
        });
        return;
      }
      traceChannelRuntime("inbound-rejected", {
        channel,
        remoteId: message.remoteId,
        senderId,
        reason: "no_allowed_sender",
      });
      log.warn?.(`Channel ${channel} rejected unknown sender ${senderId}`);
      return;
    }

    if (!allowed.includes(senderId)) {
      traceChannelRuntime("inbound-rejected", {
        channel,
        remoteId: message.remoteId,
        senderId,
        reason: "sender_not_allowed",
        allowedCount: allowed.length,
      });
      log.warn?.(`Channel ${channel} rejected unknown sender ${senderId}`);
      return;
    }
    if (!trimmedText) {
      traceChannelRuntime("inbound-dropped", {
        channel,
        remoteId: message.remoteId,
        senderId,
        reason: "empty_text",
      });
      return;
    }

    const sessionId = formatChannelSessionId(channel, message.remoteId);

    traceChannelRuntime("inbound-accepted", {
      channel,
      remoteId: message.remoteId,
      senderId,
      sessionId,
    });

    try {
      await queue.run(sessionId, async () => {
        traceChannelRuntime("run-query-start", {
          channel,
          remoteId: message.remoteId,
          senderId,
          sessionId,
        });
        const result = await runQuery({
          query: message.text,
          sessionId,
          querySource: `channel:${channel}`,
          permissionMode: resolveRemotePermissionMode(config.permissionMode),
          noInput: true,
        });
        traceChannelRuntime("run-query-done", {
          channel,
          remoteId: message.remoteId,
          senderId,
          sessionId,
          textLength: result.text.length,
        });
        await transport.send({
          channel,
          remoteId: message.remoteId,
          sessionId,
          text: result.text,
          replyTo: message.raw,
        });
        traceChannelRuntime("reply-sent", {
          channel,
          remoteId: message.remoteId,
          senderId,
          sessionId,
          textLength: result.text.length,
        });
        setStatus(channel, { state: "connected", lastError: null });
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setStatus(channel, { state: "error", lastError: detail });
      log.warn?.(
        `Channel ${channel} failed to handle inbound message: ${detail}`,
      );
    }
  }

  async function stopActiveTransports(): Promise<void> {
    const active = [...transports.entries()];
    transports.clear();
    await Promise.all(active.map(async ([channel, transport]) => {
      try {
        await transport.stop();
        const current = statuses.get(channel);
        if (current?.enabled) {
          setStatus(channel, { state: "disconnected" });
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        setStatus(channel, { state: "error", lastError: detail });
      }
    }));
  }

  async function reconfigureImpl(): Promise<void> {
    await stopActiveTransports();
    statuses.clear();

    const config = await loadRuntimeConfig();
    for (
      const [channel, channelConfig] of Object.entries(config.channels ?? {})
    ) {
      setStatus(channel, buildChannelStatus(channel, channelConfig));

      if (!channelConfig.enabled) {
        continue;
      }

      const createTransport = transportFactories[channel];
      if (!createTransport) {
        continue;
      }

      const transport = createTransport(channelConfig);
      transports.set(channel, transport);
      setStatus(channel, { state: "connecting" });

      try {
        await transport.start({
          receive: (message) => handleInboundMessage(transport, message),
          setStatus: (status) => setStatus(channel, status),
          updateConfig: async (channelPatch) => {
            await patchConfig({
              channels: {
                [channel]: channelPatch,
              },
            });
          },
        });
        const current = statuses.get(channel);
        if (current?.state === "connecting") {
          setStatus(channel, { state: "connected" });
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        setStatus(channel, { state: "error", lastError: detail });
        log.warn?.(`Channel ${channel} failed to start: ${detail}`);
      }
    }
  }

  // Serialize concurrent reconfigure calls so two rebinds can't both
  // clear transports and race into double-start.
  let reconfigureChain: Promise<void> = Promise.resolve();

  return {
    reconfigure(): Promise<void> {
      const run = reconfigureChain.then(reconfigureImpl);
      reconfigureChain = run.catch(() => {});
      return run;
    },

    async stop(): Promise<void> {
      await stopActiveTransports();
    },

    listStatuses(): ChannelStatus[] {
      return snapshotStatuses();
    },

    getStatus(channel: string): ChannelStatus | null {
      const status = statuses.get(channel);
      return status ? cloneChannelStatus(status) : null;
    },

    reportStatus(
      channel: string,
      status: Partial<ChannelStatus> & Pick<ChannelStatus, "state">,
    ): void {
      setStatus(channel, status);
    },

    subscribe(listener: StatusListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    armPairCode(channel: string, code: string): void {
      pairingCodes.set(channel, code);
    },

    disarmPairCode(channel: string): void {
      pairingCodes.delete(channel);
    },

    // Exposed for tests + the HTTP handler's 409 check.
    hasPairCodeArmed(channel: string): boolean {
      return pairingCodes.has(channel);
    },
  };
}
