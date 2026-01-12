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
}

type DisplayModel = {
  name: string;
  isLocal: boolean;
  isDownloading: boolean;
  size?: number;
  description?: string;
  capabilities?: string[];
  progress?: { percent?: number; completed?: number; total?: number; status: string };
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
function loadVerifiedModels(): RemoteModel[] {
  const models = ollamaModelsData.models as OllamaModelEntry[];
  const result: RemoteModel[] = [];

  // Sort by downloads (popularity)
  const sorted = [...models].sort((a, b) => (b.downloads || 0) - (a.downloads || 0));

  for (const model of sorted) {
    // Get practical variants (prefer smaller sizes for browsing)
    const variants = model.variants || [];
    // Sort variants by size (smallest first), take first 2
    const practicalVariants = variants
      .filter(v => !v.id.includes("405b") && !v.id.includes("671b") && !v.id.includes("70b"))
      .slice(0, 2);

    // If no practical variants, use first variant
    const toAdd = practicalVariants.length > 0 ? practicalVariants : variants.slice(0, 1);

    for (const variant of toAdd) {
      const capabilities: string[] = model.model_type === "embedding"
        ? ["embedding"]
        : model.vision ? ["text", "vision"] : ["text"];

      // Add thinking capability for reasoning models
      if (model.id.includes("r1") || model.id.includes("qwq")) {
        capabilities.push("thinking");
      }

      result.push({
        name: variant.id,
        description: `${model.name} (${variant.parameters || variant.name})`,
        capabilities,
      });
    }
  }

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

  // Format capabilities
  const caps = model.capabilities?.map((c) => `[${c}]`).join("") || "";

  // Indicator
  let indicator = "  ";
  if (isActive) indicator = "* ";
  else if (model.isLocal) indicator = "✓ ";
  else if (model.isDownloading) indicator = "↓ ";
  else indicator = "☁ ";

  // Name (truncate if needed)
  const displayName = model.name.length > 24 ? model.name.slice(0, 21) + "..." : model.name.padEnd(24);

  // Size or status
  let sizeText: React.ReactNode;
  if (model.isDownloading && model.progress) {
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
  } else if (model.size) {
    sizeText = <Text dimColor>{formatBytes(model.size)}</Text>;
  } else {
    sizeText = <Text dimColor>          </Text>;
  }

  // Color for model name: green for local, yellow for downloading, gray for remote
  const nameColor = model.isLocal ? color("success") : model.isDownloading ? color("warning") : undefined;

  return (
    <Box>
      <Text inverse={isSelected}>
        <Text color={model.isLocal ? color("success") : model.isDownloading ? color("warning") : color("muted")}>
          {indicator}
        </Text>
        <Text color={nameColor}>{displayName}</Text>
        <Text> </Text>
        {sizeText}
        <Text> </Text>
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

  // Fetch local models from user's Ollama instance
  const fetchModels = useCallback(async () => {
    try {
      const response = await fetch(`${endpoint}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        const data = await response.json();
        const models = (data.models || []).map((m: Record<string, unknown>) => ({
          name: m.name as string,
          size: m.size as number,
          modified: m.modified_at as string,
        }));
        setLocalModels(models);
      }
    } catch {
      // Offline - show only catalog
    }
    setLoading(false);
  }, [endpoint]);

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

  // Build display list: downloading -> local -> available
  const displayModels = useMemo((): DisplayModel[] => {
    const result: DisplayModel[] = [];
    const localNames = new Set(localModels.map((m: LocalModel) => m.name));

    // Get downloading tasks
    const downloadingTasks = tasks.filter(
      (t): t is ModelPullTask => isModelPullTask(t) && isTaskActive(t)
    );

    // Add downloading first
    for (const task of downloadingTasks) {
      result.push({
        name: task.modelName,
        isLocal: false,
        isDownloading: true,
        progress: task.progress,
      });
    }

    // Add local models
    for (const model of localModels) {
      if (!downloadingTasks.some((t) => t.modelName === model.name)) {
        result.push({
          name: model.name,
          isLocal: true,
          isDownloading: false,
          size: model.size,
        });
      }
    }

    // Add available from Ollama registry (not local, not downloading)
    for (const model of remoteModels) {
      if (!localNames.has(model.name) && !downloadingTasks.some((t) => t.modelName === model.name)) {
        result.push({
          name: model.name,
          isLocal: false,
          isDownloading: false,
          description: model.description,
          capabilities: model.capabilities,
        });
      }
    }

    // Filter by search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return result.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          (m.description?.toLowerCase().includes(q) ?? false)
      );
    }

    return result;
  }, [localModels, remoteModels, tasks, searchQuery]);

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

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color={color("primary")}> Models </Text>
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
        <Text dimColor>  No models found</Text>
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
      <Text dimColor>  ↑↓ navigate   / search   ↵ select/download   x cancel   Esc close</Text>
    </Box>
  );
}
