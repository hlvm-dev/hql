/**
 * Config Panel Component
 * Interactive config editor (Claude Code / Gemini CLI style)
 *
 * UX:
 * - Up/Down: Navigate between settings
 * - Tab/Shift+Tab or Left/Right: Cycle options (for select fields)
 * - Enter: Edit text fields or confirm
 * - Space: Cycle options (for select fields)
 * - Esc: Close panel or cancel edit
 * - r: Reset all to defaults
 */

import React, { useState, useEffect, useCallback } from "npm:react@18";
import { Box, Text, useInput } from "npm:ink@5";
import { handleTextEditingKey } from "../utils/text-editing.ts";
import {
  type ConfigKey,
  type HqlConfig,
  CONFIG_KEYS,
  DEFAULT_CONFIG,
  validateValue,
} from "../../../common/config/types.ts";
import {
  loadConfig,
  updateConfigRuntime,
  resetConfigRuntime,
} from "../../../common/config/index.ts";
import { useTheme, THEME_NAMES, type ThemeName } from "../../theme/index.ts";
import {
  fetchModelInfo,
  formatCapabilityTags,
  type ModelInfo,
} from "../utils/model-info.ts";

interface ConfigPanelProps {
  onClose: () => void;
  /** Callback to open Model Browser panel */
  onOpenModelBrowser?: () => void;
}

// Field type determines UX
type FieldType = "select" | "input";

interface FieldMeta {
  label: string;
  description: string;
  type: FieldType;
  options?: string[];  // For select type
}

// Config field metadata
const FIELD_META: Record<ConfigKey, FieldMeta> = {
  model: {
    label: "Model",
    description: "AI model",
    type: "select",
    options: [], // Populated from Ollama
  },
  endpoint: {
    label: "Endpoint",
    description: "API URL",
    type: "input",
  },
  temperature: {
    label: "Temperature",
    description: "0.0-2.0",
    type: "input",
  },
  maxTokens: {
    label: "Max Tokens",
    description: "Response limit",
    type: "input",
  },
  theme: {
    label: "Theme",
    description: "Color theme",
    type: "select",
    options: THEME_NAMES,
  },
};

type Mode = "navigate" | "edit";

