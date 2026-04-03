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
  useLayoutEffect,
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
import { HighlightedText } from "./HighlightedText.tsx";
import { ListSearchField } from "./ListSearchField.tsx";
import {
  clampPanelWidth,
  clampVisibleRows,
  DEFAULT_TERMINAL_HEIGHT,
  DEFAULT_TERMINAL_WIDTH,
  MODEL_BROWSER_MAX_WIDTH,
} from "../ui-constants.ts";
import {
  clearOverlay,
  createModalOverlayScaffold,
  resolveOverlayFrame,
  shouldClearOverlay,
  themeToOverlayColors,
  writeToTerminal,
} from "../overlay/index.ts";
import {
  getModelStatusLabel,
  getStatusIndicator,
  MODEL_BROWSER_SELECT_ACTION_LABEL,
  type ModelStatusKind,
} from "./model-browser-status.ts";
import { ChromeChip } from "./ChromeChip.tsx";
import { buildSectionLabelText } from "../utils/display-chrome.ts";
import { useConversationSpinnerFrame } from "../hooks/useConversationMotion.ts";
import {
  buildModelBrowserFocusLayout,
  buildModelBrowserScopeText,
  buildModelBrowserViewLayout,
} from "./model-browser-chrome.ts";
import { buildFieldDisplayState } from "../utils/field-display.ts";

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

function getModelMetadataText(model: DisplayModel): string {
  return [
    model.provider ? `[${model.provider}]` : "",
    ...(model.capabilities?.map((capability) => `[${capability}]`) ?? []),
  ].filter(Boolean).join(" ");
}

function getModelProviderTagText(model: DisplayModel): string {
  return model.provider ? `[${model.provider}]` : "";
}

