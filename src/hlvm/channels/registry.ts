import { createChannelRuntime } from "./core/runtime.ts";
import { createMessagesTransport } from "./messages/plugin.ts";

export const channelRuntime = createChannelRuntime({
  messages: createMessagesTransport,
});
