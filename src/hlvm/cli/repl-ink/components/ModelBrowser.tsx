/**
 * ModelBrowser Panel
 *
 * Browse installed and available Ollama models.
 * Download new models with progress tracking.
 */

import React, { useState, useEffect, useMemo, useCallback } from "npm:react@18";
import { Box, Text, useInput } from "npm:ink@5";
import { useTheme } from "../../theme/index.ts";
import { useTaskManager } from "../hooks/useTaskManager.ts";
import { ProgressBar, formatBytes } from "./ProgressBar.tsx";
import type { ModelPullTask } from "../../repl/task-manager/types.ts";
import { isModelPullTask, isTaskActive } from "../../repl/task-manager/types.ts";
import { getTaskManager } from "../../repl/task-manager/index.ts";
import { handleTextEditingKey } from "../utils/text-editing.ts";
import { openUrl } from "../../../../platform/platform.ts";
import type { ModelInfo } from "../../../providers/types.ts";

// ============================================================
// Types
// ============================================================

interface ModelBrowserProps {
  /** Callback when panel closes */
  onClose: () => void;
  /** Callback when model is selected (set as active) */
  onSelectModel?: (modelName: string) => void;
  /** Current active model */
  currentModel?: string;
  /** Ollama endpoint */
  endpoint?: string;
}

interface LocalModel {
  name: string;
  size: number;
  modified: string;
}

interface RemoteModel {
  name: string;
  description: string;
  capabilities: string[];
  size?: string; // Size string from registry (e.g., "4.9GB")
  provider?: string; // Company/provider name (e.g., "Meta", "Google")
}

/** Download status for a model */
type DownloadStatus = "idle" | "downloading" | "cancelled" | "failed";

type DisplayModel = {
  name: string;
  isLocal: boolean;
  isDownloading: boolean; // Kept for backwards compat (true when status === "downloading")
  downloadStatus: DownloadStatus;
  size?: number; // Size in bytes (local models)
  sizeStr?: string; // Size string (remote models, e.g., "4.9GB")
  description?: string;
  capabilities?: string[];
  provider?: string; // Company/provider name
  progress?: { percent?: number; completed?: number; total?: number; status: string };
};

// ============================================================
// View Filter Types
// ============================================================

/** Filter modes for model browser view */
type ViewFilter = "all" | "local" | "downloading" | "available";

/** Filter cycle order - discovery first */
const FILTER_CYCLE: readonly ViewFilter[] = ["all", "available", "local", "downloading"];

/** Filter display labels */
const FILTER_LABELS: Record<ViewFilter, string> = {
  all: "All",
  local: "Local",
  downloading: "Downloading",
  available: "Available",
};

/** Empty state messages for each filter */
const FILTER_EMPTY: Record<ViewFilter, string> = {
  all: "No models found",
  local: "No local models installed",
  downloading: "No active downloads",
  available: "All models installed",
};

// ============================================================
// Model Catalog - via ai.models.catalog (SSOT)
// ============================================================