function getSubstringMatchIndices(
  text: string,
  query: string,
): number[] | undefined {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return undefined;

  const start = text.toLowerCase().indexOf(normalizedQuery);
  if (start < 0) return undefined;

  return Array.from(
    { length: Math.min(normalizedQuery.length, text.length - start) },
    (_, index) => start + index,
  );
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
  highlightQuery,
}: {
  model: DisplayModel;
  isSelected: boolean;
  isActive: boolean;
  isPendingDelete?: boolean;
  contentWidth: number;
  highlightQuery: string;
}): React.ReactElement {
  const { color } = useTheme();

  const statusKind = getModelStatusKind(model, isActive, isPendingDelete);
  const indicator = getStatusIndicator(statusKind);
  const isDownloading = model.downloadStatus === "downloading";
  let indicatorColor = color("muted");
  switch (statusKind) {
    case "pending-delete":
    case "cancelled":
    case "failed":
    case "needs-key":
      indicatorColor = color("error");
      break;
    case "active":
    case "installed":
      indicatorColor = color("success");
      break;
    case "cloud":
      indicatorColor = color("accent");
      break;
    case "downloading":
      indicatorColor = color("warning");
      break;
    case "available":
      indicatorColor = color("muted");
      break;
  }
  const statusTag = `[${getModelStatusLabel(statusKind)}]`;

  // Size/progress display
  let sizeLabel = "";
  if (isDownloading && model.progress) {
    const { progress } = model;
    sizeLabel = progress.total && progress.completed
      ? `${Math.round(progress.percent || 0)}% ${
        formatBytes(progress.completed)
      }/${formatBytes(progress.total)}`
      : progress.status || "...";
  } else if (model.downloadStatus === "cancelled" && model.progress) {
    const { progress } = model;
    sizeLabel = progress.total && progress.completed
      ? `cancelled ${Math.round(progress.percent || 0)}%`
      : "cancelled";
  } else if (model.downloadStatus === "failed") {
    sizeLabel = "failed";
  } else if (model.size) {
    sizeLabel = formatBytes(model.size);
  } else if (model.sizeStr) {
    sizeLabel = model.sizeStr;
  }

  // Color for model name (pending delete > local > downloading > cancelled/failed > remote)
  const nameColor = isPendingDelete
    ? color("error")
    : model.isLocal
    ? color("success")
    : model.downloadStatus === "downloading"
    ? color("warning")
    : model.downloadStatus === "cancelled" || model.downloadStatus === "failed"
    ? color("error")
    : undefined;

  const providerTag = getModelProviderTagText(model);
  const sizeWidth = Math.max(
    10,
    Math.min(18, Math.floor(contentWidth * 0.18)),
  );
  const statusWidth = Math.max(
    12,
    Math.min(16, Math.floor(contentWidth * 0.18)),
  );
  const providerWidth = Math.max(
    10,
    Math.min(24, Math.floor(contentWidth * 0.2)),
  );
  const nameWidth = Math.max(
    18,
    Math.min(60, contentWidth - providerWidth - sizeWidth - statusWidth - 8),
  );
  const displayName = truncate(model.name, nameWidth, "…");
  const displayNamePadded = displayName.padEnd(nameWidth);
  const inlineSizeLabel = truncate(sizeLabel, sizeWidth, "…").padStart(
    sizeWidth,
  );
  const statusDisplay = truncate(statusTag, statusWidth, "…").padEnd(
    statusWidth,
  );
  const providerDisplay = truncate(providerTag, providerWidth, "…").padEnd(
    providerWidth,
  );
  const selectionMarker = isSelected ? "› " : "  ";
  const selectionColor = isSelected ? color("accent") : color("muted");
  const nameMatchIndices = getSubstringMatchIndices(
    displayName,
    highlightQuery,
  );
  const providerMatchIndices = getSubstringMatchIndices(
    providerDisplay,
    highlightQuery,
  );

  return (
    <Box width={contentWidth}>
      <Text wrap="truncate-end">
        <Text color={selectionColor}>{selectionMarker}</Text>
        <Text color={indicatorColor}>
          {indicator}
        </Text>
        <HighlightedText
          text={displayNamePadded}
          matchIndices={nameMatchIndices}
          highlightColor={color("warning")}
          baseColor={nameColor}
          bold={isSelected || isActive}
        />{" "}
        <Text dimColor>{inlineSizeLabel}</Text>{" "}
        <Text dimColor>{statusDisplay}</Text>
        {providerTag
          ? (
            <>
              {" "}
              <HighlightedText
                text={providerDisplay}
                matchIndices={providerMatchIndices}
                highlightColor={color("warning")}
                baseColor={color("accent")}
                bold={false}
              />
            </>
          )
          : null}
      </Text>
    </Box>
  );
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
  const { color, theme } = useTheme();
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
  const panelWidth = clampPanelWidth(terminalWidth, {
    maxWidth: MODEL_BROWSER_MAX_WIDTH,
  });
  const contentWidth = panelWidth - 4;
  const overlayVisibleRowCount = clampVisibleRows(availableHeight, {
    reservedRows: 16,
    minRows: 4,
    maxRows: 16,
  });
  const overlayFrame = useMemo(
    () =>
      resolveOverlayFrame(
        panelWidth,
        overlayVisibleRowCount + 16,
        {
          minWidth: 48,
          minHeight: 18,
          viewport: { columns: terminalWidth, rows: availableHeight },
        },
      ),
    [availableHeight, overlayVisibleRowCount, panelWidth, terminalWidth],
  );
  const overlayContentWidth = Math.max(20, overlayFrame.width - 6);
  const overlayColors = useMemo(() => themeToOverlayColors(theme), [theme]);
  const previousOverlayFrameRef = useRef<typeof overlayFrame | null>(null);
  const defaultModelWidth = Math.max(
    22,
    Math.min(48, Math.floor(contentWidth * 0.34)),
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

  // Calculate visible window
  const visibleWindow = calculateScrollWindow(
    selection.index,
    displayModels.length,
    visibleRowCount,
  );
  const visibleModels = displayModels.slice(
    visibleWindow.start,
    visibleWindow.end,
  );

  // Calculate next filter for footer hint
  const nextFilterIdx = ((FILTER_CYCLE_INDEX.get(activeFilterMode) ?? 0) + 1) %
    FILTER_CYCLE.length;
  const nextFilter = FILTER_LABELS[FILTER_CYCLE[nextFilterIdx]];
  const selectedModel = displayModels[selection.index] ?? displayModels[0] ??
    null;
  const selectedMetadata = selectedModel
    ? getModelMetadataText(selectedModel)
    : "";
  const selectedMetadataDisplay = truncate(
    selectedMetadata,
    Math.max(0, contentWidth - 2),
    "…",
  );
  const scopeText = buildModelBrowserScopeText(
    selectionScopeTitle,
    currentModel,
    defaultModelWidth,
  );
  const hasDiscoveryResults = remoteModels.length > 0 || cloudModels.length > 0;
  const emptyStateMessage = discoveryRefreshFailed && !hasDiscoveryResults
    ? "Model catalog unavailable. Retry in a moment."
    : FILTER_EMPTY[activeFilterMode];
  const modelCountLabel = normalizedSearchQuery
    ? `${displayModels.length}/${viewModels.length}`
    : `${displayModels.length}`;
  const viewLayout = buildModelBrowserViewLayout(
    contentWidth,
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
    : undefined;
  const focusLayout = buildModelBrowserFocusLayout(
    contentWidth,
    selectedModel?.name,
    selectedStatusLabel,
  );
  const selectedStatusColor = selectedStatusKind === "pending-delete" ||
      selectedStatusKind === "cancelled" || selectedStatusKind === "failed" ||
      selectedStatusKind === "needs-key"
    ? color("error")
    : selectedStatusKind === "active" || selectedStatusKind === "installed"
    ? color("success")
    : selectedStatusKind === "downloading"
    ? color("warning")
    : selectedStatusKind === "cloud"
    ? color("accent")
    : color("muted");

  const overlayListRows = Math.max(4, overlayFrame.height - 16);
  const overlayVisibleWindow = calculateScrollWindow(
    selection.index,
    displayModels.length,
    overlayListRows,
  );
  const overlayVisibleModels = displayModels.slice(
    overlayVisibleWindow.start,
    overlayVisibleWindow.end,
  );
  const overlayDefaultModelWidth = Math.max(
    22,
    Math.min(48, Math.floor(overlayContentWidth * 0.34)),
  );
  const overlayScopeText = buildModelBrowserScopeText(
    selectionScopeTitle,
    currentModel,
    overlayDefaultModelWidth,
  );
  const overlayViewLayout = buildModelBrowserViewLayout(
    overlayContentWidth,
    FILTER_LABELS[activeFilterMode],
    modelCountLabel,
    nextFilter,
  );
  const overlayFocusLayout = buildModelBrowserFocusLayout(
    overlayContentWidth,
    selectedModel?.name,
    selectedStatusLabel,
  );
  const overlaySelectedMetadataDisplay = truncate(
    selectedMetadata,
    Math.max(0, overlayContentWidth - 2),
    "…",
  );

  const drawOverlay = useCallback(() => {
    if (presentation !== "overlay") return;
    const previousFrame = previousOverlayFrameRef.current;
    if (previousFrame && shouldClearOverlay(previousFrame, overlayFrame)) {
      clearOverlay(previousFrame);
    }
    previousOverlayFrameRef.current = overlayFrame;

    const surface = createModalOverlayScaffold({
      frame: overlayFrame,
      colors: overlayColors,
      title: "Model catalog",
      rightText: "esc back",
    });
    surface.blankRows(overlayFrame.y, overlayFrame.height);
    const statusRgb = selectedStatusKind === "pending-delete" ||
        selectedStatusKind === "cancelled" || selectedStatusKind === "failed" ||
        selectedStatusKind === "needs-key"
      ? overlayColors.error
      : selectedStatusKind === "active" || selectedStatusKind === "installed"
      ? overlayColors.success
      : selectedStatusKind === "downloading"
      ? overlayColors.warning
      : selectedStatusKind === "cloud"
      ? overlayColors.accent
      : overlayColors.meta;
    const headerY = overlayFrame.y + 1;
    const searchDisplay = buildFieldDisplayState(
      searchQuery,
      searchCursor,
      overlayContentWidth,
      "Filter by model, provider, capability, or description",
    );

    surface.balancedRow(
      headerY,
      overlayViewLayout.leftText,
      overlayViewLayout.rightText,
      overlayContentWidth,
      {
        paddingLeft: 3,
        leftColor: overlayColors.fieldText,
        rightColor: overlayColors.meta,
      },
    );
    surface.textRow(
      headerY + 1,
      truncate(overlayScopeText, overlayContentWidth, "…"),
      { paddingLeft: 3, color: overlayColors.meta },
    );
    surface.sectionRow(headerY + 3, "Search", overlayContentWidth, {
      paddingLeft: 3,
    });
    surface.row(headerY + 4, (ctx) => {
      ctx.pad(3);
      if (searchDisplay.isPlaceholder) {
        ctx.write(searchDisplay.cursorChar, { inverse: true });
        ctx.write(searchDisplay.placeholderText, {
          color: overlayColors.fieldPlaceholder,
        });
      } else {
        ctx.write(searchDisplay.beforeCursor, {
          color: overlayColors.fieldText,
        });
        ctx.write(searchDisplay.cursorChar, { inverse: true });
        ctx.write(searchDisplay.afterCursor, {
          color: overlayColors.fieldText,
        });
        ctx.pad(Math.max(0, overlayContentWidth - searchDisplay.renderWidth));
      }
    });
    surface.sectionRow(headerY + 6, "Focused model", overlayContentWidth, {
      paddingLeft: 3,
    });
    surface.balancedRow(
      headerY + 7,
      overlayFocusLayout.leftText,
      overlayFocusLayout.rightText,
      overlayContentWidth,
      {
        paddingLeft: 3,
        leftColor: selectedModel ? overlayColors.fieldText : overlayColors.meta,
        rightColor: statusRgb,
        leftBold: Boolean(selectedModel),
      },
    );
    if (selectedMetadata) {
      surface.textRow(
        headerY + 8,
        overlaySelectedMetadataDisplay,
        { paddingLeft: 4, color: overlayColors.meta },
      );
    } else {
      surface.blankRow(headerY + 8);
    }
    surface.sectionRow(headerY + 10, "Catalog", overlayContentWidth, {
      paddingLeft: 3,
    });

    const listStartY = headerY + 11;
    if (loading) {
      surface.textRow(
        listStartY,
        `${loadingSpinner} Loading installed models...`,
        { paddingLeft: 3, color: overlayColors.meta },
      );
    } else if (discoveryLoading) {
      surface.textRow(
        listStartY,
        `${loadingSpinner} Loading model catalog...`,
        { paddingLeft: 3, color: overlayColors.meta },
      );
    } else if (discoveryRefreshing && !hasDiscoveryResults) {
      surface.textRow(
        listStartY,
        `${loadingSpinner} Refreshing model catalog...`,
        { paddingLeft: 3, color: overlayColors.meta },
      );
    } else if (displayModels.length === 0) {
      surface.textRow(
        listStartY,
        truncate(emptyStateMessage, overlayContentWidth, "…"),
        { paddingLeft: 3, color: overlayColors.meta },
      );
    } else {
      for (let row = 0; row < overlayListRows; row++) {
        const model = overlayVisibleModels[row];
        const rowY = listStartY + row;
        if (!model) {
          surface.blankRow(rowY);
          continue;
        }
        const actualIndex = overlayVisibleWindow.start + row;
        const isSelected = actualIndex === selection.index;
        const isActive = isSelectedModelActive(model.name, currentModel);
        const modelStatusKind = getModelStatusKind(
          model,
          isActive,
          pendingDelete === model.name,
        );
        const indicatorColor = modelStatusKind === "pending-delete" ||
            modelStatusKind === "cancelled" || modelStatusKind === "failed" ||
            modelStatusKind === "needs-key"
          ? overlayColors.error
          : modelStatusKind === "active" || modelStatusKind === "installed"
          ? overlayColors.success
          : modelStatusKind === "downloading"
          ? overlayColors.warning
          : modelStatusKind === "cloud"
          ? overlayColors.accent
          : overlayColors.meta;
        const statusTag = `[${getModelStatusLabel(modelStatusKind)}]`;
        const sizeLabel =
          model.downloadStatus === "downloading" && model.progress
            ? model.progress.total && model.progress.completed
              ? `${Math.round(model.progress.percent || 0)}% ${
                formatBytes(model.progress.completed)
              }/${formatBytes(model.progress.total)}`
              : model.progress.status || "..."
            : model.downloadStatus === "cancelled" && model.progress
            ? model.progress.total && model.progress.completed
              ? `cancelled ${Math.round(model.progress.percent || 0)}%`
              : "cancelled"
            : model.downloadStatus === "failed"
            ? "failed"
            : model.size
            ? formatBytes(model.size)
            : model.sizeStr ?? "";
        const providerTag = getModelProviderTagText(model);
        const sizeWidth = Math.max(
          10,
          Math.min(18, Math.floor(overlayContentWidth * 0.18)),
        );
        const statusWidth = Math.max(
          12,
          Math.min(16, Math.floor(overlayContentWidth * 0.18)),
        );
        const providerWidth = Math.max(
          10,
          Math.min(24, Math.floor(overlayContentWidth * 0.2)),
        );
        const nameWidth = Math.max(
          18,
          Math.min(
            60,
            overlayContentWidth - providerWidth - sizeWidth - statusWidth - 8,
          ),
        );
        const displayName = truncate(model.name, nameWidth, "…").padEnd(
          nameWidth,
        );
        const inlineSizeLabel = truncate(sizeLabel, sizeWidth, "…").padStart(
          sizeWidth,
        );
        const statusDisplay = truncate(statusTag, statusWidth, "…").padEnd(
          statusWidth,
        );
        const providerDisplay = truncate(
          providerTag,
          providerWidth,
          "…",
        ).padEnd(providerWidth);
        const nameColor = pendingDelete === model.name
          ? overlayColors.error
          : model.isLocal
          ? overlayColors.success
          : model.downloadStatus === "downloading"
          ? overlayColors.warning
          : model.downloadStatus === "cancelled" ||
              model.downloadStatus === "failed"
          ? overlayColors.error
          : overlayColors.fieldText;

        surface.row(rowY, (ctx) => {
          ctx.pad(3);
          ctx.write(isSelected ? "› " : "  ", {
            color: isSelected ? overlayColors.section : overlayColors.meta,
          });
          ctx.write(getStatusIndicator(modelStatusKind), {
            color: indicatorColor,
          });
          ctx.write(`${displayName} `, {
            color: nameColor,
            bold: isSelected || isActive,
          });
          ctx.write(`${inlineSizeLabel} `, { color: overlayColors.meta });
          ctx.write(statusDisplay, { color: indicatorColor });
          if (providerTag) {
            ctx.write(" ", { color: overlayColors.meta });
            ctx.write(providerDisplay, { color: overlayColors.section });
          }
        }, { selected: isSelected });
      }
    }

    const footerHint = pendingDelete
      ? `Press Ctrl+D again to delete "${
        truncate(pendingDelete, Math.max(0, overlayContentWidth - 30), "…")
      }", Esc to cancel`
      : statusMessage
      ? truncate(statusMessage, overlayContentWidth, "…")
      : `↑↓ move · Tab ${nextFilter} · ↵ ${MODEL_BROWSER_SELECT_ACTION_LABEL}`;
    const footerMeta = pendingDelete || statusMessage
      ? "Ctrl+O info · Ctrl+X cancel · Ctrl+B tasks"
      : "Type to filter · Ctrl+O info · Ctrl+D delete · Ctrl+X cancel · Ctrl+B tasks";
    const footerY = overlayFrame.y + overlayFrame.height - 3;
    surface.textRow(footerY, footerHint, {
      paddingLeft: 3,
      color: pendingDelete
        ? overlayColors.error
        : statusMessage
        ? overlayColors.warning
        : overlayColors.meta,
    });
    surface.balancedRow(
      footerY + 1,
      truncate(footerMeta, overlayContentWidth, "…"),
      displayModels.length > 0
        ? `${selection.index + 1}/${displayModels.length}`
        : "",
      overlayContentWidth,
      {
        paddingLeft: 3,
        leftColor: overlayColors.footer,
        rightColor: overlayColors.footer,
      },
    );

    writeToTerminal(surface.finish());
  }, [
    activeFilterMode,
    currentModel,
    discoveryLoading,
    discoveryRefreshing,
    displayModels,
    emptyStateMessage,
    hasDiscoveryResults,
    loading,
    loadingSpinner,
    modelCountLabel,
    nextFilter,
    overlayColors,
    overlayContentWidth,
    overlayFocusLayout,
    overlayFrame,
    overlayListRows,
    overlayScopeText,
    overlaySelectedMetadataDisplay,
    overlayViewLayout,
    overlayVisibleModels,
    overlayVisibleWindow.start,
    pendingDelete,
    presentation,
    searchCursor,
    searchQuery,
    selectedMetadata,
    selectedModel,
    selectedStatusKind,
    selection.index,
    statusMessage,
  ]);

  useLayoutEffect(() => {
    if (presentation !== "overlay") return;
    drawOverlay();
  }, [drawOverlay, presentation]);

  useEffect(() => {
    if (presentation !== "overlay") return;
    return () => {
      if (previousOverlayFrameRef.current) {
        clearOverlay(previousOverlayFrameRef.current);
      }
    };
  }, [presentation]);

  if (presentation === "overlay") {
    return null;
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
      <Box justifyContent="space-between">
        <ChromeChip text="Model catalog" tone="active" />
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

      <Box marginTop={1}>
        <Text color={sc.chrome.sectionLabel}>
          {buildSectionLabelText("Search", contentWidth)}
        </Text>
      </Box>
      <Box marginTop={0}>
        <ListSearchField
          query={searchQuery}
          cursor={searchCursor}
          width={contentWidth}
          placeholder="Filter by model, provider, capability, or description"
        />
      </Box>
      <Box marginTop={1}>
        <Text color={sc.chrome.sectionLabel}>
          {buildSectionLabelText("Focused model", contentWidth)}
        </Text>
      </Box>
      <Box marginTop={0}>
        <Text color={selectedModel ? sc.text.primary : sc.text.muted} bold>
          {focusLayout.leftText}
        </Text>
        {focusLayout.gapWidth > 0 && (
          <Text>{" ".repeat(focusLayout.gapWidth)}</Text>
        )}
        <Text color={selectedStatusColor}>{focusLayout.rightText}</Text>
      </Box>
      {selectedMetadata && (
        <Box paddingLeft={1}>
          <HighlightedText
            text={selectedMetadataDisplay}
            matchIndices={getSubstringMatchIndices(
              selectedMetadataDisplay,
              normalizedSearchQuery,
            )}
            highlightColor={color("warning")}
            baseColor={color("muted")}
            bold={false}
          />
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={sc.chrome.sectionLabel}>
          {buildSectionLabelText("Catalog", contentWidth)}
        </Text>
      </Box>

      {/* Loading */}
      {loading && (
        <Box marginTop={0}>
          <Text dimColor>{loadingSpinner} Loading installed models...</Text>
        </Box>
      )}
      {!loading && discoveryLoading && (
        <Box marginTop={0}>
          <Text dimColor>{loadingSpinner} Loading model catalog...</Text>
        </Box>
      )}
      {!loading && !discoveryLoading && discoveryRefreshing &&
        !hasDiscoveryResults && (
        <Box marginTop={0}>
          <Text dimColor>{loadingSpinner} Refreshing model catalog...</Text>
        </Box>
      )}

      {/* Model list */}
      {!loading && !discoveryLoading && !discoveryRefreshing &&
        displayModels.length === 0 && (
        <Box marginTop={0}>
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
              contentWidth={contentWidth}
              highlightQuery={normalizedSearchQuery}
            />
          </Box>
        );
      })}

      {visibleWindow.start > 0 && (
        <Text dimColor wrap="truncate-end">
          ... {visibleWindow.start} earlier
        </Text>
      )}
      {visibleWindow.end < displayModels.length && (
        <Text dimColor wrap="truncate-end">
          {"  ... "}
          {displayModels.length - visibleWindow.end}
          {" more"}
        </Text>
      )}

      <Box marginTop={1} flexDirection="column">
        <Text color={sc.chrome.sectionLabel}>
          {buildSectionLabelText("Actions", contentWidth)}
        </Text>
        {pendingDelete
          ? (
            <Box
              borderStyle="round"
              borderColor={color("error")}
              paddingX={1}
            >
              <Text color={color("error")} wrap="truncate-end">
                {'Press Ctrl+D again to delete "'}
                {truncate(pendingDelete, Math.max(0, contentWidth - 36), "…")}
                {'", Esc to cancel'}
              </Text>
            </Box>
          )
          : statusMessage
          ? (
            <Text color={color("warning")} wrap="truncate-end">
              {statusMessage}
            </Text>
          )
          : (
            <>
              <Text dimColor wrap="truncate-end">
                ↑↓ move · Tab → {nextFilter} · ↵{" "}
                {MODEL_BROWSER_SELECT_ACTION_LABEL} · Esc back
              </Text>
              <Text dimColor wrap="truncate-end">
                Type to filter · Ctrl+O info · Ctrl+D delete · Ctrl+X cancel ·
                Ctrl+B tasks
              </Text>
            </>
          )}
      </Box>
    </Box>
  );
}
