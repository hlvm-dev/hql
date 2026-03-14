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

export const MODEL_BROWSER_FOCUSED_LABEL = "Focused";
export const MODEL_BROWSER_SELECT_ACTION_LABEL = "make default";

export function getModelStatusLabel(kind: ModelStatusKind): string {
  switch (kind) {
    case "pending-delete":
      return "pending delete";
    case "active":
      return "default";
    case "installed":
      return "installed";
    case "downloading":
      return "downloading";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    case "needs-key":
      return "needs key";
    case "cloud":
      return "cloud";
    case "available":
      return "not installed";
  }
}

export function getStatusIndicator(kind: ModelStatusKind): string {
  switch (kind) {
    case "pending-delete":
      return "? ";
    case "active":
      return "* ";
    case "installed":
      return "○ ";
    case "downloading":
      return "↓ ";
    case "cancelled":
      return "⊘ ";
    case "failed":
      return "✗ ";
    case "needs-key":
    case "cloud":
    case "available":
      return "☁ ";
  }
}
