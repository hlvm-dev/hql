/**
 * HLVM Ink REPL - Initialization Hook
 * Handles runtime initialization, AI import, memory loading
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { initializeRuntime } from "../../../../common/runtime-initializer.ts";
import { runtimeProgress, type InitProgressEvent } from "../../../../common/runtime-progress.ts";
import { prewarmFileIndex } from "../../repl/file-search.ts";
import { ReplState } from "../../repl/state.ts";
import {
  initReplState,
  startReplHistoryInit,
} from "../../repl/init-repl-state.ts";
import { getMedia } from "../../repl/context.ts";
import { refreshKeybindingLookup } from "../keybindings/index.ts";
import { setCustomKeybindingsSnapshot } from "../keybindings/custom-bindings.ts";
import { log } from "../../../api/log.ts";
import { getErrorMessage } from "../../../../common/utils.ts";
import { createRuntimeConfigManager } from "../../../runtime/model-config.ts";
import {
  type ConfiguredModelReadiness,
  type ConfiguredModelReadinessState,
  getConfiguredModelReadiness,
  getModelReadiness,
} from "../../../runtime/configured-model-readiness.ts";
import { getRuntimeHostHealth } from "../../../runtime/host-client.ts";
import { getHlvmRuntimeBaseUrl } from "../../../runtime/host-config.ts";
import {
  checkForUpdate,
  type UpdateInfo,
} from "../../utils/update-check.ts";

interface InitializationState {
  loading: boolean;
  ready: boolean;
  readyTime: number;
  errors: string[];
  aiReadiness: ConfiguredModelReadinessState;
  /** True if AI engine (globalThis.ai) is actually available */
  aiAvailable: boolean;
  /** Runtime-host reason when AI is not accepting requests yet */
  aiReadyReason: string | null;
  /** True if the default AI model needs to be downloaded */
  needsModelSetup: boolean;
  /** The model name that needs to be downloaded */
  modelToSetup: string;
  /** Current initialization progress (only set during loading) */
  progress?: InitProgressEvent;
  /** Available update info (null if up-to-date or check failed) */
  updateInfo: UpdateInfo | null;
  refreshAiReadiness: (
    modelId?: string,
    options?: { force?: boolean },
  ) => Promise<void>;
}

export interface InitializationReadinessState {
  aiReadiness: ConfiguredModelReadinessState;
  needsModelSetup: boolean;
  modelToSetup: string;
}

export function resolveInitializationReadinessState(
  readiness: ConfiguredModelReadiness,
  aiAvailable: boolean,
): InitializationReadinessState {
  const needsModelSetup = readiness.state === "setup_required";
  return {
    aiReadiness: aiAvailable ? readiness.state : "unavailable",
    needsModelSetup,
    modelToSetup: needsModelSetup ? readiness.modelName : "",
  };
}

