import { RuntimeError } from "../../../common/error.ts";
import { http } from "../../../common/http-client.ts";
import { traceChannelDiagnostic } from "../core/trace.ts";
import type {
  LineBridgeSendMessageRequest,
  LineBridgeSendMessageResult,
  LineProvisioningBridgeRegistration,
  LineProvisioningBridgeSessionSnapshot,
} from "./provisioning-bridge-protocol.ts";

interface LineProvisioningBridgeClientDeps {
  fetchRaw?: typeof http.fetchRaw;
}

function traceLineBridgeClient(
  event: string,
  data: Record<string, unknown>,
): void {
  traceChannelDiagnostic("line", "bridge-client", event, data);
}

export interface LineProvisioningBridgeClient {
  registerSession(
    input: LineProvisioningBridgeRegistration,
  ): Promise<LineProvisioningBridgeSessionSnapshot>;
  streamEvents(
    input: { deviceId: string; clientToken: string },
    signal: AbortSignal,
  ): Promise<Response>;
  sendMessage(
    input: LineBridgeSendMessageRequest,
  ): Promise<LineBridgeSendMessageResult>;
}

async function parseJson(
  response: Response,
): Promise<Record<string, unknown> | null> {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

function createUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl).toString();
}

function createEventsUrl(
  baseUrl: string,
  input: { deviceId: string; clientToken: string },
): string {
  const url = new URL(createUrl(baseUrl, "/api/line/events"));
  url.searchParams.set("deviceId", input.deviceId);
  url.searchParams.set("clientToken", input.clientToken);
  return url.toString();
}

async function parseBridgeFailure(
  response: Response,
  fallback: string,
): Promise<never> {
  const body = await parseJson(response);
  throw new RuntimeError(
    typeof body?.error === "string" ? body.error : fallback,
  );
}

export function createLineProvisioningBridgeClient(
  baseUrl: string,
  deps: LineProvisioningBridgeClientDeps = {},
): LineProvisioningBridgeClient {
  const fetchRaw = deps.fetchRaw ??
    ((url, options) => http.fetchRaw(url, options));
  const normalizedBaseUrl = baseUrl.trim();

  return {
    async registerSession(input) {
      traceLineBridgeClient("register-session-start", {
        sessionId: input.sessionId,
        deviceId: input.deviceId,
        officialAccountIdConfigured: !!input.officialAccountId,
      });
      let response: Response;
      try {
        response = await fetchRaw(
          createUrl(normalizedBaseUrl, "/api/line/provisioning/session"),
          {
            method: "POST",
            timeout: 30_000,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
      } catch (error) {
        traceLineBridgeClient("register-session-error", {
          sessionId: input.sessionId,
          deviceId: input.deviceId,
          detail: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      if (!response.ok) {
        traceLineBridgeClient("register-session-failed", {
          sessionId: input.sessionId,
          deviceId: input.deviceId,
          status: response.status,
        });
        await parseBridgeFailure(
          response,
          "LINE provisioning bridge registration failed.",
        );
      }
      const result = await response
        .json() as LineProvisioningBridgeSessionSnapshot;
      traceLineBridgeClient("register-session-done", {
        sessionId: result.sessionId,
        state: result.state,
      });
      return result;
    },

    async streamEvents(input, signal) {
      traceLineBridgeClient("stream-events-start", {
        deviceId: input.deviceId,
      });
      let response: Response;
      try {
        response = await fetchRaw(
          createEventsUrl(normalizedBaseUrl, input),
          {
            method: "GET",
            timeout: 24 * 60 * 60 * 1000,
            signal,
            headers: { Accept: "text/event-stream" },
          },
        );
      } catch (error) {
        traceLineBridgeClient("stream-events-error", {
          deviceId: input.deviceId,
          detail: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      if (!response.ok) {
        traceLineBridgeClient("stream-events-failed", {
          deviceId: input.deviceId,
          status: response.status,
        });
        await parseBridgeFailure(response, "LINE bridge event stream failed.");
      }
      traceLineBridgeClient("stream-events-open", { deviceId: input.deviceId });
      return response;
    },

    async sendMessage(input) {
      traceLineBridgeClient("send-message-start", {
        deviceId: input.deviceId,
        to: input.to,
        textLength: input.text.length,
      });
      let response: Response;
      try {
        response = await fetchRaw(
          createUrl(normalizedBaseUrl, "/api/line/message/push"),
          {
            method: "POST",
            timeout: 30_000,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
      } catch (error) {
        traceLineBridgeClient("send-message-error", {
          deviceId: input.deviceId,
          to: input.to,
          detail: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      if (!response.ok) {
        traceLineBridgeClient("send-message-failed", {
          deviceId: input.deviceId,
          to: input.to,
          status: response.status,
        });
        await parseBridgeFailure(response, "LINE bridge message send failed.");
      }
      const result = await response.json() as LineBridgeSendMessageResult;
      traceLineBridgeClient("send-message-done", {
        deviceId: input.deviceId,
        to: input.to,
      });
      return result;
    },
  };
}
