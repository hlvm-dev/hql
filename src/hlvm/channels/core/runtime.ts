import { type ChannelConfig } from "../../../common/config/types.ts";
import { loadConfig } from "../../../common/config/storage.ts";
import { config } from "../../api/config.ts";
import { log } from "../../api/log.ts";
import { runAgentQuery } from "../../agent/agent-runner.ts";
import type { AgentExecutionMode } from "../../agent/execution-mode.ts";
import { createSessionQueue } from "./queue.ts";
import { formatChannelSessionId } from "./session-key.ts";
import type {
  ChannelRuntimeDependencies,
  ChannelStatus,
  ChannelTransport,
  ChannelTransportFactory,
  ChannelMessage,
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
    const result = await runAgentQuery({
      query: options.query,
      sessionId: options.sessionId,
      querySource: options.querySource,
      permissionMode: options.permissionMode,
      noInput: options.noInput,
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

  // Anchored to start-of-message (allowing leading whitespace) with a
  // word boundary after the digits. Rejects "got it, HLVM-1234 sent to
  // you" (doesn't start with HLVM) and "HLVM-12345" (\b fails after the
  // 4th digit). The 4-digit code has no regex metachars but we escape
  // defensively in case the contract loosens later.
  function pairPattern(code: string): RegExp {
    const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^\\s*HLVM-${escaped}\\b`);
  }

  async function performPairing(
    transport: ChannelTransport,
    channel: string,
    message: ChannelMessage,
    senderId: string,
  ): Promise<void> {
    try {
      // Record the paired sender via the single-writer config path.
      // Merge-preserve sibling channels (shallow merge in
      // mergeConfigUpdates drops other channels otherwise).
      const current = await loadRuntimeConfig();
      const existingChannels = current.channels ?? {};
      const existingChannel = existingChannels[channel] ?? {};
      await patchConfig({
        channels: {
          ...existingChannels,
          [channel]: {
            ...existingChannel,
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
    if (!message.text.trim()) return;
    const channel = message.channel || transport.channel;

    const config = await loadRuntimeConfig();
    const allowed = config.channels?.[channel]?.allowedIds ?? [];
    const senderId = message.sender?.id ?? message.remoteId;

    // Pair-code short-circuit: only runs when allowlist is empty AND a
    // code is armed. A populated allowlist always wins even if a code
    // happens to be armed — this prevents an old code from bypassing
    // the allowlist.
    if (allowed.length === 0) {
      const armedCode = pairingCodes.get(channel);
      if (armedCode && pairPattern(armedCode).test(message.text)) {
        await performPairing(transport, channel, message, senderId);
        return;
      }
      log.warn?.(`Channel ${channel} rejected unknown sender ${senderId}`);
      return;
    }

    if (!allowed.includes(senderId)) {
      log.warn?.(`Channel ${channel} rejected unknown sender ${senderId}`);
      return;
    }

    const sessionId = formatChannelSessionId(channel, message.remoteId);

    try {
      await queue.run(sessionId, async () => {
        const result = await runQuery({
          query: message.text,
          sessionId,
          querySource: `channel:${channel}`,
          permissionMode: resolveRemotePermissionMode(config.permissionMode),
          noInput: true,
        });
        await transport.send({
          channel,
          remoteId: message.remoteId,
          sessionId,
          text: result.text,
          replyTo: message.raw,
        });
        setStatus(channel, { state: "connected", lastError: null });
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setStatus(channel, { state: "error", lastError: detail });
      log.warn?.(`Channel ${channel} failed to handle inbound message: ${detail}`);
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
    for (const [channel, channelConfig] of Object.entries(config.channels ?? {})) {
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
          // mergeConfigUpdates in api/config.ts does a shallow merge, so we
          // must spread existing channels here or a sibling channel
          // (e.g. telegram) would be dropped when messages updates its cursor.
          updateConfig: async (channelPatch) => {
            const current = await loadRuntimeConfig();
            const existingChannels = current.channels ?? {};
            const existingChannel = existingChannels[channel] ?? {};
            await patchConfig({
              channels: {
                ...existingChannels,
                [channel]: { ...existingChannel, ...channelPatch },
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
