/**
 * ModelSetupOverlay - First-time AI model setup
 *
 * Shows a friendly overlay when the default AI model needs to be downloaded.
 * Uses existing ProgressBar and TaskManager infrastructure.
 */

import React, { useEffect, useMemo, useRef } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { useTheme } from "../../theme/index.ts";
import { useSemanticColors } from "../../theme/index.ts";
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
import { clampPanelWidth, DEFAULT_TERMINAL_WIDTH } from "../ui-constants.ts";
import { truncate } from "../../../../common/utils.ts";
import { ChromeChip } from "./ChromeChip.tsx";

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
  const sc = useSemanticColors();
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
  const percentLabel = `${Math.round(percent)}%`;

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
      <Box marginBottom={1}>
        <ChromeChip text="AI setup" tone="active" />
        <Text></Text>
        <Text bold color={color("primary")}>
          First-time model download
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text color={sc.text.muted}>Downloading</Text>
        <Text bold color={color("accent")}>
          {truncate(modelName, Math.max(8, contentWidth - 12), "…")}
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text color={sc.text.muted}>
          {truncate(`Endpoint · ${endpoint}`, contentWidth, "…")}
        </Text>
      </Box>

      {isDownloading && (
        <Box flexDirection="column">
          <Box justifyContent="space-between">
            <ProgressBar current={percent} total={100} width={progressWidth} />
            <Text color={sc.text.muted}>{percentLabel}</Text>
          </Box>
          {total > 0 && (
            <Box marginTop={0}>
              <Text color={sc.text.muted}>
                {status} · {formatBytes(completed)} / {formatBytes(total)}
              </Text>
            </Box>
          )}
          {status && !total && (
            <Box marginTop={0}>
              <Text color={sc.text.muted}>{status}</Text>
            </Box>
          )}
        </Box>
      )}

      {isFailed && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <ChromeChip text="Download failed" tone="error" />
          </Box>
          <Text color={sc.text.muted}>
            Check that Ollama is running and try again.
          </Text>
        </Box>
      )}

      {isCancelled && (
        <Box marginTop={1}>
          <ChromeChip text="Download cancelled" tone="warning" />
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        <Box>
          <ChromeChip text="One-time download" tone="neutral" />
          <Text></Text>
          <ChromeChip text="Esc cancels" tone="warning" />
        </Box>
        <Text color={sc.text.muted} wrap="truncate-end">
          {truncate(
            "Initial model setup may download around 2GB once.",
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
