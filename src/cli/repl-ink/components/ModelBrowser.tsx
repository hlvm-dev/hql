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
import { openUrl } from "../../../platform/platform.ts";

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
// Model Catalog - Loaded from verified ollama_models.json
// Source: ~/dev/HLVM/HLVM/Resources/ollama_models.json (205 models)
// ============================================================

import ollamaModelsData from "../data/ollama_models.json" with { type: "json" };

interface OllamaModelVariant {
  id: string;
  name: string;
  parameters: string;
  size: string;
  context: string;
  vision: boolean;
}

interface OllamaModelEntry {
  id: string;
  name: string;
  description: string;
  variants: OllamaModelVariant[];
  vision: boolean;
  downloads: number;
  model_type?: string;
}

/**
 * Load models from verified JSON file, sorted by popularity.
 * Returns practical variants (smallest 2-3 per model family).
 */
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

function loadVerifiedModels(): RemoteModel[] {
  const models = ollamaModelsData.models as OllamaModelEntry[];
  const result: RemoteModel[] = [];

  for (const model of models) {
    const variants = model.variants || [];
    // Filter out very large models
    const practicalVariants = variants
      .filter(v => !v.id.includes("405b") && !v.id.includes("671b") && !v.id.includes("70b"))
      .slice(0, 2);

    const toAdd = practicalVariants.length > 0 ? practicalVariants : variants.slice(0, 1);

    for (const variant of toAdd) {
      const capabilities: string[] = model.model_type === "embedding"
        ? ["embedding"]
        : model.vision ? ["text", "vision"] : ["text"];

      if (model.id.includes("r1") || model.id.includes("qwq")) {
        capabilities.push("thinking");
      }

      result.push({
        name: variant.id,
        description: `${model.name} (${variant.parameters || variant.name})`,
        capabilities,
        size: variant.size,
        provider: getProvider(model.id),
      });
    }
  }

  // Sort by size (smallest first)
  result.sort((a, b) => parseSizeToBytes(a.size || "") - parseSizeToBytes(b.size || ""));

  return result;
}

// Pre-load verified models (205 models from HLVM)
const VERIFIED_MODELS = loadVerifiedModels();

/**
 * Get remote models from verified JSON.
 * No network request needed - data is bundled.
 */
async function fetchRemoteModels(): Promise<RemoteModel[]> {
  return VERIFIED_MODELS;
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
}: {
  model: DisplayModel;
  isSelected: boolean;
  isActive: boolean;
}): React.ReactElement {
  const { color } = useTheme();

  // Format provider tag
  const providerTag = model.provider ? `[${model.provider}]` : "";

  // Format capabilities
  const caps = model.capabilities?.map((c) => `[${c}]`).join("") || "";

  // Indicator based on downloadStatus
  let indicator = "  ";
  let indicatorColor = color("muted");
  if (isActive) {
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

  // Color for model name: green for local, yellow for downloading, red for cancelled/failed, gray for remote
  const nameColor = model.isLocal
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

    // Build from remoteModels (stable order - sorted by size)
    // Mark as local if exists in localMap
    for (const model of remoteModels) {
      const local = localMap.get(model.name);
      const task = pullTasks.find((t) => t.modelName === model.name);
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
        const task = pullTasks.find((t) => t.modelName === model.name);
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

    // Navigation
    if (key.upArrow || input === "k") {
      setSelectedIndex((i: number) => Math.max(0, i - 1));
    }
    if (key.downArrow || input === "j") {
      setSelectedIndex((i: number) => Math.min(displayModels.length - 1, i + 1));
    }

    // Tab cycles filter forward
    if (key.tab && !key.shift) {
      const idx = FILTER_CYCLE.indexOf(viewFilter);
      setViewFilter(FILTER_CYCLE[(idx + 1) % FILTER_CYCLE.length]);
      setSelectedIndex(0);
      return;
    }

    // Shift+Tab cycles filter backward
    if (key.tab && key.shift) {
      const idx = FILTER_CYCLE.indexOf(viewFilter);
      setViewFilter(FILTER_CYCLE[(idx - 1 + FILTER_CYCLE.length) % FILTER_CYCLE.length]);
      setSelectedIndex(0);
      return;
    }

    // 'i' opens model info page in browser
    if (input === "i" && displayModels[selectedIndex]) {
      const url = getOllamaUrl(displayModels[selectedIndex].name);
      openUrl(url);
      return;
    }

    // Search
    if (input === "/") {
      setIsSearching(true);
      setSearchCursor(searchQuery.length); // Start at end of existing query
    }

    // Select/Download
    if (key.return && displayModels[selectedIndex]) {
      const model = displayModels[selectedIndex];
      if (model.isLocal && onSelectModel) {
        onSelectModel(model.name);
        onClose();
      } else if (!model.isLocal && !model.isDownloading) {
        // Start download
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

    // Cancel download
    if (input === "x" && displayModels[selectedIndex]) {
      const model = displayModels[selectedIndex];
      if (model.isDownloading) {
        const task = tasks.find(
          (t) => isModelPullTask(t) && (t as ModelPullTask).modelName === model.name
        );
        if (task) cancel(task.id);
      }
    }

    // Close
    if (key.escape) {
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
              />
            </Box>
          );
        })}

      {hasMore && (
        <Text dimColor>  ... {displayModels.length - startIdx - maxVisible} more</Text>
      )}

      <Text> </Text>
      <Text dimColor>  ↑↓ nav  Tab → {nextFilter}  i info  / search  ↵ select  x cancel  Esc back</Text>
    </Box>
  );
}