/** Get provider/company name from model ID */
function getProvider(modelId: string): string {
  const id = modelId.toLowerCase();
  // Meta
  if (id.startsWith("llama") || id.startsWith("codellama")) return "Meta";
  // Google
  if (id.startsWith("gemma") || id.startsWith("codegemma")) return "Google";
  // Microsoft
  if (id.startsWith("phi") || id.startsWith("wizardlm")) return "Microsoft";
  // Mistral AI
  if (id.startsWith("mistral") || id.startsWith("mixtral") || id.startsWith("codestral")) return "Mistral";
  // Alibaba
  if (id.startsWith("qwen") || id.startsWith("qwq")) return "Alibaba";
  // DeepSeek
  if (id.startsWith("deepseek")) return "DeepSeek";
  // Cohere
  if (id.startsWith("command") || id.startsWith("aya")) return "Cohere";
  // IBM
  if (id.startsWith("granite")) return "IBM";
  // 01.AI
  if (id.startsWith("yi")) return "01.AI";
  // Stability AI
  if (id.startsWith("stablelm") || id.startsWith("stable")) return "Stability";
  // Intel
  if (id.startsWith("neural-chat")) return "Intel";
  // Snowflake
  if (id.startsWith("snowflake")) return "Snowflake";
  // BAAI
  if (id.startsWith("bge")) return "BAAI";
  // Nomic AI
  if (id.startsWith("nomic")) return "Nomic";
  // MixedBread AI
  if (id.startsWith("mxbai")) return "MixedBread";
  // Hugging Face
  if (id.startsWith("smollm") || id.startsWith("starcoder")) return "HuggingFace";
  // TII
  if (id.startsWith("falcon")) return "TII";
  // Upstage
  if (id.startsWith("solar")) return "Upstage";
  // LMSYS
  if (id.startsWith("vicuna")) return "LMSYS";
  // OpenChat
  if (id.startsWith("openchat")) return "OpenChat";
  // Nous Research
  if (id.startsWith("nous") || id.startsWith("hermes")) return "Nous";
  // LLaVA (Berkeley)
  if (id.startsWith("llava") || id.startsWith("bakllava")) return "Berkeley";
  // Dolphin
  if (id.startsWith("dolphin")) return "Cognitive";
  // TinyLlama
  if (id.startsWith("tinyllama")) return "TinyLlama";
  // Moondream
  if (id.startsWith("moondream")) return "Vikhyat";
  // All-MiniLM
  if (id.startsWith("all-minilm")) return "Microsoft";
  // Default
  return "";
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
    case "GB": return value * 1024 * 1024 * 1024;
    case "MB": return value * 1024 * 1024;
    case "KB": return value * 1024;
    default: return value;
  }
}

function isPracticalModel(name: string): boolean {
  const lower = name.toLowerCase();
  return !lower.includes("405b") && !lower.includes("671b") && !lower.includes("70b");
}

function getCatalogCapabilities(model: ModelInfo): string[] {
  const meta = (model.metadata || {}) as Record<string, unknown>;
  const metaCaps = Array.isArray(meta.capabilities)
    ? meta.capabilities.map((c) => String(c))
    : [];
  if (metaCaps.length > 0) return metaCaps;

  const caps: string[] = [];
  if (model.capabilities?.includes("embeddings")) {
    caps.push("embedding");
  } else {
    caps.push("text");
  }
  if (model.capabilities?.includes("vision")) {
    caps.push("vision");
  }
  return caps;
}

function getCatalogSize(model: ModelInfo): string | undefined {
  const meta = (model.metadata || {}) as Record<string, unknown>;
  const sizes = Array.isArray(meta.sizes) ? meta.sizes : [];
  const first = sizes[0];
  return typeof first === "string" ? first : undefined;
}

function toRemoteModel(model: ModelInfo): RemoteModel {
  const meta = (model.metadata || {}) as Record<string, unknown>;
  const modelId = typeof meta.modelId === "string" ? meta.modelId : model.name;
  const baseDescription = model.displayName ?? model.name;
  const extraDescription = typeof meta.description === "string" ? meta.description : "";
  const description = extraDescription ? `${baseDescription} - ${extraDescription}` : baseDescription;

  return {
    name: model.name,
    description,
    capabilities: getCatalogCapabilities(model),
    size: getCatalogSize(model),
    provider: getProvider(modelId),
  };
}

/**
 * Get remote models from provider catalog via ai API.
 */
async function fetchRemoteModels(): Promise<RemoteModel[]> {
  try {
    const aiApi = (globalThis as Record<string, unknown>).ai as {
      models?: { catalog?: () => Promise<ModelInfo[]> };
    } | undefined;

    if (!aiApi?.models?.catalog) return [];

    const catalog = await aiApi.models.catalog();
    const models = catalog
      .filter((m) => isPracticalModel(m.name))
      .map((m) => toRemoteModel(m));

    models.sort((a, b) => parseSizeToBytes(a.size || "") - parseSizeToBytes(b.size || ""));
    return models;
  } catch {
    return [];
  }
}

