/**
 * ModelBrowser Panel
 *
 * Browse installed and available Ollama models.
 * Download new models with progress tracking.
 */

import { delay } from "@std/async";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { useSemanticColors, useTheme } from "../../theme/index.ts";
import { useTaskManager } from "../hooks/useTaskManager.ts";
import { formatBytes } from "../../../../common/limits.ts";
import {
  isModelPullTask,
  isTaskActive,
  type ModelPullTask,
  type TaskEvent,
} from "../../repl/task-manager/types.ts";
import { getTaskManager } from "../../repl/task-manager/index.ts";
import { handleTextEditingKey, isCtrlShortcut } from "../utils/text-editing.ts";
import {
  normalizeModelBrowserSearchQuery,
  normalizeModelBrowserSearchState,
} from "../utils/model-browser-loading.ts";
import { getPlatform } from "../../../../platform/platform.ts";
import { getErrorMessage, truncate } from "../../../../common/utils.ts";
import { DEFAULT_OLLAMA_ENDPOINT } from "../../../../common/config/types.ts";
import { isSelectedModelActive } from "../../../../common/config/model-selection.ts";
import {
  capabilitiesToDisplayTags,
  type ModelInfo,
} from "../../../providers/types.ts";
import { isOllamaCloudModel } from "../../../providers/ollama/cloud.ts";
import {
  findProviderMetaKey,
  getProviderSearchTerms,
  parseModelString,
} from "../../../providers/index.ts";
import type { RuntimeModelDiscoveryResponse } from "../../../runtime/model-protocol.ts";
import {
  deleteRuntimeModel,
  getRuntimeModelDiscovery,
  listRuntimeInstalledModels,
} from "../../../runtime/host-client.ts";
import { calculateScrollWindow } from "../completion/navigation.ts";
import { ListSearchField } from "./ListSearchField.tsx";
import {
  clampPanelWidth,
  clampVisibleRows,
  DEFAULT_TERMINAL_HEIGHT,
  DEFAULT_TERMINAL_WIDTH,
  MODEL_BROWSER_MAX_WIDTH,
} from "../ui-constants.ts";
import {
  resolveOverlayFrame,
} from "../overlay/index.ts";
import {
  getModelStatusLabel,
  getStatusIndicator,
  MODEL_BROWSER_SELECT_ACTION_LABEL,
  type ModelStatusKind,
} from "./model-browser-status.ts";
import { ChromeChip } from "./ChromeChip.tsx";
import { buildBalancedTextRow } from "../utils/display-chrome.ts";
import { useConversationSpinnerFrame } from "../hooks/useConversationMotion.ts";
import {
  buildModelBrowserFocusLayout,
  buildModelBrowserScopeText,
  buildModelBrowserViewLayout,
} from "./model-browser-chrome.ts";
import { OverlayModal } from "./OverlayModal.tsx";
import { stringWidth } from "../../../tui-v2/ink/stringWidth.ts";

const platform = getPlatform();
const openUrl = (url: string) => platform.openUrl(url);

// ============================================================
// Types
// ============================================================

interface ModelBrowserProps {
  /** Callback when panel closes */
  onClose: () => void;
  /** Callback when model is selected (set as active) */
  onSelectModel?: (modelName: string) => void | Promise<void>;
  /** Optional callback after model is successfully set as default */
  onModelSet?: (modelName: string) => void;
  /** Scope label for the active selection (e.g. "default model", "plan mode model") */
  selectionScopeLabel?: string;
  /** Current active model */
  currentModel?: string;
  /** Whether the current model has already been explicitly configured */
  isCurrentModelConfigured?: boolean;
  /** Ollama endpoint */
  endpoint?: string;
  /** Render as a true modal overlay or legacy inline panel. */
  presentation?: "overlay" | "inline";
}

interface LocalModel {
  name: string;
  size: number;
}

interface RemoteModel {
  name: string;
  description: string;
  capabilities: string[];
  size?: string; // Size string from registry (e.g., "4.9GB")
  provider?: string; // Company/provider name (e.g., "Meta", "Google")
  isOllamaCloud?: boolean; // Ollama cloud variant (needs pull + possibly signin)
}

/** Cloud model from an API provider (OpenAI, Anthropic, Google) */
interface CloudModel {
  name: string; // e.g., "gpt-4o"
  displayName: string; // e.g., "GPT-4o"
  provider: string; // e.g., "openai"
  providerDisplay: string; // e.g., "OpenAI"
  capabilities: string[];
  needsKey?: boolean; // true if API key not set
  docsUrl?: string; // provider docs URL from backend SSOT
}

/** Download status for a model */
type DownloadStatus = "idle" | "downloading" | "cancelled" | "failed";

type DisplayModel = {
  name: string;
  isLocal: boolean;
  downloadStatus: DownloadStatus;
  size?: number; // Size in bytes (local models)
  sizeStr?: string; // Size string (remote models, e.g., "4.9GB")
  description?: string;
  capabilities?: string[];
  provider?: string; // Company/provider name
  docsUrl?: string; // Provider docs URL (SSOT from backend)
  progress?: {
    percent?: number;
    completed?: number;
    total?: number;
    status: string;
  };
  needsKey?: boolean; // true if API key not configured
};

type SelectionState = {
  index: number;
  name: string | null;
};

// ============================================================
// View Filter Types
// ============================================================

