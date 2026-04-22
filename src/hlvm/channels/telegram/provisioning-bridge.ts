export function buildTelegramManagedBotCreateUrl(
  managerBotUsername: string,
  botUsername: string,
  botName: string,
): string {
  const url = new URL(`https://t.me/newbot/${managerBotUsername}/${botUsername}`);
  url.searchParams.set("name", botName);
  return url.toString();
}

export function buildTelegramProvisioningBridgeUrl(
  baseUrl: string,
  sessionId: string,
): string {
  const url = new URL("/telegram/start", baseUrl);
  url.searchParams.set("session", sessionId);
  return url.toString();
}