/** Filter models based on ViewFilter */
function filterByView(models: DisplayModel[], filter: ViewFilter): DisplayModel[] {
  switch (filter) {
    case "all": return models;
    case "local": return models.filter((m) => m.isLocal);
    // Downloading: show active + cancelled/failed (to see partial progress)
    case "downloading": return models.filter((m) =>
      m.downloadStatus === "downloading" ||
      m.downloadStatus === "cancelled" ||
      m.downloadStatus === "failed"
    );
    // Available: includes downloading models (they stay visible until local)
    case "available": return models.filter((m) => !m.isLocal);
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
}: {
  model: DisplayModel;
  isSelected: boolean;
  isActive: boolean;
  isPendingDelete?: boolean;
}): React.ReactElement {
  const { color } = useTheme();

  // Format provider tag
  const providerTag = model.provider ? `[${model.provider}]` : "";

  // Format capabilities
  const caps = model.capabilities?.map((c) => `[${c}]`).join("") || "";

  // Indicator based on downloadStatus (pending delete takes priority)
  let indicator = "  ";
  let indicatorColor = color("muted");
  if (isPendingDelete) {
    indicator = "? "; // pending delete confirmation
    indicatorColor = color("error");
  } else if (isActive) {
    indicator = "* ";
    indicatorColor = color("success");
  } else if (model.isLocal) {
    indicator = "✓ ";
    indicatorColor = color("success");
  } else if (model.downloadStatus === "downloading") {
    indicator = "↓ ";
    indicatorColor = color("warning");
  } else if (model.downloadStatus === "cancelled") {
    indicator = "⊘ "; // cancelled indicator
    indicatorColor = color("error");
  } else if (model.downloadStatus === "failed") {
    indicator = "✗ ";
    indicatorColor = color("error");
  } else {
    indicator = "☁ ";
    indicatorColor = color("muted");
  }

  // Name (truncate if needed)
  const displayName = model.name.length > 24 ? model.name.slice(0, 21) + "..." : model.name.padEnd(24);

  // Size or status
  let sizeText: React.ReactNode;
  if (model.downloadStatus === "downloading" && model.progress) {
    const { progress } = model;
    if (progress.total && progress.completed) {
      sizeText = (
        <>
          <ProgressBar percent={progress.percent || 0} width={10} showPercent={true} />
          <Text dimColor> {formatBytes(progress.completed)}/{formatBytes(progress.total)}</Text>
        </>
      );
    } else {
      sizeText = <Text dimColor>{progress.status || "..."}</Text>;
    }
  } else if (model.downloadStatus === "cancelled" && model.progress) {
    // Show partial progress for cancelled downloads
    const { progress } = model;
    if (progress.total && progress.completed) {
      sizeText = (
        <>
          <Text color={color("error")}>[cancelled</Text>
          <Text dimColor> {Math.round((progress.percent || 0))}%</Text>
          <Text color={color("error")}>]</Text>
        </>
      );
    } else {
      sizeText = <Text color={color("error")}>[cancelled]</Text>;
    }
  } else if (model.downloadStatus === "failed") {
    sizeText = <Text color={color("error")}>[failed]</Text>;
  } else if (model.size) {
    // Local model - size in bytes
    sizeText = <Text dimColor>{formatBytes(model.size)}</Text>;
  } else if (model.sizeStr) {
    // Remote model - size string from registry (e.g., "4.9GB")
    sizeText = <Text dimColor>{model.sizeStr.padStart(10)}</Text>;
  } else {
    sizeText = <Text dimColor>          </Text>;
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

  return (
    <Box>
      <Text inverse={isSelected}>
        <Text color={indicatorColor}>
          {indicator}
        </Text>
        <Text color={nameColor}>{displayName}</Text>
        <Text> </Text>
        {sizeText}
        <Text> </Text>
        <Text color={color("accent")}>{providerTag}</Text>
        <Text dimColor>{caps}</Text>
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
  currentModel,
  endpoint = "http://127.0.0.1:11434",
}: ModelBrowserProps): React.ReactElement {
  const { color } = useTheme();
  const { tasks, cancel } = useTaskManager();
  const manager = useMemo(() => getTaskManager(endpoint), [endpoint]);

  // State
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [remoteModels, setRemoteModels] = useState<RemoteModel[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCursor, setSearchCursor] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  // Fetch local models - 100% SSOT via ai.models API (no fallback)
  const fetchModels = useCallback(async () => {
    try {
      // 100% SSOT: Use ai.models API only - no direct fetch fallback
      const aiApi = (globalThis as Record<string, unknown>).ai as {
        models: { list: () => Promise<{ name: string; size?: number; modifiedAt?: Date }[]> };
      } | undefined;

      if (aiApi?.models?.list) {
        const modelList = await aiApi.models.list();
        const models = modelList.map((m) => ({
          name: m.name,
          size: m.size || 0,
          modified: m.modifiedAt?.toISOString() || "",
        }));
        setLocalModels(models);
      } else {
        // API not ready - show empty (no direct fetch bypass)
        setLocalModels([]);
      }
    } catch {
      // Offline - show empty
      setLocalModels([]);
    }
    setLoading(false);
  }, []);

  // Fetch local models on mount
  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  // Fetch remote models from Ollama registry on mount
  useEffect(() => {
    fetchRemoteModels().then(setRemoteModels);
  }, []);

  // Auto-refresh when downloads complete
  useEffect(() => {
    const manager = getTaskManager();
    const unsubscribe = manager.onEvent((event) => {
      // Refresh model list when a model pull completes successfully
      if (event.type === "task:completed") {
        const task = manager.getTask(event.taskId);
        if (task && isModelPullTask(task)) {
          // Re-fetch local models
          fetchModels();
        }
      }
    });
    return unsubscribe;
  }, [fetchModels]);

  // Build display list - POSITION STABLE (models never move regardless of status)
  // Order is determined by remoteModels (sorted by size), local status is just a flag
  const displayModels = useMemo((): DisplayModel[] => {
    const result: DisplayModel[] = [];

    // Build lookup maps
    const localMap = new Map<string, LocalModel>(localModels.map((m: LocalModel) => [m.name, m]));

    // Get all model-pull tasks (active or cancelled - to show partial progress)
    const pullTasks = tasks.filter(
      (t): t is ModelPullTask => isModelPullTask(t)
    );

    // Helper to determine download status from task
    const getDownloadStatus = (task: ModelPullTask | undefined): DownloadStatus => {
      if (!task) return "idle";
      if (task.status === "running" || task.status === "pending") return "downloading";
      if (task.status === "cancelled") return "cancelled";
      if (task.status === "failed") return "failed";
      return "idle"; // completed tasks become idle (model is local)
    };

    // Helper to find most relevant task (prefer active over cancelled/failed)
    // If model is local, don't show stale cancelled/failed tasks
    const findRelevantTask = (modelName: string, isLocal: boolean): ModelPullTask | undefined => {
      const tasksForModel = pullTasks.filter((t) => t.modelName === modelName);
      // Always prefer active tasks (running/pending)
      const activeTask = tasksForModel.find((t) => t.status === "running" || t.status === "pending");
      if (activeTask) return activeTask;
      // For local models, don't show stale cancelled/failed status
      // (the model was successfully downloaded after the failed attempt)
      if (isLocal) return undefined;
      // For non-local models, show cancelled/failed for resume UX
      return tasksForModel.find((t) => t.status === "cancelled" || t.status === "failed");
    };

    // Build from remoteModels (stable order - sorted by size)
    // Mark as local if exists in localMap
    for (const model of remoteModels) {
      const local = localMap.get(model.name);
      const isLocal = !!local;
      const task = findRelevantTask(model.name, isLocal);
      const downloadStatus = getDownloadStatus(task);
      result.push({
        name: model.name,
        isLocal: !!local,
        isDownloading: downloadStatus === "downloading",
        downloadStatus,
        size: local?.size,
        sizeStr: model.size,
        description: model.description,
        capabilities: model.capabilities,
        provider: model.provider || getProvider(model.name),
        progress: task?.progress,
      });
    }

    // Add local-only models (not in registry) at the end
    for (const model of localModels) {
      if (!remoteModels.some((r: RemoteModel) => r.name === model.name)) {
        const task = findRelevantTask(model.name, true);  // Always local
        const downloadStatus = getDownloadStatus(task);
        result.push({
          name: model.name,
          isLocal: true,
          isDownloading: downloadStatus === "downloading",
          downloadStatus,
          size: model.size,
          provider: getProvider(model.name),
          progress: task?.progress,
        });
      }
    }

    // Apply view filter
    let filtered = filterByView(result, viewFilter);

    // Filter by search within current view (name, provider, capabilities, description)
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          (m.provider?.toLowerCase().includes(q) ?? false) ||
          (m.capabilities?.some((c) => c.toLowerCase().includes(q)) ?? false) ||
          (m.description?.toLowerCase().includes(q) ?? false)
      );
    }

    return filtered;
  }, [localModels, remoteModels, tasks, searchQuery, viewFilter]);

  // Clamp selection
  useEffect(() => {
    if (selectedIndex >= displayModels.length) {
      setSelectedIndex(Math.max(0, displayModels.length - 1));
    }
  }, [displayModels.length, selectedIndex]);

  // Keyboard handling
  useInput((input, key) => {
    // Search mode
    if (isSearching) {
      if (key.escape) {
        setIsSearching(false);
        setSearchQuery("");
        setSearchCursor(0);
        return;
      }
      if (key.return) {
        setIsSearching(false);
        return;
      }

      // Text editing shortcuts (Ctrl+A/E/W/U/K, word nav, arrows, backspace, typing)
      const result = handleTextEditingKey(input, key, searchQuery, searchCursor);
      if (result) {
        setSearchQuery(result.value);
        setSearchCursor(result.cursor);
      }
      return;
    }

    // Navigation (clears pending delete)
    if (key.upArrow || input === "k") {
      setSelectedIndex((i: number) => Math.max(0, i - 1));
      setPendingDelete(null);
    }
    if (key.downArrow || input === "j") {
      setSelectedIndex((i: number) => Math.min(displayModels.length - 1, i + 1));
      setPendingDelete(null);
    }

    // Tab cycles filter forward (clears pending delete)
    // Use functional update to avoid stale closure issues
    if (key.tab && !key.shift) {
      setViewFilter((current) => {
        const idx = FILTER_CYCLE.indexOf(current);
        return FILTER_CYCLE[(idx + 1) % FILTER_CYCLE.length];
      });
      setSelectedIndex(0);
      setPendingDelete(null);
      return;
    }

    // Shift+Tab cycles filter backward (clears pending delete)
    // Use functional update to avoid stale closure issues
    if (key.tab && key.shift) {
      setViewFilter((current) => {
        const idx = FILTER_CYCLE.indexOf(current);
        return FILTER_CYCLE[(idx - 1 + FILTER_CYCLE.length) % FILTER_CYCLE.length];
      });
      setSelectedIndex(0);
      setPendingDelete(null);
      return;
    }

    // 'i' opens model info page in browser
    if (input === "i" && displayModels[selectedIndex]) {
      const url = getOllamaUrl(displayModels[selectedIndex].name);
      openUrl(url);
      return;
    }

    // 'd' - Delete local model (with confirmation)
    if (input === "d" && displayModels[selectedIndex]) {
      const model = displayModels[selectedIndex];

      // Only allow delete for local models (not downloading or remote)
      if (!model.isLocal || model.isDownloading) return;

      // First press: set pending confirmation
      if (pendingDelete !== model.name) {
        setPendingDelete(model.name);
        return;
      }

      // Second press (confirmation): execute delete
      (async () => {
        try {
          const aiApi = (globalThis as Record<string, unknown>).ai as {
            models?: { remove?: (name: string) => Promise<boolean> };
          };
          if (aiApi?.models?.remove) {
            await aiApi.models.remove(model.name);
            fetchModels(); // Refresh list
          }
        } catch {
          // Delete failed - could add error state later
        } finally {
          setPendingDelete(null);
        }
      })();
      return;
    }

    // Search (clears pending delete)
    if (input === "/") {
      setIsSearching(true);
      setSearchCursor(searchQuery.length); // Start at end of existing query
      setPendingDelete(null);
    }

    // Select/Download/Resume
    if (key.return && displayModels[selectedIndex]) {
      const model = displayModels[selectedIndex];
      if (model.isLocal && onSelectModel) {
        // Local model: select as active
        onSelectModel(model.name);
        onClose();
      } else if (!model.isLocal && !model.isDownloading) {
        // Remote model (or cancelled/failed): start/restart download
        try {
          manager.pullModel(model.name);
        } catch {
          // Already downloading - ignore
        }
      }
    }

    // Space to select as active
    if (input === " " && displayModels[selectedIndex]) {
      const model = displayModels[selectedIndex];
      if (model.isLocal && onSelectModel) {
        onSelectModel(model.name);
        onClose();
      }
    }

    // Cancel download ('x' key)
    if (input === "x" && displayModels[selectedIndex]) {
      const model = displayModels[selectedIndex];
      if (model.isDownloading) {
        // Filter to model-pull tasks first, then find matching name
        const pullTasks = tasks.filter(isModelPullTask);
        const task = pullTasks.find(
          (t) => t.modelName === model.name && isTaskActive(t)
        );
        if (task) {
          cancel(task.id);
          return;
        }
      }
    }

    // Escape: Stack-based behavior (cancel pending → cancel download → close)
    if (key.escape) {
      // 1. Cancel pending delete first
      if (pendingDelete) {
        setPendingDelete(null);
        return;
      }

      // 2. Cancel download if selected model is downloading
      const selectedModel = displayModels[selectedIndex];
      if (selectedModel?.isDownloading) {
        const pullTasks = tasks.filter(isModelPullTask);
        const task = pullTasks.find(
          (t) => t.modelName === selectedModel.name && isTaskActive(t)
        );
        if (task) {
          cancel(task.id);
          return;
        }
      }

      // 3. Close panel
      onClose();
    }
  });

  // Calculate visible window (show max 8 items)
  const maxVisible = 8;
  const startIdx = Math.max(0, Math.min(selectedIndex - 3, displayModels.length - maxVisible));
  const visibleModels = displayModels.slice(startIdx, startIdx + maxVisible);
  const hasMore = displayModels.length > startIdx + maxVisible;

  // Calculate next filter for footer hint
  const nextFilterIdx = (FILTER_CYCLE.indexOf(viewFilter) + 1) % FILTER_CYCLE.length;
  const nextFilter = FILTER_LABELS[FILTER_CYCLE[nextFilterIdx]];

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color={color("primary")}> Models: {FILTER_LABELS[viewFilter as ViewFilter]} ({displayModels.length}) </Text>
        <Text dimColor>Ctrl+B: Tasks</Text>
      </Box>

      {/* Search */}
      <Box>
        <Text dimColor>Search: </Text>
        {isSearching ? (
          <>
            <Text>{searchQuery.slice(0, searchCursor)}</Text>
            <Text inverse>{searchQuery[searchCursor] || " "}</Text>
            <Text>{searchQuery.slice(searchCursor + 1)}</Text>
            <Text dimColor>  (Esc cancel, Enter confirm)</Text>
          </>
        ) : searchQuery ? (
          <Text>{searchQuery}</Text>
        ) : (
          <Text dimColor>/ to search</Text>
        )}
      </Box>
      <Text> </Text>

      {/* Loading */}
      {loading && <Text dimColor>Loading...</Text>}

      {/* Model list */}
      {!loading && displayModels.length === 0 && (
        <Text dimColor>  {FILTER_EMPTY[viewFilter as ViewFilter]}</Text>
      )}

      {!loading &&
        visibleModels.map((model: DisplayModel, i: number) => {
          const actualIndex = startIdx + i;
          return (
            <Box key={model.name}>
              <ModelItem
                model={model}
                isSelected={actualIndex === selectedIndex}
                isActive={model.name === currentModel || `ollama/${model.name}` === currentModel}
                isPendingDelete={pendingDelete === model.name}
              />
            </Box>
          );
        })}

      {hasMore && (
        <Text dimColor>  ... {displayModels.length - startIdx - maxVisible} more</Text>
      )}

      <Text> </Text>
      {pendingDelete ? (
        <Text color={color("error")}>  Press d again to delete "{pendingDelete}", Esc to cancel</Text>
      ) : (
        <Text dimColor>  ↑↓ nav  Tab → {nextFilter}  d del  i info  / search  ↵ select  x cancel  Esc back</Text>
      )}
    </Box>
  );
}
