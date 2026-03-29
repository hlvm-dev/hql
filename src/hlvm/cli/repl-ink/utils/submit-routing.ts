import type { ComposerLanguage } from "../../repl/composer-language.ts";
import { isCommand } from "../../repl/commands.ts";

export type SubmitAction =
  | "continue-multiline"
  | "run-command"
  | "evaluate-local"
  | "send-agent";

export type SubmitRouteHint = "conversation" | "mixed-shell";

export interface ResolveSubmitActionOptions {
  text: string;
  isBalanced: boolean;
  hasAttachments?: boolean;
  composerLanguage?: ComposerLanguage;
  routeHint?: SubmitRouteHint;
  isCommand?: boolean;
}

export function isShellCommandText(text: string): boolean {
  const trimmed = text.trimStart();
  if (trimmed.startsWith(".")) {
    return isCommand(`/${trimmed.slice(1)}`);
  }
  return isCommand(trimmed);
}

export function resolveSubmitAction({
  text,
  isBalanced,
  hasAttachments = false,
  composerLanguage: _composerLanguage = "hql",
  routeHint: _routeHint = "mixed-shell",
  isCommand: isCommandOverride,
}: ResolveSubmitActionOptions): SubmitAction {
  const trimmed = text.trim();
  const command = isCommandOverride ?? isShellCommandText(trimmed);

  if (command) {
    return "run-command";
  }

  const hasAtMention = trimmed.startsWith("@") || trimmed.includes(" @");
  if (trimmed && !isBalanced && !hasAttachments && !hasAtMention) {
    return "continue-multiline";
  }

  if (trimmed.startsWith("(")) {
    return "evaluate-local";
  }

  return "send-agent";
}

export function formatSubmitActionCue(
  action: SubmitAction,
  routeHint: SubmitRouteHint = "mixed-shell",
): string {
  switch (action) {
    case "continue-multiline":
      return "Enter newline";
    case "run-command":
      return "Enter command";
    case "evaluate-local":
      return "Enter eval";
    case "send-agent":
      return routeHint === "conversation" ? "Enter send" : "Enter agent";
  }
}
