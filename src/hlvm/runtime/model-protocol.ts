import type { ModelInfo, PullProgress } from "../providers/types.ts";

export type { PullProgress };

export interface RuntimeModelDiscoveryResponse {
  installedModels: ModelInfo[];
  remoteModels: ModelInfo[];
  cloudModels: ModelInfo[];
  failed: boolean;
}

export type RuntimeModelPullStreamEvent =
  | ({ event: "progress" } & PullProgress)
  | { event: "complete"; name: string }
  | { event: "error"; message: string };