/** Filter modes for model browser view */
type FilterMode =
  | "all"
  | "installed"
  | "downloading"
  | "available"
  | "tools"
  | "vision"
  | "thinking"
  | "embedding"
  | "cloud";

/** Filter cycle order - discovery first */
const FILTER_CYCLE: readonly FilterMode[] = [
  "all",
  "available",
  "installed",
  "downloading",
  "tools",
  "vision",
  "thinking",
  "embedding",
  "cloud",
];

/** O(1) index lookup for filter cycling (avoids indexOf per Tab keypress) */
const FILTER_CYCLE_INDEX: ReadonlyMap<FilterMode, number> = new Map(
  FILTER_CYCLE.map((v, i) => [v, i]),
);

/** Filter display labels */
const FILTER_LABELS: Record<FilterMode, string> = {
  all: "All",
  installed: "Installed",
  downloading: "Downloading",
  available: "Not Installed",
  tools: "Tools",
  vision: "Vision",
  thinking: "Thinking",
  embedding: "Embedding",
  cloud: "Cloud",
};

/** Empty state messages for each filter */
const FILTER_EMPTY: Record<FilterMode, string> = {
  all: "No models found",
  installed: "No installed models",
  downloading: "No active downloads",
  available: "No models to install",
  tools: "No tool-capable models",
  vision: "No vision models",
  thinking: "No thinking models",
  embedding: "No embedding models",
  cloud: "No cloud-only models",
};

// ============================================================
// Model Catalog
// ============================================================

/** Extract brand name from model ID (e.g., "llama3.2:3b" → "Llama") */
function getBrandName(modelId: string): string {
  const base = modelId.split(/[:.]/)[0];
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : "";
}

/** Build Ollama URL for model info page */
function getOllamaUrl(modelName: string): string {
  // Strip tag if present (e.g., "llama3.2:3b" → "llama3.2")
  const baseName = modelName.split(":")[0];
  return `https://ollama.com/library/${baseName}`;
}

/** Parse size string (e.g., "7.1GB", "776MB") to bytes for sorting */
function parseSizeToBytes(sizeStr: string): number {
  const match = sizeStr.match(/^([\d.]+)\s*(GB|MB|KB|B)?$/i);
  if (!match) return Infinity; // Unknown size goes to end
  const value = parseFloat(match[1]);
  const unit = (match[2] || "B").toUpperCase();
  switch (unit) {
    case "GB":
      return value * 1024 * 1024 * 1024;
    case "MB":
      return value * 1024 * 1024;
    case "KB":
      return value * 1024;
    default:
      return value;
  }
}

function isPracticalModel(name: string): boolean {
  // Cloud variants are always practical (run on Ollama's infrastructure)
  if (isOllamaCloudModel(name)) return true;
  const lower = name.toLowerCase();
  return !lower.includes("405b") && !lower.includes("671b") &&
    !lower.includes("70b");
}

function getCatalogSize(model: ModelInfo): string | undefined {
  const meta = (model.metadata || {}) as Record<string, unknown>;
  const sizes = Array.isArray(meta.sizes) ? meta.sizes : [];
  const first = sizes[0];
  return typeof first === "string" ? first : undefined;
}

function toRemoteModel(model: ModelInfo): RemoteModel {
  const meta = (model.metadata || {}) as Record<string, unknown>;
  const baseDescription = model.displayName ?? model.name;
  const extraDescription = typeof meta.description === "string"
    ? meta.description
    : "";
  const description = extraDescription
    ? `${baseDescription} - ${extraDescription}`
    : baseDescription;
  const tags = capabilitiesToDisplayTags(model.capabilities);
  const isCloud = isOllamaCloudModel(model.name);
  // Use provider from catalog metadata (SSOT), fall back to brand extraction
  const provider = typeof meta.provider === "string" && meta.provider
    ? meta.provider
    : typeof meta.providerDisplayName === "string" && meta.providerDisplayName
    ? meta.providerDisplayName
    : getBrandName(model.name);

  return {
    name: model.name,
    description,
    capabilities: isCloud ? [...tags, "cloud"] : tags,
    size: getCatalogSize(model),
    provider,
    isOllamaCloud: isCloud,
  };
}

function toLocalModel(model: ModelInfo): LocalModel {
  return {
    name: model.name,
    size: model.size || 0,
  };
}

function toCloudModel(model: ModelInfo): CloudModel | null {
  const provider = typeof model.metadata?.provider === "string"
    ? model.metadata.provider
    : "";
  if (!provider || provider === "ollama") return null;

  return {
    name: model.name,
    displayName: model.displayName ?? model.name,
    provider,
    providerDisplay: typeof model.metadata?.providerDisplayName === "string"
      ? model.metadata.providerDisplayName
      : provider,
    capabilities: model.capabilities ?? [],
    needsKey: model.metadata?.apiKeyConfigured === false,
    docsUrl: typeof model.metadata?.providerDocsUrl === "string"
      ? model.metadata.providerDocsUrl
      : undefined,
  };
}

function toRemoteModels(models: ModelInfo[]): RemoteModel[] {
  return models
    .filter((m) => isPracticalModel(m.name))
    .map((m) => toRemoteModel(m))
    .sort((a, b) =>
      parseSizeToBytes(a.size || "") - parseSizeToBytes(b.size || "")
    );
}

function toCloudModels(models: ModelInfo[]): CloudModel[] {
  return models
    .map(toCloudModel)
    .filter((model): model is CloudModel => model !== null);
}

