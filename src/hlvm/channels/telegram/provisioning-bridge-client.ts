import { RuntimeError } from "../../../common/error.ts";
import { http } from "../../../common/http-client.ts";
import type {
  TelegramProvisioningBridgeClaimFailureReason,
  TelegramProvisioningBridgeClaimRequest,
  TelegramProvisioningBridgeClaimResult,
  TelegramProvisioningBridgeRegistration,
  TelegramProvisioningBridgeResetRequest,
  TelegramProvisioningBridgeResetResult,
  TelegramProvisioningBridgeSessionSnapshot,
} from "./provisioning-bridge-protocol.ts";

interface TelegramProvisioningBridgeClientDeps {
  fetchRaw?: typeof http.fetchRaw;
}

export interface TelegramProvisioningBridgeClient {
  registerSession(
    input: TelegramProvisioningBridgeRegistration,
  ): Promise<TelegramProvisioningBridgeSessionSnapshot>;
  resetState?(
    input: TelegramProvisioningBridgeResetRequest,
    authToken: string,
  ): Promise<TelegramProvisioningBridgeResetResult>;
  claimSession(
    input: TelegramProvisioningBridgeClaimRequest,
    signal?: AbortSignal,
  ): Promise<TelegramProvisioningBridgeClaimResult>;
}

async function parseJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

function createUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl).toString();
}

function asBridgeReason(value: unknown): TelegramProvisioningBridgeClaimFailureReason | null {
  switch (value) {
    case "claimed":
    case "forbidden":
    case "missing":
    case "pending":
      return value;
    default:
      return null;
  }
}

export function createTelegramProvisioningBridgeClient(
  baseUrl: string,
  deps: TelegramProvisioningBridgeClientDeps = {},
): TelegramProvisioningBridgeClient {
  const fetchRaw = deps.fetchRaw ?? ((url, options) => http.fetchRaw(url, options));
  const normalizedBaseUrl = baseUrl.trim();

  return {
    async registerSession(input) {
      const response = await fetchRaw(
        createUrl(normalizedBaseUrl, "/api/telegram/provisioning/session"),
        {
          method: "POST",
          timeout: 30_000,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      if (!response.ok) {
        const body = await parseJson(response);
        throw new RuntimeError(
          typeof body?.error === "string"
            ? body.error
            : "Telegram provisioning bridge registration failed.",
        );
      }
      return await response.json() as TelegramProvisioningBridgeSessionSnapshot;
    },

    async resetState(input, authToken) {
      const response = await fetchRaw(
        createUrl(normalizedBaseUrl, "/api/telegram/provisioning/reset"),
        {
          method: "POST",
          timeout: 30_000,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken.trim()}`,
          },
          body: JSON.stringify(input),
        },
      );
      if (!response.ok) {
        const body = await parseJson(response);
        throw new RuntimeError(
          typeof body?.error === "string"
            ? body.error
            : "Telegram provisioning bridge reset failed.",
        );
      }
      return await response.json() as TelegramProvisioningBridgeResetResult;
    },

    async claimSession(input, signal) {
      const waitMs = Math.max(0, input.waitMs ?? 0);
      const response = await fetchRaw(
        createUrl(normalizedBaseUrl, "/api/telegram/provisioning/session/claim"),
        {
          method: "POST",
          timeout: Math.max(30_000, waitMs + 5_000),
          signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(waitMs > 0 ? input : {
            sessionId: input.sessionId,
            claimToken: input.claimToken,
          }),
        },
      );
      if (response.ok) {
        return await response.json() as TelegramProvisioningBridgeClaimResult;
      }

      const body = await parseJson(response);
      const reason = asBridgeReason(body?.reason);
      if (reason) {
        return { ok: false, reason };
      }

      throw new RuntimeError(
        typeof body?.error === "string"
          ? body.error
          : "Telegram provisioning bridge claim failed.",
      );
    },
  };
}
