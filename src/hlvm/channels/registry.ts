import { createChannelRuntime } from "./core/runtime.ts";
import { createLineTransport } from "./line/transport.ts";
import { createTelegramProvisioningStateResetter } from "./telegram/provisioning-reset.ts";
import { createTelegramTransport } from "./telegram/transport.ts";

const resetTelegramProvisioningState = createTelegramProvisioningStateResetter();

export const channelRuntime = createChannelRuntime({
  line: (config) => createLineTransport(config),
  telegram: (config) =>
    createTelegramTransport(config, {
      resetProvisioningState: resetTelegramProvisioningState,
    }),
});
