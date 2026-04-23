import { getEnvVar } from "../../../common/paths.ts";

export const DEFAULT_TELEGRAM_MANAGER_BOT_USERNAME = "hlvm_setup_helper_2_bot";
export const DEFAULT_TELEGRAM_PROVISIONING_BRIDGE_URL =
  "https://hlvm-telegram-bridge.hlvm.deno.net";

export function resolveTelegramManagerBotUsername(value?: string): string {
  const explicit = typeof value === "string" ? value.trim().replace(/^@+/, "") : "";
  const configured = getEnvVar("HLVM_TELEGRAM_MANAGER_BOT_USERNAME")?.trim().replace(/^@+/, "") ??
    "";
  return explicit || configured || DEFAULT_TELEGRAM_MANAGER_BOT_USERNAME;
}

export function resolveTelegramProvisioningBridgeBaseUrl(value?: string): string | undefined {
  if (value !== undefined) {
    const explicit = value.trim();
    return explicit || undefined;
  }
  return getEnvVar("HLVM_TELEGRAM_PROVISIONING_BRIDGE_URL")?.trim() ||
    DEFAULT_TELEGRAM_PROVISIONING_BRIDGE_URL;
}
