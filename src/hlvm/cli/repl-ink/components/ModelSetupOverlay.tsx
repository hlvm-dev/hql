/**
 * ModelSetupOverlay - First-time AI model setup
 *
 * Shows a friendly overlay when the default AI model needs to be downloaded.
 * Uses existing ProgressBar and TaskManager infrastructure.
 */

import React, { useEffect, useMemo, useRef } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { useSemanticColors } from "../../theme/index.ts";
import { useTaskManager } from "../hooks/useTaskManager.ts";
import { formatBytes } from "../../../../common/limits.ts";
import { isModelPullTask } from "../../repl/task-manager/types.ts";
import { getTaskManager } from "../../repl/task-manager/index.ts";
import { getPlatform } from "../../../../platform/platform.ts";
import { DEFAULT_OLLAMA_ENDPOINT } from "../../../../common/config/types.ts";
import { createRuntimeConfigManager } from "../../../runtime/model-config.ts";
import { resolveModelAvailabilityTarget } from "../../../runtime/model-availability.ts";
import { getConfiguredModelReadiness } from "../../../runtime/configured-model-readiness.ts";
import { DEFAULT_TERMINAL_WIDTH } from "../ui-constants.ts";
import { truncate } from "../../../../common/utils.ts";
import {
  resolveOverlayFrame,
} from "../overlay/index.ts";
import { formatProgressBar } from "../utils/formatting.ts";
import { OverlayBalancedRow, OverlayModal } from "./OverlayModal.tsx";

// ============================================================
// Types
// ============================================================

interface ModelSetupOverlayProps {
  /** Model name being downloaded */
  modelName: string;
  /** Callback when setup is complete */
  onComplete: () => void;
  /** Callback if user cancels */
  onCancel?: () => void;
  /** Ollama endpoint */
  endpoint?: string;
}

// ============================================================
// Component
// ============================================================