export function useInitialization(state: ReplState): InitializationState {
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [readyTime, setReadyTime] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [progress, setProgress] = useState<InitProgressEvent | undefined>();
  const [aiReadiness, setAiReadiness] = useState<ConfiguredModelReadinessState>(
    "unavailable",
  );
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiReadyReason, setAiReadyReason] = useState<string | null>(null);
  const [needsModelSetup, setNeedsModelSetup] = useState(false);
  const [modelToSetup, setModelToSetup] = useState("");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const initialized = useRef(false);
  const lastReadinessModelIdRef = useRef<string | null>(null);

  const applyModelReadinessState = useCallback(
    (
      readiness: ConfiguredModelReadiness,
      isAiAvailable: boolean,
    ): void => {
      const nextState = resolveInitializationReadinessState(
        readiness,
        isAiAvailable,
      );

      setAiReadiness((current: ConfiguredModelReadinessState) =>
        current === nextState.aiReadiness ? current : nextState.aiReadiness
      );
      setAiAvailable((current: boolean) =>
        current === isAiAvailable ? current : isAiAvailable
      );
      setNeedsModelSetup((current: boolean) =>
        current === nextState.needsModelSetup
          ? current
          : nextState.needsModelSetup
      );
      setModelToSetup((current: string) =>
        current === nextState.modelToSetup ? current : nextState.modelToSetup
      );
    },
    [],
  );

  const readAiAvailability = useCallback(async (): Promise<{
    available: boolean;
    reason: string | null;
  }> => {
    const globalAi = (globalThis as Record<string, unknown>).ai;
    const hasGlobalAi = globalAi != null &&
      (typeof globalAi === "object" || typeof globalAi === "function");
    if (!hasGlobalAi) {
      return {
        available: false,
        reason: "AI runtime is unavailable.",
      };
    }

    try {
      const health = await getRuntimeHostHealth();
      if (health?.aiReady) {
        return { available: true, reason: null };
      }
      return {
        available: false,
        reason: health?.aiReadyReason?.trim() || "Starting AI engine...",
      };
    } catch (error) {
      return {
        available: false,
        reason: getErrorMessage(error),
      };
    }
  }, []);

  const refreshAiReadiness = useCallback(
    async (modelId?: string, options?: { force?: boolean }): Promise<void> => {
      const normalizedModelId = modelId?.trim() || undefined;
      if (
        !options?.force &&
        normalizedModelId &&
        lastReadinessModelIdRef.current === normalizedModelId
      ) {
        return;
      }

      const aiStatus = await readAiAvailability();

      const readiness = normalizedModelId
        ? await getModelReadiness(normalizedModelId)
        : await getConfiguredModelReadiness();
      lastReadinessModelIdRef.current = readiness.modelId;
      applyModelReadinessState(readiness, aiStatus.available);
      setAiReadyReason(aiStatus.reason);
    },
    [applyModelReadinessState, readAiAvailability],
  );

  useEffect(() => {
    let source: EventSource | null = null;
    let cancelled = false;
    (async () => {
      const health = await getRuntimeHostHealth().catch(() => null);
      if (cancelled) return;
      const token = health?.authToken;
      if (!token) return;
      const baseUrl = getHlvmRuntimeBaseUrl();
      try {
        source = new EventSource(
          `${baseUrl}/api/models/stream?auth=${encodeURIComponent(token)}`,
        );
        source.addEventListener("models_updated", () => {
          refreshAiReadiness(undefined, { force: true }).catch(() => {});
        });
        source.onerror = () => { /* best-effort; serve restarts reconnect */ };
      } catch {
        // EventSource unavailable or URL unreachable — existing refresh
        // triggers (turn completion, model switch) still run.
      }
    })();
    return () => {
      cancelled = true;
      source?.close();
    };
  }, [refreshAiReadiness]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const startTime = Date.now();

    // Subscribe to progress events
    const unsubscribe = runtimeProgress.subscribe((event) => {
      setProgress(event);
    });

    (async () => {
      try {
        // Pre-index files in background for @ mention feature
        prewarmFileIndex().catch(() => {});

        // Check for updates in background (non-blocking, never-throw)
        checkForUpdate().then((info) => {
          if (info) setUpdateInfo(info);
        }).catch(() => {});

        // Load persistent history early (in parallel with other init)
        const historyInit = startReplHistoryInit(state, (error) => {
          log.error(`History init failed: ${getErrorMessage(error)}`);
        });

        // Initialize the local REPL shell without blocking on AI engine startup.
        await initializeRuntime({ ai: false });

        const initResult = await initReplState({
          state,
          initHistory: "defer",
          historyInitPromise: historyInit,
          runtime: { getMedia },
        });

        const loadErrors: string[] = [];
        if (initResult.moduleResult) {
          if (initResult.moduleResult.errors.length > 0) {
            loadErrors.push(...initResult.moduleResult.errors);
          }
        }

        const aiStatus = await readAiAvailability();
        setAiAvailable(aiStatus.available);
        setAiReadyReason(aiStatus.reason);

        if (initResult.bindingsResult?.errors.length) {
          loadErrors.push(...initResult.bindingsResult.errors);
        }

        setErrors(loadErrors);
        (globalThis as Record<string, unknown>).__hlvmStartupWarnings =
          loadErrors;
        const runtimeConfig = await createRuntimeConfigManager();
        const runtimeSnapshot = await runtimeConfig.sync();
        setCustomKeybindingsSnapshot(runtimeSnapshot.keybindings);
        refreshKeybindingLookup();

        // Register API names for tab completion
        for (
          const name of [
            "config",
            "bindings",
            "session",
            "history",
            "ai",
            "runtime",
          ]
        ) {
          state.addBinding(name);
        }

        await historyInit;

        await refreshAiReadiness(undefined, { force: true });

        setReadyTime(Date.now() - startTime);
        setProgress(undefined);  // Clear progress when done
        setLoading(false);
        setReady(true);
      } catch (error) {
        const startupErrors = [getErrorMessage(error)];
        setErrors(startupErrors);
        (globalThis as Record<string, unknown>).__hlvmStartupWarnings =
          startupErrors;
        setProgress(undefined);
        setLoading(false);
      } finally {
        unsubscribe();
      }
    })();
  }, [readAiAvailability, refreshAiReadiness, state]);

  return {
    loading,
    ready,
    readyTime,
    errors,
    progress,
    aiReadiness,
    aiAvailable,
    aiReadyReason,
    needsModelSetup,
    modelToSetup,
    updateInfo,
    refreshAiReadiness,
  };
}
