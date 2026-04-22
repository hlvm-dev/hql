import { createChannelRuntime } from "./core/runtime.ts";
import { createTelegramTransport } from "./telegram/transport.ts";

export const channelRuntime = createChannelRuntime({
  telegram: createTelegramTransport,
});
