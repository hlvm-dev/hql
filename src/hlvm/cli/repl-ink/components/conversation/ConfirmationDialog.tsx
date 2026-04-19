/**
 * ConfirmationDialog Component
 *
 * Displays a tool permission confirmation dialog.
 * Keyboard: y/Enter = approve, n/Esc = reject.
 * Visual: prominent bordered box with clear action hints.
 */

import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import {
  getConfirmationDialogDisplay,
  PLAN_REVIEW_PICKER_HINT,
} from "./interaction-dialog-layout.ts";
import {
  InteractionPicker,
  type InteractionPickerOption,
} from "./InteractionPicker.tsx";
import type { InteractionResponse } from "../../../../agent/registry.ts";
import {
  splitArgKeyValue,
} from "./conversation-chrome.ts";
import { TRANSCRIPT_LAYOUT } from "../../utils/layout-tokens.ts";
import { PermissionDialogFrame } from "./PermissionDialogFrame.tsx";

function isWebFetchTool(toolName?: string): boolean {
  const normalized = toolName?.trim().toLowerCase();
  return normalized === "web_fetch" || normalized === "fetch_url" ||
    normalized === "fetch";
}

function isBrowserTool(toolName?: string): boolean {
  const normalized = toolName?.trim().toLowerCase();
  return normalized?.startsWith("pw_") === true ||
    normalized?.includes("browser") === true;
}

function isShellTool(toolName?: string): boolean {
  const normalized = toolName?.trim().toLowerCase();
  return normalized?.includes("shell") === true ||
    normalized?.includes("bash") === true ||
    normalized?.includes("command") === true;
}

