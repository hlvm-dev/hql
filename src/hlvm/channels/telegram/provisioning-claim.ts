import type {
  TelegramProvisioningCompleteRequest,
  TelegramProvisioningCompletionResult,
} from "./protocol.ts";
import type { TelegramProvisioningBridgeClient } from "./provisioning-bridge-client.ts";
import type { TelegramProvisioningSessionInternal } from "./provisioning-session.ts";

interface TelegramBridgeClaimWaitDependencies {
  bridgeClient: TelegramProvisioningBridgeClient;
  now: () => number;
  pollIntervalMs: number;
  trace: (event: string, data: unknown) => void;
  isActivePendingSession: (sessionId: string) => boolean;
  failActiveSession: (sessionId: string, detail: string) => void;
  completeClaimedSession: (
    input: TelegramProvisioningCompleteRequest,
  ) => Promise<TelegramProvisioningCompletionResult | null>;
}

const MAX_TRANSIENT_BRIDGE_CLAIM_ERRORS = 3;

function getErrorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTransientBridgeClaimError(error: unknown): boolean {
  const detail = getErrorDetail(error).toLowerCase();
  return detail.includes("aborted") || detail.includes("timeout");
}

export function createTelegramBridgeClaimWaiter(
  dependencies: TelegramBridgeClaimWaitDependencies,
): (
  session: TelegramProvisioningSessionInternal,
  signal: AbortSignal,
) => Promise<void> {
  const {
    bridgeClient,
    now,
    pollIntervalMs,
    trace,
    isActivePendingSession,
    failActiveSession,
    completeClaimedSession,
  } = dependencies;

  return async (session, signal) => {
    if (!session.claimToken) return;
    try {
      trace("bridge-claim-start", {
        sessionId: session.sessionId,
        totalWaitMs: Math.max(0, session.expiresAtMs - now()),
        pollIntervalMs,
      });
      let attempt = 0;
      let transientErrors = 0;
      while (true) {
        if (!isActivePendingSession(session.sessionId)) return;
        const remainingWaitMs = Math.max(0, session.expiresAtMs - now());
        const waitMs = Math.min(remainingWaitMs, pollIntervalMs);
        let result;
        try {
          result = await bridgeClient.claimSession(
            waitMs > 0
              ? {
                sessionId: session.sessionId,
                claimToken: session.claimToken,
                waitMs,
              }
              : {
                sessionId: session.sessionId,
                claimToken: session.claimToken,
              },
            signal,
          );
          transientErrors = 0;
        } catch (error) {
          if (signal.aborted) return;
          const detail = getErrorDetail(error);
          if (
            remainingWaitMs > 0 &&
            transientErrors < MAX_TRANSIENT_BRIDGE_CLAIM_ERRORS &&
            isTransientBridgeClaimError(error)
          ) {
            transientErrors++;
            trace("bridge-claim-transient-error", {
              sessionId: session.sessionId,
              attempt,
              remainingWaitMs,
              transientErrors,
              detail,
            });
            attempt++;
            continue;
          }
          throw error;
        }
        trace("bridge-claim-result", {
          sessionId: session.sessionId,
          attempt,
          remainingWaitMs,
          waitMs,
          ok: result.ok,
          ...(result.ok
            ? {
              username: result.username,
              tokenLength: result.token.length,
              ownerUserId: Number.isInteger(result.ownerUserId)
                ? result.ownerUserId
                : null,
            }
            : { reason: result.reason }),
        });
        if (!isActivePendingSession(session.sessionId)) return;
        if (!result.ok) {
          if (result.reason === "pending" && remainingWaitMs > 0) {
            attempt++;
            continue;
          }
          if (result.reason === "pending" || result.reason === "missing") {
            failActiveSession(
              session.sessionId,
              "Telegram provisioning session expired.",
            );
            return;
          }
          failActiveSession(
            session.sessionId,
            "Telegram provisioning bridge rejected the session.",
          );
          return;
        }
        trace("bridge-claim-complete-start", {
          sessionId: session.sessionId,
          username: result.username,
          ownerUserId: Number.isInteger(result.ownerUserId)
            ? result.ownerUserId
            : null,
        });
        const completion = await completeClaimedSession({
          sessionId: session.sessionId,
          token: result.token,
          username: result.username,
          ...(Number.isInteger(result.ownerUserId)
            ? { ownerUserId: result.ownerUserId }
            : {}),
        });
        trace("bridge-claim-complete-result", {
          sessionId: session.sessionId,
          completed: !!completion,
          sessionState: completion?.session.state ?? null,
          statusState: completion?.status?.state ?? null,
          statusError: completion?.status?.lastError ?? null,
        });
        if (!completion || completion.session.state !== "completed") {
          failActiveSession(
            session.sessionId,
            completion?.status?.lastError ?? "Telegram provisioning failed.",
          );
        }
        return;
      }
    } catch (error) {
      if (signal.aborted) return;
      const detail = error instanceof Error ? error.message : String(error);
      trace("bridge-claim-error", {
        sessionId: session.sessionId,
        detail,
      });
      failActiveSession(session.sessionId, detail);
    }
  };
}
