/**
 * ModelSetupOverlay - First-time AI model setup
 *
 * Shows a friendly overlay when the default AI model needs to be downloaded.
 * Uses existing ProgressBar and TaskManager infrastructure.
 */

import React, { useEffect, useMemo, useRef } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { useTheme } from "../../theme/index.ts";
import { useTaskManager } from "../hooks/useTaskManager.ts";
import { formatBytes } from "../../../../common/limits.ts";
import { ProgressBar } from "./conversation/ProgressBar.tsx";
import { isModelPullTask } from "../../repl/task-manager/types.ts";
import { getTaskManager } from "../../repl/task-manager/index.ts";
import { getPlatform } from "../../../../platform/platform.ts";
import { DEFAULT_OLLAMA_ENDPOINT } from "../../../../common/config/types.ts";
import { createRuntimeConfigManager } from "../../../runtime/model-config.ts";
import { resolveModelAvailabilityTarget } from "../../../runtime/model-availability.ts";
import { getConfiguredModelReadiness } from "../../../runtime/configured-model-readiness.ts";
import {
  clampPanelWidth,
  DEFAULT_TERMINAL_WIDTH,
} from "../ui-constants.ts";
import { truncate } from "../../../../common/utils.ts";

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
  const { color } = useTheme();
  const { stdout } = useStdout();
  const { tasks, cancel } = useTaskManager();
  const manager = useMemo(() => getTaskManager(endpoint), [endpoint]);
  const terminalWidth = stdout?.columns ?? DEFAULT_TERMINAL_WIDTH;
  const panelWidth = clampPanelWidth(terminalWidth, {
    maxWidth: 72,
    minWidth: 40,
  });
  const contentWidth = Math.max(20, panelWidth - 4);
  const progressWidth = Math.max(8, Math.min(30, contentWidth - 8));

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

  // Determine display state
  const isDownloading = task?.status === "running" ||
    task?.status === "pending";
  const isFailed = task?.status === "failed";
  const isCancelled = task?.status === "cancelled";

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={color("primary")}
      paddingX={2}
      paddingY={1}
      marginY={1}
      width={panelWidth}
      alignSelf="center"
    >
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color={color("primary")}>
          ⏳ First-time AI Setup
        </Text>
      </Box>

      {/* Status */}
      <Box marginBottom={1}>
        <Text>Downloading </Text>
        <Text bold color={color("accent")}>
          {truncate(modelName, Math.max(8, contentWidth - 12), "…")}
        </Text>
      </Box>

      {/* Progress bar */}
      {isDownloading && (
        <Box flexDirection="column">
          <Box>
            <ProgressBar percent={percent} width={progressWidth} showPercent />
          </Box>
          {total > 0 && (
            <Box marginTop={0}>
              <Text dimColor>
                {formatBytes(completed)} / {formatBytes(total)}
              </Text>
            </Box>
          )}
          {status && !total && (
            <Box marginTop={0}>
              <Text dimColor>{status}</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Failed state */}
      {isFailed && (
        <Box flexDirection="column">
          <Text color={color("error")}>✗ Download failed</Text>
          <Text dimColor>Check that Ollama is running and try again.</Text>
        </Box>
      )}

      {/* Cancelled state */}
      {isCancelled && (
        <Box>
          <Text color={color("warning")}>Download cancelled</Text>
        </Box>
      )}

      {/* Footer hint */}
      <Box marginTop={1}>
        <Text dimColor wrap="truncate-end">
          {truncate(
            "This is a one-time download (~2GB). Press Esc to cancel.",
            contentWidth,
            "…",
          )}
        </Text>
      </Box>
    </Box>
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