function extractHostname(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function resolvePermissionTitle(toolName?: string): string {
  const normalized = toolName?.trim().toLowerCase();
  if (!normalized) return "Permission";
  if (isWebFetchTool(normalized)) return "Fetch";
  if (isShellTool(normalized)) return "Bash";
  if (
    normalized.includes("write") || normalized.includes("edit") ||
    normalized.includes("patch")
  ) {
    return "Edit";
  }
  if (normalized.startsWith("pw_") || normalized.includes("browser")) {
    return "Browser";
  }
  return normalized.replace(/_/g, " ").replace(/\b\w/g, (char) =>
    char.toUpperCase()
  );
}

function resolvePermissionQuestion(
  toolName?: string,
): string {
  if (isWebFetchTool(toolName)) {
    return "Do you want to allow HLVM to fetch this content?";
  }
  if (isBrowserTool(toolName)) {
    return "Do you want to allow HLVM to open this page?";
  }
  if (isShellTool(toolName)) {
    return "Do you want to proceed?";
  }
  return "Do you want to allow HLVM to continue with this action?";
}

interface ConfirmationDialogProps {
  requestId?: string;
  toolName?: string;
  toolArgs?: string;
  toolInput?: unknown;
  sourceLabel?: string;
  onResolve?: (requestId: string, response: InteractionResponse) => void;
}

export const ConfirmationDialog = React.memo(
  function ConfirmationDialog(
    {
      requestId,
      toolName,
      toolArgs,
      toolInput,
      sourceLabel,
      onResolve,
    }: ConfirmationDialogProps,
  ): React.ReactElement {
    const sc = useSemanticColors();
    const dialog = getConfirmationDialogDisplay(toolName, toolArgs, toolInput);
    const { isPlanReview, visibleArgLines, hiddenArgLines } = dialog;
    const permissionUrl = dialog.requestKind === "url"
      ? dialog.focusText
      : undefined;
    const permissionHostname = extractHostname(permissionUrl);
    const canRememberChoice = isWebFetchTool(toolName) && permissionHostname;
    const permissionTitle = resolvePermissionTitle(toolName);
    const permissionQuestion = resolvePermissionQuestion(toolName);
    const isUrlPermission = dialog.requestKind === "url";
    const permissionSubtitle = isUrlPermission ? undefined : permissionUrl;
    const requestSectionLabel = dialog.requestKind === "shell"
      ? "Context"
      : "Request";

    const renderRequestLines = (): React.ReactNode => {
      if (visibleArgLines.length === 0) return null;
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={sc.text.secondary}>{requestSectionLabel}</Text>
          <Box
            paddingLeft={TRANSCRIPT_LAYOUT.detailIndent}
            flexDirection="column"
          >
            {visibleArgLines.map((line: string, i: number) => {
              const kv = splitArgKeyValue(line);
              if (kv) {
                return (
                  <Box key={i}>
                    <Text color={sc.text.secondary} wrap="truncate-end">
                      {kv.key}
                      {kv.separator}
                    </Text>
                    <Text color={sc.text.muted} wrap="truncate-end">
                      {kv.value}
                    </Text>
                  </Box>
                );
              }
              return (
                <React.Fragment key={i}>
                  <Text color={sc.text.muted} wrap="truncate-end">
                    {line}
                  </Text>
                </React.Fragment>
              );
            })}
            {hiddenArgLines > 0 && (
              <Text color={sc.text.muted}>
                … {hiddenArgLines} more line{hiddenArgLines === 1 ? "" : "s"}
              </Text>
            )}
          </Box>
        </Box>
      );
    };

    const renderPermissionBody = (): React.ReactNode => {
      if (dialog.planReview) {
        return (
          <>
            <Text color={sc.text.primary} wrap="wrap">
              {dialog.planReview.plan.goal}
            </Text>
            <Box marginTop={1} flexDirection="column">
              <Text color={sc.text.secondary}>Implementation steps</Text>
              {dialog.planReview.visibleSteps.map((step, index) => (
                <React.Fragment key={step.id}>
                  <Text color={sc.text.primary} wrap="wrap">
                    {" "}
                    {index + 1}. {step.title}
                  </Text>
                </React.Fragment>
              ))}
              {dialog.planReview.hiddenStepCount > 0 && (
                <Text color={sc.text.muted}>
                  ... {dialog.planReview.hiddenStepCount} more step
                  {dialog.planReview.hiddenStepCount === 1 ? "" : "s"}
                </Text>
              )}
            </Box>
            {dialog.planReview.verificationLines.length > 0 && (
              <Box marginTop={1} flexDirection="column">
                <Text color={sc.text.secondary}>Verification</Text>
                {dialog.planReview.verificationLines.map((line) => (
                  <React.Fragment key={line}>
                    <Text color={sc.text.muted} wrap="wrap">
                      {" "}
                      • {line}
                    </Text>
                  </React.Fragment>
                ))}
              </Box>
            )}
          </>
        );
      }

      return (
        <>
          {dialog.warningText && (
            <Text color={sc.status.warning} wrap="wrap">
              {dialog.warningText}
            </Text>
          )}
          {dialog.requestKind === "url" && dialog.focusText && (
            <Box
              flexDirection="column"
              marginTop={dialog.warningText ? 1 : 0}
              paddingLeft={TRANSCRIPT_LAYOUT.detailIndent}
            >
              <Text color={sc.text.primary} wrap="wrap">
                {dialog.focusText}
              </Text>
              {dialog.supportText && (
                <Text color={sc.text.muted} wrap="wrap">
                  {dialog.supportText}
                </Text>
              )}
            </Box>
          )}
          {dialog.requestKind === "shell" && dialog.focusText && (
            <Box flexDirection="column" marginTop={dialog.warningText ? 1 : 0}>
              <Text color={sc.text.secondary}>Command</Text>
              <Box paddingLeft={TRANSCRIPT_LAYOUT.detailIndent}>
                <Text color={sc.text.primary} bold wrap="wrap">
                  {dialog.focusText}
                </Text>
              </Box>
            </Box>
          )}
          <Box marginTop={1}>
            <Text color={sc.text.primary} wrap="wrap">
              {permissionQuestion}
            </Text>
          </Box>
          {!isUrlPermission && renderRequestLines()}
        </>
      );
    };

    const buildPermissionOptions = (): InteractionPickerOption[] => {
      if (isPlanReview) {
        return [
          {
            label: "Yes, implement this plan",
            value: "approve:auto",
            detail:
              "Switch to Full auto and start coding without further permission prompts.",
            recommended: true,
          },
          {
            label: "Revise this plan",
            value: "revise",
            detail: "Stay in Plan mode and continue planning with the model.",
          },
          {
            label: "Cancel",
            value: "cancel",
            detail: "Stop here without implementing or continuing planning.",
          },
        ];
      }
      const options: InteractionPickerOption[] = [
        {
          label: "Yes",
          value: "approve",
          recommended: true,
        },
      ];
      if (canRememberChoice) {
        options.push({
          label: `Yes, and don't ask again for ${permissionHostname}`,
          value: "approve:remember",
        });
      }
      options.push(
        {
          label: isUrlPermission
            ? "No, and tell HLVM what to do differently (esc)"
            : "No",
          value: "reject",
        },
      );
      return options;
    };

    if (requestId && onResolve) {
      const options = buildPermissionOptions();
      const hintContent = (
        <Text color={sc.text.muted}>
          {isPlanReview ? PLAN_REVIEW_PICKER_HINT : "Esc · Tab guide"}
        </Text>
      );
      const resolvePermission = (
        option: InteractionPickerOption,
        notes?: string,
      ): void => {
        const trimmedNotes = notes?.trim();
        if (option.value === "approve:auto") {
          onResolve(requestId, {
            approved: true,
            userInput: trimmedNotes
              ? `${option.value}\n\nNotes: ${trimmedNotes}`
              : option.value,
          });
          return;
        }
        if (option.value === "revise") {
          onResolve(requestId, {
            approved: false,
            userInput: trimmedNotes
              ? `revise\n\nNotes: ${trimmedNotes}`
              : "revise",
          });
          return;
        }
        if (option.value === "approve:remember") {
          onResolve(requestId, {
            approved: true,
            rememberChoice: true,
            userInput: trimmedNotes,
          });
          return;
        }
        if (option.value === "approve") {
          onResolve(requestId, {
            approved: true,
            userInput: trimmedNotes,
          });
          return;
        }
        onResolve(requestId, {
          approved: false,
          userInput: trimmedNotes,
        });
      };

      const picker = (
        <InteractionPicker
          title={isPlanReview ? "Ready to code?" : ""}
          subtitle={!isPlanReview
            ? undefined
            : undefined}
          options={options}
          hint={isPlanReview
            ? PLAN_REVIEW_PICKER_HINT
            : "↑/↓ / 1-9 · Tab guide · Enter · Esc"}
          hintContent={hintContent}
          tone={isPlanReview ? "warning" : "active"}
          allowNotes
          notesLabel={isPlanReview ? "Revision notes" : "Guidance"}
          notesPlaceholder={isPlanReview
            ? "Tell the agent what to revise..."
            : "Tell HLVM what to do differently..."}
          notesEmptyText={isPlanReview
            ? "Tab add notes."
            : "Tab add guidance."}
          onSubmit={resolvePermission}
          onCancel={() => onResolve(requestId, { approved: false })}
        >
          <Box flexDirection="column">
            {sourceLabel && !isPlanReview && !permissionUrl && (
              <Box marginBottom={1}>
                <Text color={sc.text.secondary}>From: </Text>
                <Text color={sc.text.primary} bold>
                  {sourceLabel}
                </Text>
              </Box>
            )}
            {isPlanReview && (
              <Text color={sc.text.secondary}>Overview</Text>
            )}
            {toolName && !isPlanReview && dialog.requestKind === "generic" && (
              <Text color={sc.text.primary} bold>{toolName}</Text>
            )}
            {renderPermissionBody()}
          </Box>
        </InteractionPicker>
      );

      return isPlanReview
        ? picker
        : (
          <PermissionDialogFrame
            title={permissionTitle}
            subtitle={permissionSubtitle}
          >
            {picker}
          </PermissionDialogFrame>
        );
    }

    const content = (
      <Box flexDirection="column">
        <Text color={isPlanReview ? sc.text.primary : sc.status.warning} bold>
          {isPlanReview ? "Ready to code?" : permissionTitle}
        </Text>
        {sourceLabel && (
          <Box marginTop={0}>
            <Text color={sc.text.secondary}>From:</Text>
            <Text color={sc.text.primary} bold>
              {sourceLabel}
            </Text>
          </Box>
        )}
        {isPlanReview && (
          <Text color={sc.text.secondary}>Review before proceeding.</Text>
        )}
        {toolName && !isPlanReview && dialog.requestKind === "generic" && (
          <Box marginTop={0}>
            <Text color={sc.text.secondary}>Tool:</Text>
            <Text color={sc.text.primary} bold>
              {toolName}
            </Text>
          </Box>
        )}
        <Box marginTop={1} flexDirection="column">
          {renderPermissionBody()}
        </Box>
        <Box marginTop={1}>
          <Text color={sc.status.success} bold>Enter</Text>
          <Text color={sc.text.muted}>
            {" "}
            {isPlanReview ? "run" : "approve"}
          </Text>
          {isPlanReview && (
            <>
              <Text color={sc.text.muted}>·</Text>
              <Text color={sc.status.warning} bold>r</Text>
              <Text color={sc.text.muted}>
                {" "}revise
              </Text>
            </>
          )}
          <Text color={sc.text.muted}>·</Text>
          <Text color={sc.status.error} bold>Esc</Text>
          <Text color={sc.text.muted}>
            {" "}
            {isPlanReview ? "cancel" : "reject"}
          </Text>
        </Box>
      </Box>
    );

    return isPlanReview
      ? content
      : (
        <PermissionDialogFrame
          title={permissionTitle}
          subtitle={permissionSubtitle}
        >
          {content}
        </PermissionDialogFrame>
      );
  },
);
