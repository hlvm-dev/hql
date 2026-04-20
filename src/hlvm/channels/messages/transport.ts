import type { ChannelConfig } from "../../../common/config/types.ts";
import type {
  ChannelTransport,
  ChannelTransportContext,
} from "../core/types.ts";
import * as bridge from "./bridge.ts";

export function createMessagesTransport(
  _config: ChannelConfig,
): ChannelTransport {
  return {
    channel: "messages",
    async start(context: ChannelTransportContext): Promise<void> {
      bridge.setActiveContext(context);
    },
    async send(reply): Promise<void> {
      bridge.emitOutbox(reply);
    },
    async stop(): Promise<void> {
      bridge.clearActiveContext();
    },
  };
}
