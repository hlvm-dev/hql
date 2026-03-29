/**
 * ModelSetupOverlay - First-time AI model setup
 *
 * Shows a friendly overlay when the default AI model needs to be downloaded.
 * Uses existing ProgressBar and TaskManager infrastructure.
 */

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useInput, useStdout } from "ink";
import { useTheme } from "../../theme/index.ts";
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
  clearOverlay,
  createModalOverlayScaffold,
  resolveOverlayFrame,
  shouldClearOverlay,
  themeToOverlayColors,
  writeToTerminal,
} from "../overlay/index.ts";
import { buildBalancedTextRow } from "../utils/display-chrome.ts";
import { formatProgressBar } from "../utils/formatting.ts";

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
  const { theme } = useTheme();
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
  const colors = useMemo(() => themeToOverlayColors(theme), [theme]);
  const previousFrameRef = useRef<typeof overlayFrame | null>(null);

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
  const drawOverlay = useCallback(() => {
    if (shouldClearOverlay(previousFrameRef.current, overlayFrame)) {
      clearOverlay(previousFrameRef.current);
    }
    previousFrameRef.current = overlayFrame;

    const surface = createModalOverlayScaffold({
      frame: overlayFrame,
      colors,
      title: "AI setup",
      rightText: "esc cancel",
    });
    surface.blankRows(overlayFrame.y, overlayFrame.height);
    const headerY = overlayFrame.y + 1;
    const progressText = buildBalancedTextRow(
      contentWidth,
      "First-time model download",
      isDownloading
        ? percentLabel
        : isFailed
        ? "failed"
        : isCancelled
        ? "cancelled"
        : "ready",
    );

    surface.blankRows(overlayFrame.y, 1);
    surface.balancedRow(
      headerY,
      progressText.leftText,
      progressText.rightText,
      contentWidth,
      {
        paddingLeft: 3,
        leftColor: colors.title,
        rightColor: isFailed
          ? colors.error
          : isCancelled
          ? colors.warning
          : colors.meta,
        leftBold: true,
      },
    );
    surface.textRow(
      headerY + 1,
      truncate(`Model · ${modelName}`, contentWidth, "…"),
      { paddingLeft: 3, color: colors.section },
    );
    surface.textRow(
      headerY + 2,
      truncate(`Endpoint · ${endpoint}`, contentWidth, "…"),
      { paddingLeft: 3, color: colors.meta },
    );
    surface.blankRow(headerY + 3);

    if (isDownloading) {
      const progressBar = formatProgressBar(
        percent,
        Math.max(10, contentWidth - 14),
      );
      surface.balancedRow(
        headerY + 4,
        `[${progressBar}]`,
        percentLabel,
        contentWidth,
        {
          paddingLeft: 3,
          leftColor: colors.warning,
          rightColor: colors.meta,
        },
      );
      surface.textRow(
        headerY + 5,
        total > 0
          ? truncate(
            `${status} · ${formatBytes(completed)} / ${formatBytes(total)}`,
            contentWidth,
            "…",
          )
          : truncate(status, contentWidth, "…"),
        { paddingLeft: 3, color: colors.meta },
      );
    } else if (isFailed) {
      surface.textRow(
        headerY + 4,
        "Download failed. Check that Ollama is running and try again.",
        { paddingLeft: 3, color: colors.error },
      );
    } else if (isCancelled) {
      surface.textRow(
        headerY + 4,
        "Download cancelled. Reopen setup when you are ready.",
        { paddingLeft: 3, color: colors.warning },
      );
    } else {
      surface.textRow(
        headerY + 4,
        truncate(status, contentWidth, "…"),
        { paddingLeft: 3, color: colors.meta },
      );
    }

    surface.blankRow(headerY + 6);
    surface.textRow(
      headerY + 7,
      "One-time download · initial setup may download around 2GB once.",
      { paddingLeft: 3, color: colors.meta },
    );
    surface.textRow(
      headerY + 8,
      "Esc cancels · background shell stays visible while setup is open.",
      { paddingLeft: 3, color: colors.footer },
    );

    writeToTerminal(surface.finish());
  }, [
    colors,
    completed,
    contentWidth,
    endpoint,
    isCancelled,
    isDownloading,
    isFailed,
    modelName,
    overlayFrame,
    percent,
    percentLabel,
    status,
    total,
  ]);

  useEffect(() => {
    drawOverlay();
  }, [drawOverlay]);

  useEffect(() => () => {
    if (previousFrameRef.current) {
      clearOverlay(previousFrameRef.current);
    }
  }, []);

  return null;
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
