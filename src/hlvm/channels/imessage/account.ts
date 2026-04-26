import { RuntimeError } from "../../../common/error.ts";
import { getPlatform } from "../../../platform/platform.ts";

const MOBILE_ME_ACCOUNTS_PLIST = "Library/Preferences/MobileMeAccounts.plist";
const MESSAGES_PREFS_PLIST = "Library/Preferences/com.apple.madrid.plist";
const IMESSAGE_SERVICE_ID = "com.apple.Dataclass.Messages";

const textDecoder = new TextDecoder();

export interface IMessageAccountIdentity {
  recipientId: string;
  recipientIds: string[];
}

export async function resolveIMessageAccountIdentity(): Promise<
  IMessageAccountIdentity | undefined
> {
  const aliases = await resolveIMessageAliasesFromMessagesPreferences().catch(
    () => [],
  );
  const accountId = await resolveIMessageRecipientIdFromMacAccounts().catch(
    () => undefined,
  );
  const recipientIds = orderPreferredIMessageRecipientIds(
    normalizeAccountIds([...aliases, accountId]),
  );
  const recipientId = recipientIds[0];
  return recipientId ? { recipientId, recipientIds } : undefined;
}

export async function resolveIMessageRecipientIdFromMacAccounts(): Promise<
  string | undefined
> {
  const platform = getPlatform();
  const home = platform.env.get("HOME");
  if (!home) return undefined;

  const plistPath = platform.path.join(home, MOBILE_ME_ACCOUNTS_PLIST);
  const result = await platform.command.output({
    cmd: ["plutil", "-convert", "json", "-o", "-", plistPath],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    timeout: 5_000,
  });

  if (!result.success) {
    const detail = textDecoder.decode(result.stderr).trim();
    throw new RuntimeError(
      detail
        ? `Could not read macOS iMessage account: ${detail}`
        : "Could not read macOS iMessage account.",
    );
  }

  try {
    const payload = JSON.parse(textDecoder.decode(result.stdout)) as unknown;
    return selectIMessageRecipientIdFromMacAccountsPayload(payload) ??
      undefined;
  } catch (error) {
    throw new RuntimeError(
      "Could not parse macOS iMessage account data.",
      { originalError: error instanceof Error ? error : undefined },
    );
  }
}

export async function resolveIMessageAliasesFromMessagesPreferences(): Promise<
  string[]
> {
  const platform = getPlatform();
  const home = platform.env.get("HOME");
  if (!home) return [];

  const plistPath = platform.path.join(home, MESSAGES_PREFS_PLIST);
  const result = await platform.command.output({
    cmd: ["plutil", "-convert", "json", "-o", "-", plistPath],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    timeout: 5_000,
  });

  if (!result.success) {
    const detail = textDecoder.decode(result.stderr).trim();
    throw new RuntimeError(
      detail
        ? `Could not read macOS Messages aliases: ${detail}`
        : "Could not read macOS Messages aliases.",
    );
  }

  try {
    const payload = JSON.parse(textDecoder.decode(result.stdout)) as unknown;
    return selectIMessageAliasesFromMessagesPreferencesPayload(payload);
  } catch (error) {
    throw new RuntimeError(
      "Could not parse macOS Messages aliases.",
      { originalError: error instanceof Error ? error : undefined },
    );
  }
}

export function selectIMessageRecipientIdFromMacAccountsPayload(
  payload: unknown,
): string | null {
  if (!isRecord(payload) || !Array.isArray(payload.Accounts)) return null;

  for (const account of payload.Accounts) {
    if (!isRecord(account)) continue;
    if (!accountHasIMessageService(account)) continue;
    const accountId = firstNonEmptyString(
      account.AccountID,
      account.AccountDescription,
      account.DisplayName,
    );
    if (accountId) return accountId;
  }

  return null;
}

export function selectIMessageAliasesFromMessagesPreferencesPayload(
  payload: unknown,
): string[] {
  if (!isRecord(payload)) return [];
  const aliases = payload["IMD-IDS-Aliases"];
  if (!isRecord(aliases)) return [];

  const selected = normalizeAccountIds(aliases.selectedAliases);
  if (selected.length > 0) return orderPreferredIMessageRecipientIds(selected);
  return orderPreferredIMessageRecipientIds(
    normalizeAccountIds(aliases.allAliases),
  );
}

function normalizeAccountIds(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of values) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

export function orderPreferredIMessageRecipientIds(
  recipientIds: string[],
): string[] {
  const emailIds = recipientIds.filter((id) => id.includes("@"));
  const phoneOrHandleIds = recipientIds.filter((id) => !id.includes("@"));
  return [...phoneOrHandleIds, ...emailIds];
}

function accountHasIMessageService(account: Record<string, unknown>): boolean {
  const services = account.Services;
  if (!Array.isArray(services)) return false;

  return services.some((service) => {
    if (!isRecord(service)) return false;
    return service.ServiceID === IMESSAGE_SERVICE_ID ||
      service.Name === "MESSAGES";
  });
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
