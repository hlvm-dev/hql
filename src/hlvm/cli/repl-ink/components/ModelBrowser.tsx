/**
 * ModelBrowser Panel
 *
 * Browse installed and available Ollama models.
 * Download new models with progress tracking.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { useTheme } from "../../theme/index.ts";
import { useTaskManager } from "../hooks/useTaskManager.ts";
import { formatBytes, ProgressBar } from "./ProgressBar.tsx";
import type {
  ModelPullTask,
  TaskEvent,
} from "../../repl/task-manager/types.ts";
import {
  isModelPullTask,
  isTaskActive,
} from "../../repl/task-manager/types.ts";
import { getTaskManager } from "../../repl/task-manager/index.ts";
import { ai } from "../../../api/ai.ts";
import { handleTextEditingKey, isCtrlShortcut } from "../utils/text-editing.ts";
import {
  normalizeModelBrowserSearchQuery,
  normalizeModelBrowserSearchState,
  shouldLoadCloudModels,
} from "../utils/model-browser-loading.ts";
import { getPlatform } from "../../../../platform/platform.ts";
import { isOllamaAuthErrorMessage } from "../../../../common/ollama-auth.ts";
import { truncate } from "../../../../common/utils.ts";
import { DEFAULT_OLLAMA_ENDPOINT } from "../../../../common/config/types.ts";
import { isSelectedModelActive } from "../../../../common/config/model-selection.ts";
import { aiEngine } from "../../../runtime/ai-runtime.ts";
import { capabilitiesToDisplayTags } from "../../../providers/types.ts";
import type { ModelInfo } from "../../../providers/types.ts";
import { isOllamaCloudModel } from "../../../providers/ollama/cloud.ts";
import { calculateScrollWindow } from "../completion/navigation.ts";
import { ListSearchField } from "./ListSearchField.tsx";
import {
  DEFAULT_TERMINAL_WIDTH,
  MIN_PANEL_WIDTH,
  MODEL_BROWSER_MAX_WIDTH,
  PANEL_PADDING,
} from "../ui-constants.ts";

// Local alias for platform openUrl
const openUrl = (url: string) => getPlatform().openUrl(url);

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
  /** Current active model */
  currentModel?: string;
  /** Whether the current model has already been explicitly configured */
  isCurrentModelConfigured?: boolean;
  /** Ollama endpoint */
  endpoint?: string;
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
// Model Catalog - via ai.models.catalog (SSOT)
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

/**
 * Get remote models from provider catalog via ai API.
 */
async function fetchRemoteModels(): Promise<RemoteModel[]> {
  try {
    // Always use Ollama catalog for installable local-runtime models.
    const catalog = await ai.models.catalog("ollama");
    const models = catalog
      .filter((m) => isPracticalModel(m.name))
      .map((m) => toRemoteModel(m));

    models.sort((a, b) =>
      parseSizeToBytes(a.size || "") - parseSizeToBytes(b.size || "")
    );
    return models;
  } catch {
    return [];
  }
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

type ModelStatusKind =
  | "pending-delete"
  | "active"
  | "installed"
  | "downloading"
  | "cancelled"
  | "failed"
  | "available";

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
  return "available";
}

function getModelStatusLabel(kind: ModelStatusKind): string {
  switch (kind) {
    case "pending-delete":
      return "pending delete";
    case "active":
      return "default";
    case "installed":
      return "installed";
    case "downloading":
      return "downloading";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    case "available":
      return "not installed";
  }
}