function applyDiscoveryPayload(
  snapshot: Pick<RuntimeModelDiscoveryResponse, "remoteModels" | "cloudModels">,
  setRemoteModels: React.Dispatch<React.SetStateAction<RemoteModel[]>>,
  setCloudModels: React.Dispatch<React.SetStateAction<CloudModel[]>>,
): void {
  setRemoteModels(toRemoteModels(snapshot.remoteModels));
  setCloudModels(toCloudModels(snapshot.cloudModels));
}

/** Filter models based on current mode */
function filterByMode(
  models: DisplayModel[],
  filter: FilterMode,
): DisplayModel[] {
  switch (filter) {
    case "all":
      return models;
    case "installed":
      return models.filter((m) => m.isLocal);
    case "downloading":
      return models.filter((m) =>
        m.downloadStatus === "downloading" ||
        m.downloadStatus === "cancelled" ||
        m.downloadStatus === "failed"
      );
    case "available":
      return models.filter((m) => !m.isLocal);
    case "tools":
    case "vision":
    case "thinking":
    case "embedding":
    case "cloud":
      return models.filter((m) => m.capabilities?.includes(filter));
  }
}

function getDisplayModelSearchText(model: DisplayModel): string {
  const [parsedProvider] = parseModelString(model.name);
  const providerKey = parsedProvider ?? findProviderMetaKey(model.provider);
  const providerTerms = getProviderSearchTerms(providerKey);

  return [
    model.name,
    model.provider ?? "",
    model.description ?? "",
    ...(model.capabilities ?? []),
    ...providerTerms,
  ].join("\n").toLowerCase();
}

function isApiProviderCloudModel(model: DisplayModel): boolean {
  return Boolean(model.capabilities?.includes("cloud")) && !model.isLocal &&
    model.name.includes("/") && !model.name.startsWith("ollama/");
}

function isPullableOllamaCloudModel(model: DisplayModel): boolean {
  return Boolean(model.capabilities?.includes("cloud")) && !model.isLocal &&
    (!model.name.includes("/") || model.name.startsWith("ollama/"));
}

function getModelStatusKind(
  model: DisplayModel,
  isActive: boolean,
  isPendingDelete: boolean,
): ModelStatusKind {
  if (isPendingDelete) return "pending-delete";
  if (isActive) return "active";
  if (model.isLocal) return "installed";
  if (model.downloadStatus === "downloading") return "downloading";
  if (model.downloadStatus === "cancelled") return "cancelled";
  if (model.downloadStatus === "failed") return "failed";
  if (model.needsKey) return "needs-key";
  if (isApiProviderCloudModel(model)) return "cloud";
  return "available";
}

function buildModelRowDetails(
  model: DisplayModel,
  statusKind: ModelStatusKind,
): string {
  const parts: string[] = [];
  const isExceptionalStatus = statusKind === "downloading" ||
    statusKind === "cancelled" || statusKind === "failed" ||
    statusKind === "needs-key" || statusKind === "pending-delete";

  if (model.downloadStatus === "downloading" && model.progress) {
    const { progress } = model;
    parts.push(
      progress.total && progress.completed
        ? `${Math.round(progress.percent || 0)}% ${
          formatBytes(progress.completed)
        }/${formatBytes(progress.total)}`
        : progress.status || "...",
    );
  } else if (model.downloadStatus === "cancelled" && model.progress) {
    const { progress } = model;
    parts.push(
      progress.total && progress.completed
        ? `cancelled ${Math.round(progress.percent || 0)}%`
        : "cancelled",
    );
  } else if (model.downloadStatus === "failed") {
    parts.push("failed");
  } else if (model.size) {
    parts.push(formatBytes(model.size));
  } else if (model.sizeStr) {
    parts.push(model.sizeStr);
  }

  if (isExceptionalStatus) {
    parts.push(`[${getModelStatusLabel(statusKind)}]`);
  }

  return parts.join("  ");
}

// ============================================================
// Model Item Component
// ============================================================

function ModelItem({
  model,
  isSelected,
  isActive,
  isPendingDelete = false,
  contentWidth,
}: {
  model: DisplayModel;
  isSelected: boolean;
  isActive: boolean;
  isPendingDelete?: boolean;
  contentWidth: number;
}): React.ReactElement {
  const { color } = useTheme();

  const statusKind = getModelStatusKind(model, isActive, isPendingDelete);
  const indicator = getStatusIndicator(statusKind);
  const rowPrefix = `${isSelected ? ">" : " "} ${indicator}`;
  const rowLayout = buildBalancedTextRow(
    contentWidth,
    `${rowPrefix}${model.name}`,
    buildModelRowDetails(model, statusKind),
    {
      maxRightWidth: Math.max(18, Math.floor(contentWidth * 0.34)),
    },
  );
  const rowColor = isPendingDelete || model.downloadStatus === "cancelled" ||
      model.downloadStatus === "failed" || model.needsKey
    ? color("error")
    : isActive || model.isLocal
    ? color("success")
    : model.downloadStatus === "downloading"
    ? color("warning")
    : isSelected
    ? color("accent")
    : undefined;
  const fullRowText = buildFullWidthRowText(rowLayout, contentWidth);

  return (
    <Box width={contentWidth}>
      <Text color={rowColor} bold={isSelected || isActive}>
        {fullRowText}
      </Text>
    </Box>
  );
}

