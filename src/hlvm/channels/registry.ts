import { createChannelRuntime } from "./core/runtime.ts";
import { requestGuiChannelTurn } from "./core/gui-turn-bridge.ts";
import { createTelegramProvisioningStateResetter } from "./telegram/provisioning-reset.ts";
import { createTelegramTransport } from "./telegram/transport.ts";

const resetTelegramProvisioningState =
  createTelegramProvisioningStateResetter();

export const channelRuntime = createChannelRuntime({
  telegram: (config) =>
    createTelegramTransport(config, {
      resetProvisioningState: resetTelegramProvisioningState,
    }),
}, {
  runQuery: requestGuiChannelTurn,
});
