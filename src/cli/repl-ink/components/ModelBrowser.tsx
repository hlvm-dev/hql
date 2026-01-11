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
// Remote Models - Fetched from Ollama's official API
// ============================================================

// Ollama's official registry API endpoint
const OLLAMA_REGISTRY_API = "https://ollama.com/api/tags";

/**
 * Fetch available models from Ollama's official registry API.
 * This returns real, verified model names directly from Ollama.
 */
async function fetchRemoteModels(): Promise<RemoteModel[]> {
  try {
    const response = await fetch(OLLAMA_REGISTRY_API, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return [];

    const data = await response.json();
    const models = data.models || [];

    return models.map((m: { name: string; size?: number }) => ({
      name: m.name,
      description: formatModelDescription(m.name),
      capabilities: inferCapabilities(m.name),
    }));
  } catch {
    // Fallback to empty - user can still type model names manually
    return [];
  }
}

/** Infer capabilities from model name */
function inferCapabilities(name: string): string[] {
  const n = name.toLowerCase();
  const caps: string[] = ["text"];

  if (n.includes("vision") || n.includes("llava") || n.includes("-vl")) {
    caps.push("vision");
  }
  if (n.includes("embed")) {
    return ["embedding"];
  }
  if (n.includes("r1") || n.includes("qwq") || n.includes("thinking")) {
    caps.push("thinking");
  }
  if (n.includes("coder") || n.includes("code") || n.includes("starcoder")) {
    // coding models still have "text" capability
  }
  return caps;
}

/** Format model name into description */
function formatModelDescription(name: string): string {
  // Extract base name and size
  const [base, tag] = name.split(":");
  const size = tag ? ` - ${tag.toUpperCase()}` : "";

  // Capitalize base name nicely
  const formatted = base
    .split("-")
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  return `${formatted}${size}`;
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
  const { tasks, pullModel, cancel, isModelPulling } = useTaskManager();

  // State
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [remoteModels, setRemoteModels] = useState<RemoteModel[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
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
