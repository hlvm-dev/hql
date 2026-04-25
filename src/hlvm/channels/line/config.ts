import { getEnvVar } from "../../../common/paths.ts";

const DEFAULT_LINE_SESSION_TTL_MS = 10 * 60 * 1000;

export function resolveLineProvisioningBridgeBaseUrl(value?: string): string | undefined {
  const raw = value ?? getEnvVar("HLVM_LINE_PROVISIONING_BRIDGE_URL");
  const trimmed = raw?.trim();
  return trimmed ? trimmed.replace(/\/+$/, "") : undefined;
}

export function resolveLineOfficialAccountId(value?: string): string | undefined {
  const raw = value ?? getEnvVar("HLVM_LINE_OFFICIAL_ACCOUNT_ID");
  const trimmed = raw?.trim();
  return trimmed || undefined;
}

export function resolveLineProvisioningSessionTtlMs(value?: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_LINE_SESSION_TTL_MS;
}
