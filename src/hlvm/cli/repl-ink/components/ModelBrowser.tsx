/**
 * ModelBrowser Panel
 *
 * Browse installed and available Ollama models.
 * Download new models with progress tracking.
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from "npm:react@18";
import { Box, Text, useInput } from "npm:ink@5";
import { useTheme } from "../../theme/index.ts";
import { useTaskManager } from "../hooks/useTaskManager.ts";
import { ProgressBar, formatBytes } from "./ProgressBar.tsx";
import type { ModelPullTask } from "../../repl/task-manager/types.ts";
import { isModelPullTask, isTaskActive } from "../../repl/task-manager/types.ts";
import { getTaskManager } from "../../repl/task-manager/index.ts";
import { handleTextEditingKey } from "../utils/text-editing.ts";
import { getPlatform } from "../../../../platform/platform.ts";
import { DEFAULT_OLLAMA_ENDPOINT } from "../../../../common/config/types.ts";
import { capabilitiesToDisplayTags } from "../../../providers/types.ts";
import type { ModelInfo } from "../../../providers/types.ts";
import { isOllamaCloudModel } from "../../../providers/ollama/cloud.ts";

// Local alias for platform openUrl
const openUrl = (url: string) => getPlatform().openUrl(url);

// ============================================================
// Types
// ============================================================

interface ModelBrowserProps {
  /** Callback when panel closes */
  onClose: () => void;
  /** Callback when model is selected (set as active). Optional agentMode for claude-code models. */
  onSelectModel?: (modelName: string, agentMode?: "hlvm" | "claude-code-agent") => void;
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
  isOllamaCloud?: boolean; // Ollama cloud variant (needs pull + possibly signin)
}

/** Cloud model from an API provider (OpenAI, Anthropic, Google) */
interface CloudModel {
  name: string;           // e.g., "gpt-4o"
  displayName: string;    // e.g., "GPT-4o"
  provider: string;       // e.g., "openai"
  providerDisplay: string;// e.g., "OpenAI"
  capabilities: string[];
  needsKey?: boolean;     // true if API key not set
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
  available: "Available",
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
  available: "No available models",
  tools: "No tool-capable models",
  vision: "No vision models",
  thinking: "No thinking models",
  embedding: "No embedding models",
  cloud: "No cloud-only models",
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
  // Cloud variants are always practical (run on Ollama's infrastructure)
  if (isOllamaCloudModel(name)) return true;
  const lower = name.toLowerCase();
  return !lower.includes("405b") && !lower.includes("671b") && !lower.includes("70b");
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
  const tags = capabilitiesToDisplayTags(model.capabilities);
  // Only the -cloud tag suffix means "this variant IS a cloud model".
  // meta.cloud means "this model family supports cloud" — not the same thing.
  const isCloud = isOllamaCloudModel(model.name);

