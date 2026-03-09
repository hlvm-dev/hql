import type { OrchestratorConfig } from "./orchestrator.ts";
import {
  getBatchSnapshot,
  listBatchSnapshots,
  type DelegateBatchSnapshot,
} from "./delegate-batches.ts";
import { persistAgentDelegateBatches } from "./persisted-transcript.ts";

export function emitDelegateBatchProgress(
  config: OrchestratorConfig,
  batch: string | DelegateBatchSnapshot | undefined,
): void {
  const snapshot = typeof batch === "string"
    ? getBatchSnapshot(batch)
    : batch;
  if (!snapshot) return;
  config.onAgentEvent?.({
    type: "batch_progress_updated",
    snapshot,
  });
  if (config.sessionId) {
    persistAgentDelegateBatches(config.sessionId, listBatchSnapshots());
  }
}