export function ModelSetupOverlay({
  modelName,
  onComplete,
  onCancel,
  endpoint = DEFAULT_OLLAMA_ENDPOINT,
}: ModelSetupOverlayProps): React.ReactElement {
  const sc = useSemanticColors();
  const { stdout } = useStdout();
  const { tasks, cancel } = useTaskManager();
  const manager = useMemo(() => getTaskManager(endpoint), [endpoint]);
  const terminalWidth = stdout?.columns ?? DEFAULT_TERMINAL_WIDTH;
  const terminalHeight = stdout?.rows ?? 24;
  const overlayFrame = useMemo(
    () =>
      resolveOverlayFrame(72, 13, {
        minWidth: 40,
        minHeight: 12,
        viewport: { columns: terminalWidth, rows: terminalHeight },
      }),
    [terminalHeight, terminalWidth],
  );
  const contentWidth = Math.max(20, overlayFrame.width - 6);

  // Prevent multiple onComplete/onCancel calls
  const handledRef = useRef(false);
  // Store callbacks in refs to avoid effect re-runs when they change
  const onCompleteRef = useRef(onComplete);
  const onCancelRef = useRef(onCancel);
  onCompleteRef.current = onComplete;
  onCancelRef.current = onCancel;

  // Find the download task for this model
  const task = useMemo(() => {
    return tasks.find(
      (t) => isModelPullTask(t) && t.modelName === modelName,
    );
  }, [tasks, modelName]);

  // Start download on mount only (not on every tasks change)
  useEffect(() => {
    // Check if there's already a task for this model
    const existingTask = tasks.find(
      (t) => isModelPullTask(t) && t.modelName === modelName,
    );
    if (!existingTask) {
      try {
        manager.pullModel(modelName);
      } catch {
        // Already downloading or failed to start
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelName, manager]); // Intentionally exclude tasks to only run on mount

  // Handle task completion (single effect, watches task status)
  useEffect(() => {
    if (!task) return;
    if (handledRef.current) return;

    if (task.status === "completed") {
      handledRef.current = true;
      onCompleteRef.current();
    }
  }, [task?.status]); // Only re-run when status changes

  // Handle keyboard input
  useInput((input, key) => {
    // ESC or x to cancel (only once)
    if ((key.escape || input === "x") && !handledRef.current) {
      handledRef.current = true;
      if (task && (task.status === "running" || task.status === "pending")) {
        cancel(task.id);
      }
      onCancelRef.current?.();
    }
  });

  // Calculate progress
  const progress = task?.progress;
  const percent = progress?.percent ?? 0;
  const completed = progress?.completed ?? 0;
  const total = progress?.total ?? 0;
  const status = progress?.status ?? "Preparing...";
  const percentLabel = `${Math.round(percent)}%`;

  // Determine display state
  const isDownloading = task?.status === "running" ||
    task?.status === "pending";
  const isFailed = task?.status === "failed";
  const isCancelled = task?.status === "cancelled";
  const progressBar = formatProgressBar(
    percent,
    Math.max(10, contentWidth - 14),
  );

  return (
    <OverlayModal
      title="AI setup"
      rightText="esc cancel"
      width={overlayFrame.width}
      minHeight={overlayFrame.height}
      tone={isFailed ? "error" : isCancelled ? "warning" : "active"}
    >
      <Box paddingLeft={3} flexDirection="column">
        <OverlayBalancedRow
          leftText="First-time model download"
          rightText={isDownloading
            ? percentLabel
            : isFailed
            ? "failed"
            : isCancelled
            ? "cancelled"
            : "ready"}
          width={contentWidth}
          leftColor={sc.text.primary}
          rightColor={isFailed
            ? sc.status.error
            : isCancelled
            ? sc.status.warning
            : sc.text.muted}
          leftBold
        />
        <Text color={sc.chrome.sectionLabel} wrap="truncate-end">
          {truncate(`Model · ${modelName}`, contentWidth, "…")}
        </Text>
        <Text color={sc.text.muted} wrap="truncate-end">
          {truncate(`Endpoint · ${endpoint}`, contentWidth, "…")}
        </Text>
      </Box>

      <Box paddingLeft={3} marginTop={1} flexDirection="column">
        {isDownloading
          ? (
            <>
              <OverlayBalancedRow
                leftText={`[${progressBar}]`}
                rightText={percentLabel}
                width={contentWidth}
                leftColor={sc.status.warning}
                rightColor={sc.text.muted}
              />
              <Text color={sc.text.muted} wrap="truncate-end">
                {total > 0
                  ? truncate(
                    `${status} · ${formatBytes(completed)} / ${
                      formatBytes(total)
                    }`,
                    contentWidth,
                    "…",
                  )
                  : truncate(status, contentWidth, "…")}
              </Text>
            </>
          )
          : isFailed
          ? (
            <Text color={sc.status.error} wrap="wrap">
              Download failed. Check that Ollama is running and try again.
            </Text>
          )
          : isCancelled
          ? (
            <Text color={sc.status.warning} wrap="wrap">
              Download cancelled. Reopen setup when you are ready.
            </Text>
          )
          : (
            <Text color={sc.text.muted} wrap="truncate-end">
              {truncate(status, contentWidth, "…")}
            </Text>
          )}
      </Box>

      <Box paddingLeft={3} marginTop={1} flexDirection="column">
        <Text color={sc.text.muted} wrap="wrap">
          One-time download · initial setup may download around 2GB once.
        </Text>
        <Text color={sc.footer.status.active} wrap="wrap">
          Esc cancels · background shell stays visible while setup is open.
        </Text>
      </Box>
    </OverlayModal>
  );
}

// ============================================================
// Helper: Check if default model needs setup
// ============================================================

/**
 * Check if the configured AI model is installed.
 * Non-blocking check that returns quickly.
 */
export async function checkDefaultModelInstalled(): Promise<boolean> {
  // Skip check if AI is disabled
  if (getPlatform().env.get("HLVM_DISABLE_AI_AUTOSTART")) {
    return true; // Pretend it's installed to skip setup
  }

  try {
    const readiness = await getConfiguredModelReadiness();
    return readiness.state !== "setup_required";
  } catch {
    // If check fails, assume model is installed to avoid blocking
    return true;
  }
}

/**
 * Get the default model name for setup.
 */
export async function getDefaultModelName(): Promise<string> {
  const runtimeConfig = await createRuntimeConfigManager();
  const { model } = await runtimeConfig.ensureInitialModelConfigured();
  return resolveModelAvailabilityTarget(model).modelName;
}
