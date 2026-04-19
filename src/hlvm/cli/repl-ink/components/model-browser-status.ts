export type ModelStatusKind =
  | "pending-delete"
  | "active"
  | "installed"
  | "downloading"
  | "cancelled"
  | "failed"
  | "needs-key"
  | "cloud"
  | "available";

export const MODEL_BROWSER_FOCUSED_LABEL = "Selected";
export const MODEL_BROWSER_SELECT_ACTION_LABEL = "choose";

const MODEL_STATUS_LABELS: Record<ModelStatusKind, string> = {
  "pending-delete": "pending delete",
  active: "default",
  installed: "installed",
  downloading: "downloading",
  cancelled: "cancelled",
  failed: "failed",
  "needs-key": "needs key",
  cloud: "cloud",
  available: "not installed",
};

export function getModelStatusLabel(kind: ModelStatusKind): string {
  return MODEL_STATUS_LABELS[kind];
}

const STATUS_INDICATORS: Record<ModelStatusKind, string> = {
  "pending-delete": "! ",
  active: "* ",
  installed: "o ",
  downloading: "v ",
  cancelled: "x ",
  failed: "x ",
  "needs-key": "! ",
  cloud: ". ",
  available: ". ",
};

export function getStatusIndicator(kind: ModelStatusKind): string {
  return STATUS_INDICATORS[kind];
}
