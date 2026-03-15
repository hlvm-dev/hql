/**
 * useModelConfig — Manages model selection, execution mode, and footer status.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { HlvmConfig } from "../../../../common/config/types.ts";
import {
  getContextWindow,
  getPermissionMode,
} from "../../../../common/config/selectors.ts";
import {
  createModelSelectionState,
  isModelSelectionStateEqual,
  type ModelSelectionState,
} from "../../../../common/config/model-selection.ts";
import {
  type AgentExecutionMode,
  cycleReplAgentExecutionMode,
  getAgentExecutionModeChangeMessage,
  toAgentExecutionMode,
} from "../../../agent/execution-mode.ts";
import { createRuntimeConfigManager } from "../../../runtime/model-config.ts";

interface UseModelConfigInput {
  initialConfig?: HlvmConfig;
  initReady: boolean;
}

export interface UseModelConfigResult {
  modelSelection: ModelSelectionState;
  configuredContextWindow: number | undefined;
  agentExecutionMode: AgentExecutionMode;
  footerStatusMessage: string;
  footerContextUsageLabel: string;
  setFooterContextUsageLabel: (label: string) => void;
  applyRuntimeConfigState: (
    cfg: Record<string, unknown>,
    activeModelId?: string,
  ) => ModelSelectionState;
  refreshRuntimeConfigState: () => Promise<ModelSelectionState>;
  cycleAgentMode: () => void;
  flashFooterStatus: (message: string) => void;
}

export function useModelConfig(
  { initialConfig, initReady }: UseModelConfigInput,
): UseModelConfigResult {
  const replModeTouchedRef = useRef(false);
  const footerStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const [modelSelection, setModelSelection] = useState<ModelSelectionState>(
    () => createModelSelectionState(initialConfig),
  );
  const [configuredContextWindow, setConfiguredContextWindow] = useState<
    number | undefined
  >(getContextWindow(initialConfig));
  const [agentExecutionMode, setAgentExecutionMode] = useState<
    AgentExecutionMode
  >(() => toAgentExecutionMode(getPermissionMode(initialConfig)));
  const [footerStatusMessage, setFooterStatusMessage] = useState("");
  const [footerContextUsageLabel, setFooterContextUsageLabel] = useState("");

  // Cleanup footer timer on unmount
  useEffect(() => {
    return () => {
      if (footerStatusTimerRef.current) {
        clearTimeout(footerStatusTimerRef.current);
      }
    };
  }, []);

  const flashFooterStatus = useCallback((message: string) => {
    if (footerStatusTimerRef.current) {
      clearTimeout(footerStatusTimerRef.current);
    }
    setFooterStatusMessage(message);
    footerStatusTimerRef.current = setTimeout(() => {
      footerStatusTimerRef.current = null;
      setFooterStatusMessage("");
    }, 2200);
  }, []);

  const applyRuntimeConfigState = useCallback(
    (
      cfg: Record<string, unknown>,
      activeModelId?: string,
    ): ModelSelectionState => {
      const nextModelSelection = createModelSelectionState(cfg, activeModelId);
      setModelSelection((currentModelSelection: ModelSelectionState) =>
        isModelSelectionStateEqual(currentModelSelection, nextModelSelection)
          ? currentModelSelection
          : nextModelSelection
      );
      setConfiguredContextWindow(getContextWindow(cfg));
      if (!replModeTouchedRef.current) {
        setAgentExecutionMode(toAgentExecutionMode(getPermissionMode(cfg)));
      }
      return nextModelSelection;
    },
    [],
  );

  const cycleAgentMode = useCallback(() => {
    const nextMode = cycleReplAgentExecutionMode(agentExecutionMode);
    replModeTouchedRef.current = true;
    setAgentExecutionMode(nextMode);
    flashFooterStatus(getAgentExecutionModeChangeMessage(nextMode));
  }, [agentExecutionMode, flashFooterStatus]);

  const refreshRuntimeConfigState = useCallback(async (): Promise<
    ModelSelectionState
  > => {
    const runtimeConfig = await createRuntimeConfigManager();
    const ensuredModel = await runtimeConfig.ensureInitialModelConfigured();
    const runtimeSnapshot = runtimeConfig.getConfig();
    return applyRuntimeConfigState(
      runtimeSnapshot as unknown as Record<string, unknown>,
      ensuredModel.model,
    );
  }, [applyRuntimeConfigState]);

  // Sync config on initial load
  useEffect(() => {
    if (initialConfig) {
      applyRuntimeConfigState(
        initialConfig as unknown as Record<string, unknown>,
      );
      return;
    }

    refreshRuntimeConfigState()
      .catch(() => {});
  }, [applyRuntimeConfigState, initialConfig, refreshRuntimeConfigState]);

  // Refresh when runtime becomes ready
  useEffect(() => {
    if (!initReady) return;
    refreshRuntimeConfigState()
      .catch(() => {});
  }, [initReady, refreshRuntimeConfigState]);

  return {
    modelSelection,
    configuredContextWindow,
    agentExecutionMode,
    footerStatusMessage,
    footerContextUsageLabel,
    setFooterContextUsageLabel,
    applyRuntimeConfigState,
    refreshRuntimeConfigState,
    cycleAgentMode,
    flashFooterStatus,
  };
}
