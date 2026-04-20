import type {
  ChannelConfig,
  ChannelTransportMode,
  HlvmConfig,
} from "../../../common/config/types.ts";
import type { AgentExecutionMode } from "../../agent/execution-mode.ts";

export interface ChannelMessage {
  channel: string;
  remoteId: string;
  text: string;
  sender?: {
    id: string;
    display?: string;
  };
  raw?: unknown;
}

export interface ChannelReply {
  channel: string;
  remoteId: string;
  sessionId: string;
  text: string;
  replyTo?: unknown;
}

export type ChannelConnectionState =
  | "connected"
  | "connecting"
  | "disabled"
  | "disconnected"
  | "error"
  | "unsupported";

export interface ChannelStatus {
  channel: string;
  configured: boolean;
  enabled: boolean;
  state: ChannelConnectionState;
  mode?: ChannelTransportMode;
  allowedIds: string[];
  lastError: string | null;
}

export interface ChannelTransportContext {
  receive(message: ChannelMessage): Promise<void>;
  setStatus(status: Partial<ChannelStatus> & Pick<ChannelStatus, "state">): void;
  updateConfig(patch: Partial<ChannelConfig>): Promise<void>;
}

export interface ChannelTransport {
  readonly channel: string;
  start(context: ChannelTransportContext): Promise<void>;
  send(message: ChannelReply): Promise<void>;
  stop(): Promise<void>;
}

export type ChannelTransportFactory = (
  config: ChannelConfig,
) => ChannelTransport;

export interface ChannelRuntimeDependencies {
  loadConfig: () => Promise<HlvmConfig>;
  runQuery: (options: {
    query: string;
    sessionId: string;
    querySource: string;
    permissionMode: AgentExecutionMode;
    noInput: boolean;
  }) => Promise<{ text: string }>;
  patchConfig: (
    updates: Partial<HlvmConfig>,
  ) => Promise<HlvmConfig>;
}