export function ConfigPanel({ onClose, onOpenModelBrowser }: ConfigPanelProps): React.ReactElement {
  const [config, setConfig] = useState<HqlConfig>(DEFAULT_CONFIG);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<Mode>("navigate");
  const [editValue, setEditValue] = useState("");
  const [editCursor, setEditCursor] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);

  // Theme context - setTheme triggers re-render of all themed components
  const { color, setTheme } = useTheme();

  // Fetch model info for current model
  const updateModelInfo = useCallback(async (model: string, endpoint: string) => {
    try {
      const info = await fetchModelInfo(endpoint, model);
      setModelInfo(info);
    } catch {
      setModelInfo(null);
    }
  }, []);

  // Load config and fetch models on mount
  useEffect(() => {
    loadConfig().then((cfg) => {
      setConfig(cfg);
      // Fetch model info for initial model
      updateModelInfo(cfg.model, cfg.endpoint || DEFAULT_CONFIG.endpoint);
      // Fetch available models using loaded config's endpoint
      fetchOllamaModels(cfg.endpoint || DEFAULT_CONFIG.endpoint, cfg.model);
    });
  }, [updateModelInfo]);

  // Fetch available models from Ollama
  async function fetchOllamaModels(endpoint: string, currentModel: string) {
    try {
      const response = await fetch(`${endpoint}/api/tags`);
      if (response.ok) {
        const data = await response.json();
        const models = (data.models || []).map((m: { name: string }) => `ollama/${m.name}`);
        // If no models found, use current config model (no hardcoded fallback)
        setAvailableModels(models.length > 0 ? models : [currentModel || DEFAULT_CONFIG.model]);
      } else {
        // Ollama responded but with error - use current config model
        setAvailableModels([currentModel || DEFAULT_CONFIG.model]);
      }
    } catch {
      // Ollama not reachable - use current config model (no hardcoded list)
      setAvailableModels([currentModel || DEFAULT_CONFIG.model]);
    }
  }

  const selectedKey = CONFIG_KEYS[selectedIndex];
  const fieldMeta = FIELD_META[selectedKey];

  // Get options for current field
  function getOptions(): string[] {
    if (selectedKey === "model") {
      return availableModels;
    }
    return fieldMeta.options || [];
  }

  // Handle keyboard input
  // deno-lint-ignore no-explicit-any
  useInput((input: string, key: any) => {
    if (mode === "navigate") {
      handleNavigateMode(input, key);
    } else {
      handleEditMode(input, key);
    }
  });

  // deno-lint-ignore no-explicit-any
  function handleNavigateMode(input: string, key: any) {
    // Up/Down: Navigate between fields
    if (key.upArrow) {
      setSelectedIndex((i: number) => Math.max(0, i - 1));
      setError(null);
    }
    if (key.downArrow) {
      setSelectedIndex((i: number) => Math.min(CONFIG_KEYS.length - 1, i + 1));
      setError(null);
    }

    const isSelectField = fieldMeta.type === "select";
    const options = getOptions();

    // Tab/Shift+Tab or Left/Right: Cycle options for select fields
    if (isSelectField && options.length > 0) {
      if (key.tab && !key.shift) {
        cycleOption(1);
      } else if (key.tab && key.shift) {
        cycleOption(-1);
      } else if (key.rightArrow) {
        cycleOption(1);
      } else if (key.leftArrow) {
        cycleOption(-1);
      } else if (input === " ") {
        // Space: Cycle forward
        cycleOption(1);
      }
    }

    // Enter: Edit for input fields, open Model Browser for model field
    if (key.return) {
      if (fieldMeta.type === "input") {
        const currentValue = config[selectedKey as keyof HqlConfig];
        const valueStr = String(currentValue);
        setEditValue(valueStr);
        setEditCursor(valueStr.length); // Start cursor at end
        setMode("edit");
        setError(null);
      } else if (selectedKey === "model" && onOpenModelBrowser) {
        // Open Model Browser for model selection
        onOpenModelBrowser();
      }
      // For other select fields, Enter does nothing special (Tab/Space to cycle)
    }

    // Escape: Close panel
    if (key.escape) {
      onClose();
    }

    // 'd': Reset selected item to default
    if (input === "d") {
      const defaultValue = DEFAULT_CONFIG[selectedKey as keyof HqlConfig];
      updateConfigRuntime(selectedKey, defaultValue).then(() => {
        setConfig({ ...config, [selectedKey]: defaultValue });
        // Update theme context if resetting theme
        if (selectedKey === "theme") {
          setTheme(defaultValue as ThemeName);
        }
        // Update model info if resetting model
        if (selectedKey === "model") {
          updateModelInfo(String(defaultValue), config.endpoint || DEFAULT_CONFIG.endpoint);
        }
        setError(null);
      }).catch((e) => {
        setError(e instanceof Error ? e.message : "Reset failed");
      });
    }

    // 'r': Reset ALL to defaults
    if (input === "r") {
      resetConfigRuntime().then((newConfig) => {
        setConfig(newConfig);
        setTheme(newConfig.theme as ThemeName);
        updateModelInfo(newConfig.model, newConfig.endpoint || DEFAULT_CONFIG.endpoint);
        setError(null);
      });
    }
  }

  // deno-lint-ignore no-explicit-any
  function handleEditMode(input: string, key: any) {
    // Escape: Cancel edit
    if (key.escape) {
      setMode("navigate");
      setEditValue("");
      setEditCursor(0);
      setError(null);
      return;
    }

    // Enter: Save
    if (key.return) {
      saveValue();
      return;
    }

    // Text editing shortcuts (Ctrl+A/E/W/U/K, word nav, arrows, backspace, typing)
    const result = handleTextEditingKey(input, key, editValue, editCursor);
    if (result) {
      setEditValue(result.value);
      setEditCursor(result.cursor);
    }
  }

  // Cycle through options for select fields
  function cycleOption(direction: number) {
    const options = getOptions();
    if (options.length === 0) return;

    const currentValue = String(config[selectedKey as keyof HqlConfig]);
    const currentIdx = options.indexOf(currentValue);
    let nextIdx: number;

    if (currentIdx === -1) {
      nextIdx = 0;
    } else {
      nextIdx = (currentIdx + direction + options.length) % options.length;
    }

    const newValue = options[nextIdx];
    updateConfigRuntime(selectedKey, newValue).then(() => {
      setConfig({ ...config, [selectedKey]: newValue });
      // Update theme context for immediate UI update
      if (selectedKey === "theme") {
        setTheme(newValue as ThemeName);
      }
      // Fetch model info when model changes
      if (selectedKey === "model") {
        updateModelInfo(newValue, config.endpoint || DEFAULT_CONFIG.endpoint);
      }
    }).catch((e) => {
      setError(e instanceof Error ? e.message : "Update failed");
    });
  }

  // Save text input value
  async function saveValue() {
    let parsedValue: unknown = editValue;

    // Parse based on type
    if (selectedKey === "temperature") {
      parsedValue = parseFloat(editValue);
    } else if (selectedKey === "maxTokens") {
      parsedValue = parseInt(editValue, 10);
    }

    // Validate
    const validation = validateValue(selectedKey, parsedValue);
    if (!validation.valid) {
      setError(validation.error || "Invalid value");
      return;
    }

    // Save
    try {
      await updateConfigRuntime(selectedKey, parsedValue);
      setConfig({ ...config, [selectedKey]: parsedValue });
      setMode("navigate");
      setEditValue("");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  }

  function formatValue(key: ConfigKey, value: unknown): string {
    if (value == null) {
      return String(DEFAULT_CONFIG[key as keyof HqlConfig]);
    }
    if (key === "temperature" && typeof value === "number") {
      return value.toFixed(1);
    }
    return String(value);
  }

  function isDefault(key: ConfigKey): boolean {
    return config[key as keyof HqlConfig] === DEFAULT_CONFIG[key as keyof HqlConfig];
  }

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold> Configuration </Text>
        <Text dimColor>d: default  r: reset all</Text>
      </Box>
      <Text> </Text>

      {CONFIG_KEYS.map((key, i) => {
        const isSelected = i === selectedIndex;
        const isEditing = isSelected && mode === "edit";
        const meta = FIELD_META[key];
        const value = config[key as keyof HqlConfig];
        const defaultMark = isDefault(key) ? " (default)" : "";
        const isSelectType = meta.type === "select";

        // Special handling for model field - show capabilities
        const isModelField = key === "model";
        const capabilityTags = isModelField && modelInfo
          ? formatCapabilityTags(modelInfo.capabilities)
          : "";

        return (
          <Box key={key} paddingLeft={1} flexDirection="column">
            <Box>
              {/* Selection indicator */}
              {isSelected ? (
                <Text color={color("accent")}>{"\u203a"} </Text>
              ) : (
                <Text>  </Text>
              )}

              {/* Label */}
              <Box width={14}>
                <Text bold={isSelected}>{meta.label}</Text>
              </Box>

              {/* Value */}
              <Box width={32}>
                {isEditing ? (
                  <Text>
                    {editValue.slice(0, editCursor)}
                    <Text inverse>{editValue[editCursor] || " "}</Text>
                    {editValue.slice(editCursor + 1)}
                  </Text>
                ) : (
                  <Box>
                    {isSelected && isSelectType && <Text color={color("accent")}>{"\u25c0"} </Text>}
                    <Text color={isSelected ? "white" : "gray"}>
                      {formatValue(key, value)}
                      <Text dimColor>{defaultMark}</Text>
                    </Text>
                    {isSelected && isSelectType && <Text color={color("accent")}> {"\u25b6"}</Text>}
                  </Box>
                )}
              </Box>

              {/* Model field: show capabilities + browse hint on right */}
              {isModelField && isSelected && !isEditing && (
                <>
                  {capabilityTags && <Text color={color("muted")}> {capabilityTags}</Text>}
                  {onOpenModelBrowser && (
                    <Text dimColor> | <Text color={color("accent")}>Enter</Text> browse/download</Text>
                  )}
                </>
              )}
              {isModelField && !isSelected && capabilityTags && (
                <Text color={color("muted")}> {capabilityTags}</Text>
              )}

              {/* Description (for non-model fields) */}
              {isSelected && !isEditing && !isModelField && (
                <Text dimColor> {meta.description}</Text>
              )}
            </Box>

          </Box>
        );
      })}

      <Text> </Text>

      {/* Error display */}
      {error && (
        <Box paddingLeft={1}>
          <Text color={color("error")}>{error}</Text>
        </Box>
      )}

      {/* Help text */}
      <Box paddingLeft={1}>
        {mode === "navigate" ? (
          <Text dimColor>
            {"\u2191\u2193"} Navigate  {fieldMeta.type === "select" ? "Tab/\u2190\u2192 Cycle  " : "Enter Edit  "}Esc Close
          </Text>
        ) : (
          <Text dimColor>
            Type value  Enter Save  Esc Cancel
          </Text>
        )}
      </Box>
    </Box>
  );
}
