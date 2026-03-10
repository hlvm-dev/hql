/**
 * Companion Agent — Approval Lifecycle
 *
 * Promise-based pending approval map. SSOT for the approve/deny/timeout cycle.
 */

import type { CompanionResponse } from "./types.ts";

interface PendingApproval {
  resolve: (response: CompanionResponse) => void;
  reject: (reason: unknown) => void;
  timeoutId: number;
}

const pending = new Map<string, PendingApproval>();

/**
 * Wait for a user approval response for the given eventId.
 * Rejects on timeout (default 60s) or abort signal.
 */
export function waitForApproval(
  eventId: string,
  signal?: AbortSignal,
  timeoutMs = 60_000,
): Promise<CompanionResponse> {
  return new Promise<CompanionResponse>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeoutId);
      pending.delete(eventId);
    };

    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`Approval timeout for ${eventId}`));
    }, timeoutMs);

    if (signal) {
      signal.addEventListener("abort", () => {
        cleanup();
        reject(new Error(`Approval aborted for ${eventId}`));
      }, { once: true });
    }

    pending.set(eventId, { resolve, reject, timeoutId });
  });
}

/**
 * Resolve a pending approval. Returns true if the eventId was found and resolved.
 */
export function resolveApproval(response: CompanionResponse): boolean {
  const entry = pending.get(response.eventId);
  if (!entry) return false;

  clearTimeout(entry.timeoutId);
  pending.delete(response.eventId);
  entry.resolve(response);
  return true;
}

/** Number of currently pending approvals. */
export function getPendingApprovalCount(): number {
  return pending.size;
}

/** Cancel and clear all pending approvals. */
export function clearAllPendingApprovals(): void {
  for (const [id, entry] of pending) {
    clearTimeout(entry.timeoutId);
    entry.reject(new Error(`Approval cleared for ${id}`));
  }
  pending.clear();
}
