export type CtrlCAction = "clear-draft" | "exit";

interface ResolveCtrlCActionOptions {
  draftText: string;
  attachmentCount: number;
}

export function resolveCtrlCAction(
  { draftText, attachmentCount }: ResolveCtrlCActionOptions,
): CtrlCAction {
  return draftText.length > 0 || attachmentCount > 0 ? "clear-draft" : "exit";
}
