import { getEnvVar } from "../../../common/paths.ts";
import { createTelegramProvisioningBridgeClient } from "./provisioning-bridge-client.ts";
import { resolveTelegramManagerBotUsername } from "./config.ts";

export interface TelegramProvisioningStateResetInput {
  deviceId?: string;
  ownerUserId?: number;
}

export type TelegramProvisioningStateResetter = (
  input: TelegramProvisioningStateResetInput,
) => Promise<void>;

export function createTelegramProvisioningStateResetter(): TelegramProvisioningStateResetter {
  return async (input) => {
    const provisioningBridgeBaseUrl = getEnvVar("HLVM_TELEGRAM_PROVISIONING_BRIDGE_URL")?.trim();
    const bridgeAuthToken = getEnvVar("HLVM_TELEGRAM_PROVISIONING_BRIDGE_AUTH_TOKEN")?.trim();
    if (!provisioningBridgeBaseUrl || !bridgeAuthToken) return;

    const managerBotUsername = resolveTelegramManagerBotUsername();
    await createTelegramProvisioningBridgeClient(provisioningBridgeBaseUrl).resetState?.({
      ...(input.deviceId ? { deviceId: input.deviceId } : {}),
      ...(input.ownerUserId !== undefined && managerBotUsername
        ? { ownerUserId: input.ownerUserId, managerBotUsername }
        : {}),
    }, bridgeAuthToken);
  };
}
