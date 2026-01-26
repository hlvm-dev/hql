/**
 * ModelSetupOverlay - First-time AI model setup
 *
 * Shows a friendly overlay when the default AI model needs to be downloaded.
 * Uses existing ProgressBar and TaskManager infrastructure.
 */

import React, { useEffect, useMemo, useRef } from "npm:react@18";
import { Box, Text, useInput } from "npm:ink@5";
import { useTheme } from "../../theme/index.ts";
import { useTaskManager } from "../hooks/useTaskManager.ts";
import { ProgressBar, formatBytes } from "./ProgressBar.tsx";
import { isModelPullTask } from "../../repl/task-manager/types.ts";
import { getTaskManager } from "../../repl/task-manager/index.ts";
import { getConfiguredModel, isModelInstalled } from "../../../../common/ai-default-model.ts";
import { getPlatform } from "../../../../platform/platform.ts";
import { parseModelString, type ModelInfo } from "../../../providers/index.ts";

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
  endpoint = "http://127.0.0.1:11434",
}: ModelSetupOverlayProps): React.ReactElement {
  const { color } = useTheme();
  const { tasks, cancel } = useTaskManager();
  const manager = useMemo(() => getTaskManager(endpoint), [endpoint]);

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
      (t) => isModelPullTask(t) && t.modelName === modelName
    );
  }, [tasks, modelName]);

  // Start download on mount only (not on every tasks change)
  useEffect(() => {
    // Check if there's already a task for this model
    const existingTask = tasks.find(
      (t) => isModelPullTask(t) && t.modelName === modelName
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
  const isDownloading = task?.status === "running" || task?.status === "pending";
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
        <Text bold color={color("accent")}>{modelName}</Text>
      </Box>

      {/* Progress bar */}
      {isDownloading && (
        <Box flexDirection="column">
          <Box>
            <ProgressBar percent={percent} width={30} showPercent />
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
        <Text dimColor>
          This is a one-time download (~2GB). Press Esc to cancel.
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
    // Use ai.models.list() to check installed models
    const aiApi = (globalThis as Record<string, unknown>).ai as {
      models?: { list?: (providerName?: string) => Promise<ModelInfo[]> };
    } | undefined;

    if (!aiApi?.models?.list) {
      return true; // API not ready, skip setup
    }

    const configuredModel = getConfiguredModel();
    const [providerName, modelName] = parseModelString(configuredModel);
    if (!modelName) return true;

    // Model download UX is only supported for Ollama
    if (providerName && providerName !== "ollama") {
      return true;
    }

    const models = await aiApi.models.list(providerName ?? undefined);

    // Empty list means nothing installed yet
    if (!models || models.length === 0) {
      return false;
    }

    return isModelInstalled(models, modelName);
  } catch {
    // If check fails, assume model is installed to avoid blocking
    return true;
  }
}

/**
 * Get the default model name for setup.
 */
export function getDefaultModelName(): string {
  const [, modelName] = parseModelString(getConfiguredModel());
  return modelName;
}