  return {
    name: model.name,
    description,
    capabilities: isCloud ? [...tags, "cloud"] : tags,
    size: getCatalogSize(model),
    provider: getProvider(modelId),
    isOllamaCloud: isCloud,
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

/** Filter models based on current mode */
function filterByMode(models: DisplayModel[], filter: FilterMode): DisplayModel[] {
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
  isPendingDelete: boolean
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
      return "available";
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

  const statusKind = getModelStatusKind(model, isActive, isPendingDelete);
  const indicator = getStatusIndicator(statusKind);
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

  // Name (truncate if needed)
  const displayName = model.name.length > 40 ? model.name.slice(0, 37) + "..." : model.name.padEnd(40);

  // Size or status
  let sizeText: React.ReactNode;
  if (model.downloadStatus === "downloading" && model.progress) {
    const { progress } = model;
    if (progress.total && progress.completed) {
      sizeText = (
        <>
          <ProgressBar percent={progress.percent || 0} width={10} showPercent />
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
        <Text dimColor>{statusTag}</Text>
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
  endpoint = DEFAULT_OLLAMA_ENDPOINT,
}: ModelBrowserProps): React.ReactElement {
  const { color } = useTheme();
  const { tasks, cancel } = useTaskManager();
  const manager = useMemo(() => getTaskManager(endpoint), [endpoint]);

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
  const [isSearching, setIsSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  // Claude Code mode selection: model name pending mode choice, and selected mode index (0=LLM, 1=Agent)
  const [pendingModeSelect, setPendingModeSelect] = useState<string | null>(null);
  const [modeSelectIndex, setModeSelectIndex] = useState(0);
  // Track model name pending auto-select after pull completes (Ollama cloud flow)
  const pendingSelectRef = useRef<string | null>(null);
  const activeFilterMode = filterMode as FilterMode;

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

  // Fetch local models - 100% SSOT via ai.models API (no fallback)
  const fetchModels = useCallback(async () => {
    // 100% SSOT: Use ai.models API only - no direct fetch fallback
    const aiApi = (globalThis as Record<string, unknown>).ai as {
      models: {
        list: () => Promise<{ name: string; size?: number; modifiedAt?: Date }[]>;
        listAll?: () => Promise<{
          name: string; displayName?: string; capabilities?: string[];
          metadata?: { provider?: string; providerDisplayName?: string; apiKeyConfigured?: boolean; [k: string]: unknown };
        }[]>;
      };
    } | undefined;

    // Fetch local (Ollama) models — independent of cloud
    try {
      if (aiApi?.models?.list) {
        const modelList = await aiApi.models.list();
        const models = modelList.map((m) => ({
          name: m.name,
          size: m.size || 0,
          modified: m.modifiedAt?.toISOString() || "",
        }));
        setLocalModels(models);
      } else {
        setLocalModels([]);
      }
    } catch {
      setLocalModels([]);
    }

    // Fetch cloud models from all non-ollama providers (independent of Ollama)
    // Providers return their known models even without API keys set
    try {
      if (aiApi?.models?.listAll) {
        const allModels = await aiApi.models.listAll();
        const cloud = allModels
          .filter((m) => {
            const provider = (m.metadata?.provider as string) ?? "";
            return provider !== "ollama";
          })
          .map((m): CloudModel => ({
            name: m.name,
            displayName: m.displayName ?? m.name,
            provider: (m.metadata?.provider as string) ?? "",
            providerDisplay: (m.metadata?.providerDisplayName as string) ?? "",
            capabilities: (m.capabilities as string[]) ?? [],
            needsKey: m.metadata?.apiKeyConfigured === false,
          }));
        setCloudModels(cloud);
      }
    } catch {
      setCloudModels([]);
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

  // Reactive Ollama Cloud signin: on auth error during cloud model pull,
  // spawn `ollama signin` then retry pull
  const triggerOllamaSignin = useCallback(async (thenPullModel?: string) => {
    setStatusMessage("Signing in to Ollama Cloud...");
    try {
      // Use run() with inherit so the user sees the interactive signin flow in their terminal
      const process = getPlatform().command.run({
        cmd: ["ollama", "signin"],
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      const result = await process.status;
      if (result.success) {
        setStatusMessage("Signed in! Pulling model...");
        if (thenPullModel) {
          try {
            getTaskManager().pullModel(thenPullModel);
          } catch { /* already downloading */ }
        }
      } else {
        setStatusMessage("Sign-in cancelled or failed. Try 'ollama signin' manually.");
      }
    } catch {
      setStatusMessage("Could not run 'ollama signin'. Is Ollama installed?");
    }
  }, []);

  // Auto-refresh when downloads complete + detect auth failures for cloud models
  useEffect(() => {
    const manager = getTaskManager();
    const unsubscribe = manager.onEvent((event) => {
      // Refresh model list when a model pull completes successfully
      if (event.type === "task:completed") {
        const task = manager.getTask(event.taskId);
        if (task && isModelPullTask(task)) {
          fetchModels();
          // Auto-select if this was a pending cloud model pull
          if (pendingSelectRef.current === task.modelName && onSelectModel) {
            pendingSelectRef.current = null;
            setIsSelecting(true);
            setStatusMessage("Setting default model...");
            void Promise.resolve(onSelectModel(task.modelName));
          }
        }
      }
      // Detect auth failure on cloud model pull → trigger `ollama signin`
      if (event.type === "task:failed") {
        const task = manager.getTask(event.taskId);
        if (task && isModelPullTask(task) && isOllamaCloudModel(task.modelName)) {
          const errorMsg = task.error?.message ?? "";
          if (errorMsg.includes("unauthorized") || errorMsg.includes("auth") || errorMsg.includes("401")) {
            triggerOllamaSignin(task.modelName);
          }
        }
      }
    });
    return unsubscribe;
  }, [fetchModels, triggerOllamaSignin]);

  // Build display list - POSITION STABLE (models never move regardless of status)
  // Order is determined by remoteModels (sorted by size), local status is just a flag
  const displayModels = useMemo((): DisplayModel[] => {
    const result: DisplayModel[] = [];

    // Build lookup maps
    const localMap = new Map<string, LocalModel>(localModels.map((m: LocalModel) => [m.name, m]));
    const remoteNameSet = new Set(remoteModels.map((m: RemoteModel) => m.name));
    const pullTasksByModel = modelPullTasks.byModel;
    const activePullTasksByModel = modelPullTasks.activeByModel;

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
        if (task.status === "cancelled" || task.status === "failed") return task;
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
        isDownloading: downloadStatus === "downloading",
        downloadStatus,
        size: local?.size,
        sizeStr: model.isOllamaCloud && !local ? "Cloud" : model.size,
        description: model.description,
        capabilities,
        provider: model.provider || getProvider(model.name),
        progress: task?.progress,
      });
    }

    // Add local-only models (not in registry) at the end
    for (const model of localModels) {
      if (!remoteNameSet.has(model.name)) {
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

    // Append cloud models (API providers: OpenAI, Anthropic, Google)
    for (const model of cloudModels) {
      const fullName = `${model.provider}/${model.name}`;
      const tags = capabilitiesToDisplayTags(model.capabilities);
      tags.push("cloud");
      result.push({
        name: fullName,
        isLocal: false,
        isDownloading: false,
        downloadStatus: "idle",
        sizeStr: model.needsKey ? "No key" : "Cloud",
        description: model.displayName,
        capabilities: tags,
        provider: model.needsKey ? `${model.providerDisplay} *` : model.providerDisplay,
        needsKey: model.needsKey,
      });
    }

    // Apply filter mode
    let filtered = filterByMode(result, filterMode);

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
  }, [localModels, remoteModels, cloudModels, modelPullTasks, searchQuery, filterMode]);

  // Keep selection stable by model name (avoid index jumps when list updates)
  useEffect(() => {
    setSelection((current: SelectionState) => {
      if (displayModels.length === 0) {
        if (current.index === 0 && current.name === null) return current;
        return { index: 0, name: null };
      }

      if (current.name) {
        const idx = displayModels.findIndex((m: DisplayModel) => m.name === current.name);
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
        const nextIndex = Math.max(0, Math.min(displayModels.length - 1, current.index + delta));
        const name = displayModels[nextIndex]?.name ?? null;
        return { index: nextIndex, name };
      });
      setPendingDelete(null);
      clearStatus();
    };

    // API provider cloud models (OpenAI, Anthropic, Google, Claude Code) — select directly
    const isApiProviderCloud = (m: DisplayModel) =>
      m.capabilities?.includes("cloud") && !m.isLocal &&
      (m.name.startsWith("openai/") || m.name.startsWith("anthropic/") || m.name.startsWith("google/") || m.name.startsWith("claude-code/"));

    // Ollama cloud models — need pull (and possibly `ollama signin` on auth error)
    const isOllamaCloud = (m: DisplayModel) =>
      m.capabilities?.includes("cloud") && !m.isLocal &&
      !m.name.startsWith("openai/") && !m.name.startsWith("anthropic/") && !m.name.startsWith("google/") && !m.name.startsWith("claude-code/");

    const performSelectionAction = () => {
      const model = displayModels[selection.index] ?? displayModels[0];
      if (!model) return;

      // Cloud models without API key
      if (model.needsKey) {
        const provider = model.name.split("/")[0];
        setStatusMessage(`Set ${provider.toUpperCase()}_API_KEY to use this model`);
        return;
      }

      // Claude Code models: prompt for mode selection (LLM Only vs Full Agent)
      if (model.name.startsWith("claude-code/") && onSelectModel) {
        setPendingModeSelect(model.name);
        setModeSelectIndex(0);
        return;
      }

      // API provider cloud models: select directly (always available, no download)
      if (isApiProviderCloud(model) && onSelectModel) {
        setIsSelecting(true);
        setStatusMessage("Setting default model...");
        void Promise.resolve(onSelectModel(model.name));
        return;
      }

      if (model.isLocal && onSelectModel) {
        setIsSelecting(true);
        setStatusMessage("Setting default model...");
        void Promise.resolve(onSelectModel(model.name));
        return;
      }
      if (model.isLocal && !onSelectModel) {
        onClose();
        return;
      }
      // Non-local models (including Ollama cloud) go through pull
      if (!model.isLocal && !model.isDownloading && !isApiProviderCloud(model)) {
        // Remember which model to auto-select after pull completes
        if (onSelectModel) pendingSelectRef.current = model.name;
        try {
          manager.pullModel(model.name);
        } catch {
          // Already downloading - ignore
        }
      }
    };

    if (isSelecting) return;

    // Mode selection prompt (Claude Code: LLM Only vs Full Agent)
    if (pendingModeSelect) {
      if (key.escape) {
        setPendingModeSelect(null);
        clearStatus();
        return;
      }
      if (key.upArrow || key.leftArrow) {
        setModeSelectIndex(0);
        return;
      }
      if (key.downArrow || key.rightArrow) {
        setModeSelectIndex(1);
        return;
      }
      if (input === "1") { setModeSelectIndex(0); return; }
      if (input === "2") { setModeSelectIndex(1); return; }
      if (key.return && onSelectModel) {
        const mode = modeSelectIndex === 0 ? "hlvm" : "claude-code-agent";
        setIsSelecting(true);
        setStatusMessage(mode === "hlvm" ? "Setting LLM-only mode..." : "Setting Claude Code Agent mode...");
        // Pass mode as metadata suffix: onSelectModel receives model name, we set agentMode separately
        void Promise.resolve(onSelectModel(pendingModeSelect, mode as "hlvm" | "claude-code-agent"));
        setPendingModeSelect(null);
        return;
      }
      return;
    }

    // Search mode
    if (isSearching) {
      if (key.escape) {
        setIsSearching(false);
        setSearchQuery("");
        setSearchCursor(0);
        clearStatus();
        return;
      }
      if (key.return) {
        setIsSearching(false);
        clearStatus();
        performSelectionAction();
        return;
      }

      if (key.upArrow) {
        moveSelection(-1);
        return;
      }
      if (key.downArrow) {
        moveSelection(1);
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
      moveSelection(-1);
    }
    if (key.downArrow || input === "j") {
      moveSelection(1);
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
        return FILTER_CYCLE[(idx - 1 + FILTER_CYCLE.length) % FILTER_CYCLE.length];
      });
      resetSelection();
      setPendingDelete(null);
      clearStatus();
      return;
    }

    // 'i' opens model info page in browser
    if (input === "i" && displayModels[selection.index]) {
      const model = displayModels[selection.index];
      if (isApiProviderCloud(model)) {
        const name = model.name;
        if (name.startsWith("openai/")) openUrl("https://platform.openai.com/docs/models");
        else if (name.startsWith("anthropic/")) openUrl("https://docs.anthropic.com/en/docs/about-claude/models");
        else if (name.startsWith("google/")) openUrl("https://ai.google.dev/gemini-api/docs/models");
        else if (name.startsWith("claude-code/")) openUrl("https://docs.anthropic.com/en/docs/about-claude/models");
        else setStatusMessage("No info page for this provider");
      } else if (isOllamaCloud(model)) {
        openUrl("https://ollama.com/cloud");
      } else {
        openUrl(getOllamaUrl(model.name));
      }
      return;
    }

    // 'd' - Delete local model (with confirmation)
    if (input === "d" && displayModels[selection.index]) {
      const model = displayModels[selection.index];

      // Cloud models can't be deleted (API provider or Ollama cloud)
      if (isApiProviderCloud(model) || isOllamaCloud(model)) {
        setStatusMessage("Cloud models can't be deleted");
        return;
      }

      // Only allow delete for local models (not downloading or remote)
      if (!model.isLocal || model.isDownloading) return;

      const isActive = model.name === currentModel || `ollama/${model.name}` === currentModel;
      if (isActive) {
        setPendingDelete(null);
        setStatusMessage("Can't delete active model. Select another model first.");
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
      clearStatus();
    }

    // Select/Download/Resume
    if (key.return) {
      performSelectionAction();
    }

    // Space to select as active (same behavior as Enter)
    if (input === " " && displayModels[selection.index]) {
      performSelectionAction();
    }

    // Helper: find active pull task for a model name
    const findActivePullTask = (modelName: string) =>
      modelPullTasks.activeByModel.get(modelName);

    // Cancel download ('x' key)
    if (input === "x" && displayModels[selection.index]) {
      const model = displayModels[selection.index];
      if (model.isDownloading) {
        const task = findActivePullTask(model.name);
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
      const selectedModel = displayModels[selection.index];
      if (selectedModel?.isDownloading) {
        const task = findActivePullTask(selectedModel.name);
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
  const startIdx = Math.max(0, Math.min(selection.index - 3, displayModels.length - maxVisible));
  const visibleModels = displayModels.slice(startIdx, startIdx + maxVisible);
  const hasMore = displayModels.length > startIdx + maxVisible;

  // Calculate next filter for footer hint
  const nextFilterIdx = (FILTER_CYCLE.indexOf(activeFilterMode) + 1) % FILTER_CYCLE.length;
  const nextFilter = FILTER_LABELS[FILTER_CYCLE[nextFilterIdx]];

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color={color("primary")}>
          Models: {FILTER_LABELS[activeFilterMode]} ({displayModels.length})
        </Text>
        <Text dimColor>{currentModel ? `Default: ${currentModel}` : "Default: none"}</Text>
      </Box>
      <Box justifyContent="space-between">
        <Box>
          {FILTER_CYCLE.map((mode, idx) => (
            <React.Fragment key={mode}>
              <Text
                color={mode === activeFilterMode ? color("accent") : color("muted")}
                inverse={mode === activeFilterMode}
              >
                {FILTER_LABELS[mode]}
              </Text>
              {idx < FILTER_CYCLE.length - 1 ? <Text dimColor> · </Text> : null}
            </React.Fragment>
          ))}
        </Box>
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
            <Text dimColor>  (Esc cancel, Enter select)</Text>
          </>
        ) : searchQuery ? (
          <Text>{searchQuery}</Text>
        ) : (
          <Text dimColor>/ to search</Text>
        )}
      </Box>
      <Box>
        <Text dimColor>Selected: </Text>
        {displayModels[selection.index] ? (
          (() => {
            const selected = displayModels[selection.index];
            const isActive = selected.name === currentModel || `ollama/${selected.name}` === currentModel;
            const isPending = pendingDelete === selected.name;
            const status = getModelStatusLabel(getModelStatusKind(selected, isActive, isPending));
            return (
              <>
                <Text>{selected.name}</Text>
                <Text dimColor> [{status}]</Text>
              </>
            );
          })()
        ) : (
          <Text dimColor>None</Text>
        )}
      </Box>

      {/* Loading */}
      {loading && <Text dimColor>Loading...</Text>}

      {/* Model list */}
      {!loading && displayModels.length === 0 && (
        <Text dimColor>  {FILTER_EMPTY[activeFilterMode]}</Text>
      )}

      {!loading &&
        visibleModels.map((model: DisplayModel, i: number) => {
          const actualIndex = startIdx + i;
          return (
            <Box key={model.name}>
                <ModelItem
                  model={model}
                  isSelected={actualIndex === selection.index}
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
      {pendingModeSelect ? (
        <Box flexDirection="column">
          <Text color={color("accent")}>  Select mode for {pendingModeSelect.split("/")[1]}:</Text>
          <Text>  {modeSelectIndex === 0 ? "▸" : " "} <Text bold={modeSelectIndex === 0} color={modeSelectIndex === 0 ? color("accent") : undefined}>1. LLM Only</Text> <Text dimColor>— HLVM orchestrates tools, Claude is the brain</Text></Text>
          <Text>  {modeSelectIndex === 1 ? "▸" : " "} <Text bold={modeSelectIndex === 1} color={modeSelectIndex === 1 ? color("accent") : undefined}>2. Full Agent</Text> <Text dimColor>— Claude Code handles everything end-to-end</Text></Text>
          <Text dimColor>  ↑↓ or 1/2 to choose  ↵ confirm  Esc cancel</Text>
        </Box>
      ) : pendingDelete ? (
        <Text color={color("error")}>  Press d again to delete "{pendingDelete}", Esc to cancel</Text>
      ) : statusMessage ? (
        <Text color={color("warning")}>  {statusMessage}</Text>
      ) : (
        <Text dimColor>
          ↑↓ nav  Tab → {nextFilter}  d del  i info  / search  ↵ select  x cancel  Esc back
        </Text>
      )}
    </Box>
  );
}