function buildFullWidthRowText(
  layout: { leftText: string; rightText: string; gapWidth: number },
  width: number,
): string {
  const row = `${layout.leftText}${" ".repeat(layout.gapWidth)}${
    layout.rightText
  }`;
  return padDisplayText(row, width);
}

function padDisplayText(text: string, width: number): string {
  const displayWidth = stringWidth(text);
  if (displayWidth >= width) return text;
  return `${text}${" ".repeat(width - displayWidth)}`;
}

// ============================================================
// Main Component
// ============================================================

export function ModelBrowser({
  onClose,
  onSelectModel,
  onModelSet,
  selectionScopeLabel = "default model",
  currentModel,
  isCurrentModelConfigured = false,
  endpoint = DEFAULT_OLLAMA_ENDPOINT,
  presentation = "overlay",
}: ModelBrowserProps): React.ReactElement {
  const { color } = useTheme();
  const sc = useSemanticColors();
  const { stdout } = useStdout();
  const { tasks, cancel } = useTaskManager();
  const manager = useMemo(() => getTaskManager(endpoint), [endpoint]);
  const terminalWidth = stdout?.columns ?? DEFAULT_TERMINAL_WIDTH;
  const availableHeight = stdout?.rows ?? DEFAULT_TERMINAL_HEIGHT;
  const visibleRowCount = clampVisibleRows(availableHeight, {
    reservedRows: 18,
    minRows: 4,
    maxRows: 16,
  });
  const requestedPanelWidth = clampPanelWidth(terminalWidth, {
    maxWidth: MODEL_BROWSER_MAX_WIDTH,
  });
  const overlayVisibleRowCount = clampVisibleRows(availableHeight, {
    reservedRows: 16,
    minRows: 4,
    maxRows: 16,
  });
  const overlayFrame = useMemo(
    () =>
      resolveOverlayFrame(
        requestedPanelWidth,
        overlayVisibleRowCount + 16,
        {
          minWidth: 48,
          minHeight: 18,
          viewport: { columns: terminalWidth, rows: availableHeight },
        },
      ),
    [availableHeight, overlayVisibleRowCount, requestedPanelWidth, terminalWidth],
  );
  const panelWidth = presentation === "overlay"
    ? overlayFrame.width
    : requestedPanelWidth;
  const contentWidth = panelWidth - 4;
  const browserContentWidth = presentation === "overlay"
    ? Math.max(20, contentWidth - 2)
    : contentWidth;
  const defaultModelWidth = Math.max(
    22,
    Math.min(48, Math.floor(browserContentWidth * 0.34)),
  );
  const selectionScopeTitle = selectionScopeLabel.charAt(0).toUpperCase() +
    selectionScopeLabel.slice(1);

  // State
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [remoteModels, setRemoteModels] = useState<RemoteModel[]>([]);
  const [cloudModels, setCloudModels] = useState<CloudModel[]>([]);
  const [selection, setSelection] = useState<SelectionState>({
    index: 0,
    name: null,
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCursor, setSearchCursor] = useState(0);
  const [loading, setLoading] = useState(true);
  const [discoveryLoading, setDiscoveryLoading] = useState(true);
  const [discoveryRefreshing, setDiscoveryRefreshing] = useState(false);
  const [discoveryRefreshFailed, setDiscoveryRefreshFailed] = useState(false);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const loadingSpinner = useConversationSpinnerFrame(
    loading || discoveryLoading || discoveryRefreshing,
  );
  // Track model name pending auto-select after pull completes (Ollama cloud flow)
  const pendingSelectRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);
  const activeFilterMode: FilterMode = filterMode;
  const normalizedSearchQuery = useMemo(
    () => normalizeModelBrowserSearchQuery(searchQuery).trim(),
    [searchQuery],
  );

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const selectAsDefaultModel = useCallback(
    async (modelName: string): Promise<void> => {
      if (!onSelectModel) return;

      setIsSelecting(true);
      setStatusMessage(`Setting ${selectionScopeLabel}: ${modelName}...`);
      try {
        await onSelectModel(modelName);
        if (!isMountedRef.current) return;
        setStatusMessage(`${selectionScopeTitle} set: ${modelName}`);
        onModelSet?.(modelName);
        // Brief confirmation dwell so user can see success before panel closes.
        await delay(1200);
        if (!isMountedRef.current) return;
        onClose();
      } catch (error) {
        if (!isMountedRef.current) return;
        const message = getErrorMessage(error);
        setStatusMessage(
          `Failed to set ${selectionScopeLabel}: ${message} (press Ctrl+O for model info)`,
        );
      } finally {
        if (isMountedRef.current) {
          setIsSelecting(false);
        }
      }
    },
    [
      onClose,
      onModelSet,
      onSelectModel,
      selectionScopeLabel,
      selectionScopeTitle,
    ],
  );

  const modelPullTasks = useMemo(() => {
    const byModel = new Map<string, ModelPullTask[]>();
    const activeByModel = new Map<string, ModelPullTask>();

    for (const task of tasks) {
      if (!isModelPullTask(task)) continue;

      const tasksForModel = byModel.get(task.modelName);
      if (tasksForModel) {
        tasksForModel.push(task);
      } else {
        byModel.set(task.modelName, [task]);
      }

      // Preserve first active task in task-list order (matches Array.find behavior).
      if (isTaskActive(task) && !activeByModel.has(task.modelName)) {
        activeByModel.set(task.modelName, task);
      }
    }

    return { byModel, activeByModel };
  }, [tasks]);

  const fetchModels = useCallback(async () => {
    try {
      const models = await listRuntimeInstalledModels("ollama");
      setLocalModels(models.map(toLocalModel));
    } catch {
      setLocalModels([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDiscovery = useCallback(
    async (
      options: { refresh: boolean; preserveExistingOnFailure?: boolean },
    ) => {
      try {
        const discovery = await getRuntimeModelDiscovery({
          refresh: options.refresh,
        });
        if (!isMountedRef.current) return;
        applyDiscoveryPayload(
          discovery,
          setRemoteModels,
          setCloudModels,
        );
        setDiscoveryRefreshFailed(
          discovery.failed &&
            (!options.preserveExistingOnFailure ||
              (
                discovery.remoteModels.length === 0 &&
                discovery.cloudModels.length === 0
              )),
        );
      } catch {
        if (!isMountedRef.current) return;
        if (!options.preserveExistingOnFailure) {
          setRemoteModels([]);
          setCloudModels([]);
        }
        setDiscoveryRefreshFailed(true);
      } finally {
        if (isMountedRef.current) {
          setDiscoveryLoading(false);
          setDiscoveryRefreshing(false);
        }
      }
    },
    [],
  );

  // Fetch local models on mount
  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  useEffect(() => {
    let cancelled = false;

    setDiscoveryLoading(true);
    setDiscoveryRefreshing(true);
    setDiscoveryRefreshFailed(false);

    void getRuntimeModelDiscovery()
      .then((result) => {
        if (cancelled) return;
        applyDiscoveryPayload(result, setRemoteModels, setCloudModels);
        setDiscoveryLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setDiscoveryLoading(false);
        }
      })
      .finally(() => {
        if (!cancelled) {
          void fetchDiscovery({
            refresh: true,
            preserveExistingOnFailure: true,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fetchDiscovery]);

  // Auto-refresh when downloads complete.
  useEffect(() => {
    const unsubscribe = manager.onEvent((event: TaskEvent) => {
      if (event.type === "task:completed") {
        const task = manager.getTask(event.taskId);
        if (task && isModelPullTask(task)) {
          fetchModels();
          if (pendingSelectRef.current === task.modelName && onSelectModel) {
            pendingSelectRef.current = null;
            void selectAsDefaultModel(task.modelName);
          }
        }
      }
    });
    return unsubscribe;
  }, [
    fetchModels,
    manager,
    onSelectModel,
    selectAsDefaultModel,
  ]);

  // Build display list - POSITION STABLE (models never move regardless of status)
  // Order is determined by remoteModels (sorted by size), local status is just a flag
  const { viewModels, displayModels } = useMemo((): {
    viewModels: DisplayModel[];
    displayModels: DisplayModel[];
  } => {
    const result: DisplayModel[] = [];

    // Build lookup maps
    const localMap = new Map<string, LocalModel>(
      localModels.map((m: LocalModel) => [m.name, m]),
    );
    const remoteNameSet = new Set(remoteModels.map((m: RemoteModel) => m.name));
    const pullTasksByModel = modelPullTasks.byModel;
    const activePullTasksByModel = modelPullTasks.activeByModel;

    // Helper to determine download status from task
    const getDownloadStatus = (
      task: ModelPullTask | undefined,
    ): DownloadStatus => {
      if (!task) return "idle";
      if (task.status === "running" || task.status === "pending") {
        return "downloading";
      }
      if (task.status === "cancelled") return "cancelled";
      if (task.status === "failed") return "failed";
      return "idle"; // completed tasks become idle (model is local)
    };

    // Helper to find most relevant task (prefer active over cancelled/failed)
    // If model is local, don't show stale cancelled/failed tasks
    const findRelevantTask = (
      modelName: string,
      isLocal: boolean,
    ): ModelPullTask | undefined => {
      // Always prefer active tasks (running/pending)
      const activeTask = activePullTasksByModel.get(modelName);
      if (activeTask) return activeTask;
      // For local models, don't show stale cancelled/failed status
      // (the model was successfully downloaded after the failed attempt)
      if (isLocal) return undefined;
      // For non-local models, show cancelled/failed for resume UX
      const tasksForModel = pullTasksByModel.get(modelName);
      if (!tasksForModel) return undefined;
      for (const task of tasksForModel) {
        if (task.status === "cancelled" || task.status === "failed") {
          return task;
        }
      }
      return undefined;
    };

    // Build from remoteModels (stable order - sorted by size)
    // Mark as local if exists in localMap
    for (const model of remoteModels) {
      const local = localMap.get(model.name);
      const isLocal = !!local;
      const task = findRelevantTask(model.name, isLocal);
      const downloadStatus = getDownloadStatus(task);
      const capabilities = model.capabilities && model.capabilities.length > 0
        ? model.capabilities
        : undefined;
      result.push({
        name: model.name,
        isLocal: !!local,
        downloadStatus,
        size: local?.size,
        sizeStr: model.isOllamaCloud && !local ? "Cloud" : model.size,
        description: model.description,
        capabilities,
        provider: model.provider || getBrandName(model.name),
        progress: task?.progress,
      });
    }

    // Add local-only models (not in registry) at the end
    for (const model of localModels) {
      if (!remoteNameSet.has(model.name)) {
        const task = findRelevantTask(model.name, true); // Always local
        const downloadStatus = getDownloadStatus(task);
        result.push({
          name: model.name,
          isLocal: true,
          downloadStatus,
          size: model.size,
          provider: getBrandName(model.name),
          progress: task?.progress,
        });
      }
    }

    // Append cloud models (API providers: OpenAI, Anthropic, Google)
    for (const model of cloudModels) {
      const fullName = `${model.provider}/${model.name}`;
      const tags = capabilitiesToDisplayTags(model.capabilities);
      tags.push("cloud");
      result.push({
        name: fullName,
        isLocal: false,
        downloadStatus: "idle",
        sizeStr: model.needsKey ? "No key" : "Cloud",
        description: model.displayName,
        capabilities: tags,
        provider: model.needsKey
          ? `${model.providerDisplay} *`
          : model.providerDisplay,
        docsUrl: model.docsUrl,
        needsKey: model.needsKey,
      });
    }

    // Apply filter mode
    const viewModels = filterByMode(result, filterMode);

    // Filter by search within current view (name, provider, capabilities, description)
    const q = normalizedSearchQuery.toLowerCase();
    const displayModels = q
      ? viewModels.filter(
        (m) => getDisplayModelSearchText(m).includes(q),
      )
      : viewModels;

    return { viewModels, displayModels };
  }, [
    localModels,
    remoteModels,
    cloudModels,
    modelPullTasks,
    normalizedSearchQuery,
    filterMode,
  ]);

  // Keep selection stable by model name (avoid index jumps when list updates)
  useEffect(() => {
    setSelection((current: SelectionState) => {
      if (displayModels.length === 0) {
        if (current.index === 0 && current.name === null) return current;
        return { index: 0, name: null };
      }

      if (current.name) {
        const idx = displayModels.findIndex((m: DisplayModel) =>
          m.name === current.name
        );
        if (idx >= 0) {
          if (idx === current.index) return current;
          return { index: idx, name: current.name };
        }
      }

      const firstName = displayModels[0]?.name ?? null;
      if (current.index === 0 && current.name === firstName) return current;
      return { index: 0, name: firstName };
    });
  }, [displayModels]);

  // Keyboard handling
  useInput((input, key) => {
    const clearStatus = () => {
      if (statusMessage) setStatusMessage(null);
    };

    const resetSelection = () => {
      setSelection({ index: 0, name: null });
    };

    const moveSelection = (delta: number) => {
      if (displayModels.length === 0) return;
      setSelection((current: SelectionState) => {
        const nextIndex = Math.max(
          0,
          Math.min(displayModels.length - 1, current.index + delta),
        );
        const name = displayModels[nextIndex]?.name ?? null;
        return { index: nextIndex, name };
      });
      setPendingDelete(null);
      clearStatus();
    };

    const performSelectionAction = () => {
      const model = displayModels[selection.index] ?? displayModels[0];
      if (!model) return;

      if (onSelectModel && isSelectedModelActive(model.name, currentModel)) {
        if (!isCurrentModelConfigured) {
          void selectAsDefaultModel(model.name);
          return;
        }
        setStatusMessage(`Already ${selectionScopeLabel}: ${model.name}`);
        return;
      }

      // Cloud models without API key
      if (model.needsKey) {
        const provider = model.name.split("/")[0];
        setStatusMessage(
          `Set ${provider.toUpperCase()}_API_KEY to use this model`,
        );
        return;
      }

      // API provider cloud models: select directly (always available, no download)
      if (isApiProviderCloudModel(model) && onSelectModel) {
        void selectAsDefaultModel(model.name);
        return;
      }

      if (model.isLocal && onSelectModel) {
        void selectAsDefaultModel(model.name);
        return;
      }
      if (model.isLocal && !onSelectModel) {
        onClose();
        return;
      }
      // Non-local models (including Ollama cloud) go through pull
      if (
        !model.isLocal && model.downloadStatus !== "downloading" &&
        !isApiProviderCloudModel(model)
      ) {
        // Remember which model to auto-select after pull completes
        if (onSelectModel) pendingSelectRef.current = model.name;
        try {
          manager.pullModel(model.name);
        } catch {
          // Already downloading - ignore
        }
      }
    };

    if (isSelecting) {
      // Allow escape while selecting so UI never feels hard-locked.
      if (key.escape) onClose();
      return;
    }

    // Navigation (clears pending delete)
    if (key.upArrow) {
      moveSelection(-1);
      return;
    }
    if (key.downArrow) {
      moveSelection(1);
      return;
    }

    // Tab cycles filter forward (clears pending delete)
    // Use functional update to avoid stale closure issues
    if (key.tab && !key.shift) {
      setFilterMode((current: FilterMode) => {
        const idx = FILTER_CYCLE_INDEX.get(current) ?? 0;
        return FILTER_CYCLE[(idx + 1) % FILTER_CYCLE.length];
      });
      resetSelection();
      setPendingDelete(null);
      clearStatus();
      return;
    }

    // Shift+Tab cycles filter backward (clears pending delete)
    // Use functional update to avoid stale closure issues
    if (key.tab && key.shift) {
      setFilterMode((current: FilterMode) => {
        const idx = FILTER_CYCLE_INDEX.get(current) ?? 0;
        return FILTER_CYCLE[
          (idx - 1 + FILTER_CYCLE.length) % FILTER_CYCLE.length
        ];
      });
      resetSelection();
      setPendingDelete(null);
      clearStatus();
      return;
    }

    // Ctrl+O opens model info page in browser
    if (isCtrlShortcut(input, key, "o") && displayModels[selection.index]) {
      const model = displayModels[selection.index];
      if (model.docsUrl) {
        openUrl(model.docsUrl);
      } else if (isPullableOllamaCloudModel(model)) {
        openUrl("https://ollama.com/cloud");
      } else {
        openUrl(getOllamaUrl(model.name));
      }
      return;
    }

    // Ctrl+D deletes a local model (with confirmation)
    if (isCtrlShortcut(input, key, "d") && displayModels[selection.index]) {
      const model = displayModels[selection.index];

      // Cloud models can't be deleted (API provider or Ollama cloud)
      if (
        isApiProviderCloudModel(model) || isPullableOllamaCloudModel(model)
      ) {
        setStatusMessage("Cloud models can't be deleted");
        return;
      }

      // Only allow delete for local models (not downloading or remote)
      if (!model.isLocal || model.downloadStatus === "downloading") return;

      if (isSelectedModelActive(model.name, currentModel)) {
        setPendingDelete(null);
        setStatusMessage(
          "Can't delete active model. Select another model first.",
        );
        return;
      }

      // First press: set pending confirmation
      if (pendingDelete !== model.name) {
        setPendingDelete(model.name);
        clearStatus();
        return;
      }

      // Second press (confirmation): execute delete
      (async () => {
        try {
          await deleteRuntimeModel(model.name);
          fetchModels(); // Refresh list
        } catch (error) {
          if (isMountedRef.current) {
            const message = error instanceof Error
              ? error.message
              : String(error);
            setStatusMessage(`Delete failed: ${message}`);
          }
        } finally {
          setPendingDelete(null);
        }
      })();
      return;
    }

    // Select/Download/Resume
    if (key.return) {
      setPendingDelete(null);
      clearStatus();
      performSelectionAction();
      return;
    }

    // Helper: find active pull task for a model name
    const findActivePullTask = (modelName: string) =>
      modelPullTasks.activeByModel.get(modelName);

    // Ctrl+X cancels the selected download
    if (isCtrlShortcut(input, key, "x") && displayModels[selection.index]) {
      const model = displayModels[selection.index];
      if (model.downloadStatus === "downloading") {
        const task = findActivePullTask(model.name);
        if (task) {
          cancel(task.id);
          return;
        }
      }
    }

    // Escape: Stack-based behavior (cancel pending → clear filter → cancel download → close)
    if (key.escape) {
      // 1. Cancel pending delete first
      if (pendingDelete) {
        setPendingDelete(null);
        return;
      }

      // 2. Clear the active filter
      if (searchQuery.length > 0) {
        setSearchQuery("");
        setSearchCursor(0);
        clearStatus();
        return;
      }

      // 3. Cancel download if selected model is downloading
      const selectedModel = displayModels[selection.index];
      if (selectedModel?.downloadStatus === "downloading") {
        const task = findActivePullTask(selectedModel.name);
        if (task) {
          cancel(task.id);
          return;
        }
      }

      // 4. Close panel
      onClose();
      return;
    }

    // Text editing shortcuts (Ctrl+A/E/W/U/K, word nav, arrows, backspace, typing)
    const result = handleTextEditingKey(
      input,
      key,
      searchQuery,
      searchCursor,
    );
    if (result) {
      const normalized = normalizeModelBrowserSearchState(
        result.value,
        result.cursor,
      );
      setSearchQuery(normalized.query);
      setSearchCursor(normalized.cursor);
      setPendingDelete(null);
      clearStatus();
    }
  });

  // Calculate next filter for footer hint
  const nextFilterIdx = ((FILTER_CYCLE_INDEX.get(activeFilterMode) ?? 0) + 1) %
    FILTER_CYCLE.length;
  const nextFilter = FILTER_LABELS[FILTER_CYCLE[nextFilterIdx]];
  const selectedModel = displayModels[selection.index] ?? displayModels[0] ??
    null;
  const scopeText = buildModelBrowserScopeText(
    selectionScopeTitle,
    currentModel,
    defaultModelWidth,
  );
  const overlayIntroText = scopeText;
  const hasDiscoveryResults = remoteModels.length > 0 || cloudModels.length > 0;
  const emptyStateMessage = discoveryRefreshFailed && !hasDiscoveryResults
    ? "Model catalog unavailable. Retry in a moment."
    : FILTER_EMPTY[activeFilterMode];
  const modelCountLabel = loading || discoveryLoading || discoveryRefreshing
    ? "loading"
    : normalizedSearchQuery
    ? `${displayModels.length}/${viewModels.length}`
    : `${displayModels.length}`;
  const viewLayout = buildModelBrowserViewLayout(
    browserContentWidth,
    FILTER_LABELS[activeFilterMode],
    modelCountLabel,
    nextFilter,
  );
  const selectedStatusKind = selectedModel
    ? getModelStatusKind(
      selectedModel,
      isSelectedModelActive(selectedModel.name, currentModel),
      pendingDelete === selectedModel.name,
    )
    : undefined;
  const selectedStatusLabel = selectedStatusKind
    ? getModelStatusLabel(selectedStatusKind)
    : !selectedModel && currentModel
    ? "default"
    : undefined;
  const selectedFocusDetail = selectedModel && selectedStatusKind
    ? buildModelRowDetails(selectedModel, selectedStatusKind)
    : selectedStatusLabel;
  const focusLayout = buildModelBrowserFocusLayout(
    browserContentWidth,
    selectedModel?.name ?? currentModel,
    selectedFocusDetail,
  );
  const overlayListRows = Math.min(10, Math.max(4, overlayFrame.height - 18));
  const listRowCount = presentation === "overlay"
    ? overlayListRows
    : visibleRowCount;
  const visibleWindow = calculateScrollWindow(
    selection.index,
    displayModels.length,
    listRowCount,
  );
  const visibleModels = displayModels.slice(
    visibleWindow.start,
    visibleWindow.end,
  );
  const hiddenModelCount = Math.max(0, displayModels.length - visibleModels.length);

  const browserContent = (
    <>
      {presentation === "inline"
        ? (
          <>
            <Box justifyContent="space-between">
              <ChromeChip text="Select model" tone="active" />
              <Text dimColor wrap="truncate-end">
                {scopeText}
              </Text>
            </Box>
            <Box>
              <Text color={sc.text.primary}>{viewLayout.leftText}</Text>
              {viewLayout.gapWidth > 0 && (
                <Text>{" ".repeat(viewLayout.gapWidth)}</Text>
              )}
              <Text color={sc.text.muted}>{viewLayout.rightText}</Text>
            </Box>
          </>
        )
        : (
          <>
            <Text color={sc.text.muted} wrap="truncate-end">
              {overlayIntroText}
            </Text>
            <Box>
              <Text color={sc.text.primary}>{viewLayout.leftText}</Text>
              {viewLayout.gapWidth > 0 && (
                <Text>{" ".repeat(viewLayout.gapWidth)}</Text>
              )}
              <Text color={sc.text.muted}>{viewLayout.rightText}</Text>
            </Box>
          </>
        )}

      <Box marginTop={1}>
        <ListSearchField
          query={searchQuery}
          cursor={searchCursor}
          width={browserContentWidth}
          placeholder="Filter models"
        />
      </Box>
      <Box marginTop={1}>
        <Text
          color={selectedModel ? sc.text.primary : sc.text.muted}
          bold
        >
          {buildFullWidthRowText(focusLayout, browserContentWidth)}
        </Text>
      </Box>

      {loading && (
        <Box marginTop={1}>
          <Text dimColor>{loadingSpinner} Loading installed models...</Text>
        </Box>
      )}
      {!loading && discoveryLoading && (
        <Box marginTop={1}>
          <Text dimColor>{loadingSpinner} Loading model catalog...</Text>
        </Box>
      )}
      {!loading && !discoveryLoading && discoveryRefreshing &&
        !hasDiscoveryResults && (
        <Box marginTop={1}>
          <Text dimColor>{loadingSpinner} Refreshing model catalog...</Text>
        </Box>
      )}

      {!loading && !discoveryLoading && !discoveryRefreshing &&
        displayModels.length === 0 && (
        <Box marginTop={1}>
          <Text dimColor wrap="truncate-end">
            {emptyStateMessage}
          </Text>
        </Box>
      )}

      {visibleModels.map((model: DisplayModel, i: number) => {
        const actualIndex = visibleWindow.start + i;
        return (
          <Box key={model.name}>
            <ModelItem
              model={model}
              isSelected={actualIndex === selection.index}
              isActive={isSelectedModelActive(model.name, currentModel)}
              isPendingDelete={pendingDelete === model.name}
              contentWidth={browserContentWidth}
            />
          </Box>
        );
      })}

      {hiddenModelCount > 0 && (
        <Text dimColor wrap="truncate-end">
          {padDisplayText(
            `... and ${hiddenModelCount} more model${
              hiddenModelCount === 1 ? "" : "s"
            }...`,
            browserContentWidth,
          )}
        </Text>
      )}

      <Box marginTop={1} flexDirection="column">
        {pendingDelete
          ? (
            <Box
              borderStyle="round"
              borderColor={color("error")}
              paddingX={1}
            >
              <Text color={color("error")} wrap="truncate-end">
                {padDisplayText(
                  `Press Ctrl+D again to delete "${
                    truncate(
                      pendingDelete,
                      Math.max(0, browserContentWidth - 36),
                      "…",
                    )
                  }", Esc to cancel`,
                  browserContentWidth - 2,
                )}
              </Text>
            </Box>
          )
          : statusMessage
          ? (
            <Text color={color("warning")} wrap="truncate-end">
              {padDisplayText(statusMessage, browserContentWidth)}
            </Text>
          )
          : (
            <>
              <Text dimColor wrap="truncate-end">
                {padDisplayText(
                  `↑↓ navigate · Enter ${MODEL_BROWSER_SELECT_ACTION_LABEL} · Tab ${nextFilter} · Esc close`,
                  browserContentWidth,
                )}
              </Text>
              <Text dimColor wrap="truncate-end">
                {padDisplayText(
                  `Type to filter · Ctrl+O info · Ctrl+D delete · Ctrl+X cancel`,
                  browserContentWidth,
                )}
              </Text>
            </>
          )}
      </Box>
    </>
  );

  if (presentation === "overlay") {
    return (
      <OverlayModal
        title="Select model"
        rightText="esc"
        width={overlayFrame.width}
        titleStyle="text"
      >
        <Box
          width={browserContentWidth}
          flexDirection="column"
          alignSelf="center"
        >
          {browserContent}
        </Box>
      </OverlayModal>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={color("primary")}
      paddingX={1}
      paddingY={1}
      width={panelWidth}
      alignSelf="center"
    >
      {browserContent}
    </Box>
  );
}
