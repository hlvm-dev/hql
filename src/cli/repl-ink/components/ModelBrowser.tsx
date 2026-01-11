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
// Popular Models Catalog (same as in ollama-runtime)
// ============================================================

const POPULAR_MODELS: RemoteModel[] = [
  // Llama family
  { name: "llama3.2:3b", description: "Meta Llama 3.2 - 3B", capabilities: ["text", "tools"] },
  { name: "llama3.2:latest", description: "Meta Llama 3.2 - default", capabilities: ["text", "tools"] },
  { name: "llama3.1:8b", description: "Meta Llama 3.1 - 8B", capabilities: ["text", "tools"] },
  { name: "llama3.1:70b", description: "Meta Llama 3.1 - 70B", capabilities: ["text", "tools"] },
  { name: "llama3.3:70b", description: "Meta Llama 3.3 - 70B", capabilities: ["text", "tools"] },
  { name: "codellama:7b", description: "Meta Code Llama - 7B", capabilities: ["text"] },
  { name: "codellama:13b", description: "Meta Code Llama - 13B", capabilities: ["text"] },
  // Qwen family
  { name: "qwen2.5:3b", description: "Alibaba Qwen 2.5 - 3B", capabilities: ["text", "tools"] },
  { name: "qwen2.5:7b", description: "Alibaba Qwen 2.5 - 7B", capabilities: ["text", "tools"] },
  { name: "qwen2.5:14b", description: "Alibaba Qwen 2.5 - 14B", capabilities: ["text", "tools"] },
  { name: "qwen2.5:32b", description: "Alibaba Qwen 2.5 - 32B", capabilities: ["text", "tools"] },
  { name: "qwen2.5-coder:7b", description: "Qwen 2.5 Coder - 7B", capabilities: ["text", "tools"] },
  { name: "qwen2.5-coder:14b", description: "Qwen 2.5 Coder - 14B", capabilities: ["text", "tools"] },
  { name: "qwq:32b", description: "Alibaba QwQ - reasoning", capabilities: ["text", "thinking"] },
  // DeepSeek family
  { name: "deepseek-r1:7b", description: "DeepSeek R1 - 7B reasoning", capabilities: ["text", "thinking"] },
  { name: "deepseek-r1:14b", description: "DeepSeek R1 - 14B reasoning", capabilities: ["text", "thinking"] },
  { name: "deepseek-r1:32b", description: "DeepSeek R1 - 32B reasoning", capabilities: ["text", "thinking"] },
  { name: "deepseek-coder-v2:16b", description: "DeepSeek Coder V2 - 16B", capabilities: ["text"] },
  // Mistral family
  { name: "mistral:7b", description: "Mistral 7B", capabilities: ["text", "tools"] },
  { name: "mistral-small:22b", description: "Mistral Small - 22B", capabilities: ["text", "tools"] },
  { name: "mixtral:8x7b", description: "Mixtral 8x7B MoE", capabilities: ["text", "tools"] },
  // Google Gemma
  { name: "gemma2:2b", description: "Google Gemma 2 - 2B", capabilities: ["text"] },
  { name: "gemma2:9b", description: "Google Gemma 2 - 9B", capabilities: ["text"] },
  { name: "gemma2:27b", description: "Google Gemma 2 - 27B", capabilities: ["text"] },
  // Microsoft Phi
  { name: "phi3:mini", description: "Microsoft Phi-3 Mini", capabilities: ["text"] },
  { name: "phi3:medium", description: "Microsoft Phi-3 Medium", capabilities: ["text"] },
  { name: "phi4:14b", description: "Microsoft Phi-4 - 14B", capabilities: ["text"] },
  // Vision models
  { name: "llava:7b", description: "LLaVA Vision - 7B", capabilities: ["text", "vision"] },
  { name: "llava:13b", description: "LLaVA Vision - 13B", capabilities: ["text", "vision"] },
  { name: "llama3.2-vision:11b", description: "Llama 3.2 Vision - 11B", capabilities: ["text", "vision"] },
  // Coding models
  { name: "starcoder2:3b", description: "StarCoder2 - 3B", capabilities: ["text"] },
  { name: "starcoder2:7b", description: "StarCoder2 - 7B", capabilities: ["text"] },
  // Embedding models
  { name: "nomic-embed-text", description: "Nomic Embed Text", capabilities: ["embedding"] },
  { name: "mxbai-embed-large", description: "MixedBread Embed Large", capabilities: ["embedding"] },
  // Other popular models
  { name: "dolphin-mixtral:8x7b", description: "Dolphin Mixtral - uncensored", capabilities: ["text"] },
  { name: "neural-chat:7b", description: "Intel Neural Chat - 7B", capabilities: ["text"] },
  { name: "yi:34b", description: "01.AI Yi - 34B", capabilities: ["text"] },
  { name: "command-r:35b", description: "Cohere Command-R - 35B", capabilities: ["text", "tools"] },
];

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
  const { tasks, pullModel, cancel, isModelPulling } = useTaskManager();

  // State
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [loading, setLoading] = useState(true);

  // Fetch local models
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

    // Add available (not local, not downloading)
    for (const model of POPULAR_MODELS) {
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
  }, [localModels, tasks, searchQuery]);

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
      } else if (key.return) {
        setIsSearching(false);
      } else if (key.backspace || key.delete) {
        setSearchQuery((q: string) => q.slice(0, -1));
      } else if (input && input.length === 1 && !key.ctrl && !key.meta) {
        setSearchQuery((q: string) => q + input);
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
          pullModel(model.name);
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
            <Text inverse>{searchQuery}_</Text>
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