function getStatusIndicator(kind: ModelStatusKind): string {
  switch (kind) {
    case "pending-delete":
      return "? ";
    case "active":
      return "* ";
    case "installed":
      return "✓ ";
    case "downloading":
      return "↓ ";
    case "cancelled":
      return "⊘ ";
    case "failed":
      return "✗ ";
    case "available":
      return "☁ ";
  }
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
  const isDownloading = model.downloadStatus === "downloading";
  let indicatorColor = color("muted");
  switch (statusKind) {
    case "pending-delete":
    case "cancelled":
    case "failed":
      indicatorColor = color("error");
      break;
    case "active":
    case "installed":
      indicatorColor = color("success");
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
  let progressDisplay: React.ReactNode = null;
  if (isDownloading && model.progress) {
    const { progress } = model;
    sizeLabel = progress.total && progress.completed
      ? `${Math.round(progress.percent || 0)}%`
      : progress.status || "...";
    if (progress.total && progress.completed) {
      progressDisplay = (
        <>
          <ProgressBar percent={progress.percent || 0} width={10} showPercent />
          <Text dimColor>
            {formatBytes(progress.completed)}/{formatBytes(progress.total)}
          </Text>
        </>
      );
    } else {
      progressDisplay = <Text dimColor>{progress.status || "..."}</Text>;
    }
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

  const metadata = [
    model.provider ? `[${model.provider}]` : "",
    ...(model.capabilities?.map((capability) => `[${capability}]`) ?? []),
  ].filter(Boolean).join("");
  const nameWidth = Math.max(18, Math.min(42, Math.floor(contentWidth * 0.34)));
  const sizeWidth = 12;
  const detailsWidth = Math.max(
    0,
    contentWidth - nameWidth - sizeWidth - statusTag.length - 8,
  );
  const displayName = truncate(model.name, nameWidth, "…").padEnd(nameWidth);
  const detailsText = truncate(metadata, detailsWidth, "…");
  const inlineSizeLabel = truncate(sizeLabel, sizeWidth, "…").padStart(
    sizeWidth,
  );

  return (
    <Box width={contentWidth}>
      <Text inverse={isSelected} wrap="truncate-end">
        <Text color={indicatorColor}>
          {indicator}
        </Text>
        <Text color={nameColor}>{displayName}</Text> {isDownloading
          ? progressDisplay
          : <Text dimColor>{inlineSizeLabel}</Text>}{" "}
        <Text dimColor>{statusTag}</Text>
        {detailsText
          ? (
            <>
              {" "}
              <Text color={color("accent")}>{detailsText}</Text>
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
  currentModel,
  isCurrentModelConfigured = false,
  endpoint = DEFAULT_OLLAMA_ENDPOINT,
}: ModelBrowserProps): React.ReactElement {
  const { color } = useTheme();
  const { stdout } = useStdout();
  const { tasks, cancel } = useTaskManager();
  const manager = useMemo(() => getTaskManager(endpoint), [endpoint]);
  const availableWidth = Math.max(
    MIN_PANEL_WIDTH,
    (stdout?.columns ?? DEFAULT_TERMINAL_WIDTH) - PANEL_PADDING,
  );
  const panelWidth = Math.min(MODEL_BROWSER_MAX_WIDTH, availableWidth);
  const contentWidth = panelWidth - 4;

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
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudLoaded, setCloudLoaded] = useState(false);
  const [cloudLoadFailed, setCloudLoadFailed] = useState(false);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
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
      setStatusMessage(`Setting default model: ${modelName}...`);
      try {
        await onSelectModel(modelName);
        if (!isMountedRef.current) return;
        setStatusMessage(`Default model set: ${modelName}`);
        onModelSet?.(modelName);
        // Brief confirmation dwell so user can see success before panel closes.
        await new Promise((resolve) => setTimeout(resolve, 1200));
        if (!isMountedRef.current) return;
        onClose();
      } catch (error) {
        if (!isMountedRef.current) return;
        const message = error instanceof Error ? error.message : String(error);
        setStatusMessage(
          `Failed to set default model: ${message} (press Ctrl+O for model info)`,
        );
      } finally {
        if (isMountedRef.current) {
          setIsSelecting(false);
        }
      }
    },
    [onClose, onModelSet, onSelectModel],
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

  // Fetch installed Ollama models only. Cloud models are loaded on demand.
  const fetchModels = useCallback(async () => {
    try {
      const models = await ai.models.list("ollama");
      setLocalModels(models.map(toLocalModel));
    } catch {
      setLocalModels([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch local models on mount
  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  // Fetch remote models from Ollama registry on mount
  useEffect(() => {
    let cancelled = false;
    fetchRemoteModels().then((models) => {
      if (!cancelled) {
        setRemoteModels(models);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const shouldLoadCloudModelsNow = useMemo(
    () =>
      shouldLoadCloudModels({
        filterMode,
        searchQuery: normalizedSearchQuery,
        currentModel,
      }),
    [currentModel, filterMode, normalizedSearchQuery],
  );

  useEffect(() => {
    if (!shouldLoadCloudModelsNow) {
      setCloudLoadFailed(false);
      return;
    }
  }, [shouldLoadCloudModelsNow]);

  useEffect(() => {
    setCloudLoadFailed(false);
  }, [filterMode]);

  useEffect(() => {
    if (
      cloudLoaded ||
      cloudLoading ||
      cloudLoadFailed ||
      !shouldLoadCloudModelsNow
    ) {
      return;
    }

    let cancelled = false;
    setCloudLoading(true);

    void ai.models.listAll({ excludeProviders: ["ollama"] })
      .then((models) => {
        if (cancelled) return;
        setCloudModels(
          models
            .map(toCloudModel)
            .filter((model): model is CloudModel => model !== null),
        );
        setCloudLoadFailed(false);
        setCloudLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setCloudModels([]);
          setCloudLoadFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCloudLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cloudLoaded, cloudLoading, cloudLoadFailed, shouldLoadCloudModelsNow]);

  // Reactive Ollama Cloud signin: on auth error during cloud model pull,
  // spawn `ollama signin` then retry pull
  const triggerOllamaSignin = useCallback(async (thenPullModel?: string) => {
    setStatusMessage("Signing in to Ollama Cloud...");
    try {
      const enginePath = await aiEngine.getEnginePath();
      // Use run() with inherit so the user sees the interactive signin flow in their terminal
      const process = getPlatform().command.run({
        cmd: [enginePath, "signin"],
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      const result = await process.status;
      if (result.success) {
        setStatusMessage("Signed in! Pulling model...");
        if (thenPullModel) {
          try {
            manager.pullModel(thenPullModel);
          } catch { /* already downloading */ }
        }
      } else {
        setStatusMessage(
          "Sign-in cancelled or failed. Try 'ollama signin' manually.",
        );
      }
    } catch {
      setStatusMessage("Could not run AI engine sign-in. Is Ollama available?");
    }
  }, [manager]);

  // Auto-refresh when downloads complete + detect auth failures for cloud models
  useEffect(() => {
    const unsubscribe = manager.onEvent((event: TaskEvent) => {
      // Refresh model list when a model pull completes successfully
      if (event.type === "task:completed") {
        const task = manager.getTask(event.taskId);
        if (task && isModelPullTask(task)) {
          fetchModels();
          // Auto-select if this was a pending cloud model pull
          if (pendingSelectRef.current === task.modelName && onSelectModel) {
            pendingSelectRef.current = null;
            void selectAsDefaultModel(task.modelName);
          }
        }
      }
      // Detect auth failure on cloud model pull → trigger `ollama signin`
      if (event.type === "task:failed") {
        const task = manager.getTask(event.taskId);
        if (
          task && isModelPullTask(task) && isOllamaCloudModel(task.modelName)
        ) {
          const errorMsg = task.error?.message ?? "";
          if (isOllamaAuthErrorMessage(errorMsg)) {
            triggerOllamaSignin(task.modelName);
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
    triggerOllamaSignin,
  ]);

  // Build display list - POSITION STABLE (models never move regardless of status)
  // Order is determined by remoteModels (sorted by size), local status is just a flag
  const displayModels = useMemo((): DisplayModel[] => {
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
    let filtered = filterByMode(result, filterMode);

    // Filter by search within current view (name, provider, capabilities, description)
    const q = normalizedSearchQuery.toLowerCase();
    if (q) {
      filtered = filtered.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          (m.provider?.toLowerCase().includes(q) ?? false) ||
          (m.capabilities?.some((c) => c.toLowerCase().includes(q)) ?? false) ||
          (m.description?.toLowerCase().includes(q) ?? false),
      );
    }

    return filtered;
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

    // API provider cloud models — have "provider/" prefix and are not Ollama. Select directly.
    const isApiProviderCloud = (m: DisplayModel) =>
      m.capabilities?.includes("cloud") && !m.isLocal &&
      m.name.includes("/") && !m.name.startsWith("ollama/");

    // Ollama cloud models — no provider prefix or "ollama/" prefix. Need pull + possibly signin.
    const isOllamaCloudModel_ = (m: DisplayModel) =>
      m.capabilities?.includes("cloud") && !m.isLocal &&
      (!m.name.includes("/") || m.name.startsWith("ollama/"));

    const performSelectionAction = () => {
      const model = displayModels[selection.index] ?? displayModels[0];
      if (!model) return;

      if (onSelectModel && isSelectedModelActive(model.name, currentModel)) {
        if (!isCurrentModelConfigured) {
          void selectAsDefaultModel(model.name);
          return;
        }
        setStatusMessage(`Already default model: ${model.name}`);
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
      if (isApiProviderCloud(model) && onSelectModel) {
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
        !isApiProviderCloud(model)
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
        const idx = FILTER_CYCLE.indexOf(current);
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
        const idx = FILTER_CYCLE.indexOf(current);
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
      } else if (isOllamaCloudModel_(model)) {
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
      if (isApiProviderCloud(model) || isOllamaCloudModel_(model)) {
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
          await ai.models.remove(model.name);
          fetchModels(); // Refresh list
        } catch {
          // Delete failed - could add error state later
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
    8,
  );
  const visibleModels = displayModels.slice(
    visibleWindow.start,
    visibleWindow.end,
  );

  // Calculate next filter for footer hint
  const nextFilterIdx = (FILTER_CYCLE.indexOf(activeFilterMode) + 1) %
    FILTER_CYCLE.length;
  const nextFilter = FILTER_LABELS[FILTER_CYCLE[nextFilterIdx]];
  const selectedModel = displayModels[selection.index] ?? displayModels[0] ??
    null;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      paddingX={1}
      width={panelWidth}
    >
      <Box justifyContent="space-between">
        <Text bold color={color("primary")} wrap="truncate-end">
          Models: {FILTER_LABELS[activeFilterMode]} ({displayModels.length})
        </Text>
        <Text dimColor wrap="truncate-end">
          {currentModel
            ? `Default: ${truncate(currentModel, 20, "…")}`
            : "Default: none"}
        </Text>
      </Box>
      <Box justifyContent="space-between">
        <Box flexGrow={1}>
          <Text wrap="truncate-end">
            <Text dimColor>View:</Text>
            <Text color={color("accent")} bold>
              {FILTER_LABELS[activeFilterMode]}
            </Text>
            <Text dimColor>· Tab cycles views</Text>
          </Text>
        </Box>
        <Text dimColor>Ctrl+B: Tasks</Text>
      </Box>

      <ListSearchField
        query={searchQuery}
        cursor={searchCursor}
        width={contentWidth}
        placeholder="Filter by model, provider, capability, or description"
      />
      <Box>
        <Text dimColor>Selected:</Text>
        {selectedModel
          ? (
            (() => {
              const isActive = isSelectedModelActive(
                selectedModel.name,
                currentModel,
              );
              const isPending = pendingDelete === selectedModel.name;
              const status = getModelStatusLabel(
                getModelStatusKind(selectedModel, isActive, isPending),
              );
              return (
                <>
                  <Text wrap="truncate-end">
                    {truncate(
                      selectedModel.name,
                      Math.max(0, contentWidth - status.length - 14),
                      "…",
                    )}
                  </Text>
                  <Text dimColor>[{status}]</Text>
                </>
              );
            })()
          )
          : <Text dimColor>None</Text>}
      </Box>

      {/* Loading */}
      {loading && <Text dimColor>Loading installed models...</Text>}
      {!loading &&
        cloudLoading &&
        (activeFilterMode === "cloud" || normalizedSearchQuery.length > 0) && (
        <Text dimColor>Loading cloud models...</Text>
      )}

      {/* Model list */}
      {!loading && displayModels.length === 0 && (
        <Text dimColor wrap="truncate-end">
          {FILTER_EMPTY[activeFilterMode]}
        </Text>
      )}

      {!loading &&
        visibleModels.map((model: DisplayModel, i: number) => {
          const actualIndex = visibleWindow.start + i;
          return (
            <Box key={model.name}>
              <ModelItem
                model={model}
                isSelected={actualIndex === selection.index}
                isActive={isSelectedModelActive(model.name, currentModel)}
                isPendingDelete={pendingDelete === model.name}
                contentWidth={contentWidth}
              />
            </Box>
          );
        })}

      {!loading && visibleWindow.start > 0 && (
        <Text dimColor wrap="truncate-end">
          ... {visibleWindow.start} earlier
        </Text>
      )}
      {!loading && visibleWindow.end < displayModels.length && (
        <Text dimColor wrap="truncate-end">
          {"  ... "}
          {displayModels.length - visibleWindow.end}
          {" more"}
        </Text>
      )}

      <Text></Text>
      {pendingDelete
        ? (
          <Text color={color("error")} wrap="truncate-end">
            {'  Press Ctrl+D again to delete "'}
            {truncate(pendingDelete, Math.max(0, contentWidth - 34), "…")}
            {'", Esc to cancel'}
          </Text>
        )
        : statusMessage
        ? (
          <Text color={color("warning")} wrap="truncate-end">
            {statusMessage}
          </Text>
        )
        : (
          <Text dimColor wrap="truncate-end">
            ↑↓ nav Tab → {nextFilter}{" "}
            type filter ↵ select Ctrl+D del Ctrl+O info Ctrl+X cancel Esc
            clear/back
          </Text>
        )}
    </Box>
  );
}
