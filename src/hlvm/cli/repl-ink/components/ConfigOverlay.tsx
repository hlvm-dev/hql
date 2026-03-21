/**
 * Config Overlay Component
 * Floating overlay for config editing (migrated from ConfigPanel)
 *
 * Uses raw ANSI escape codes for true floating overlay behavior,
 * following the same pattern as CommandPaletteOverlay.
 *
 * UX:
 * - Up/Down: Navigate between settings
 * - Tab/Shift+Tab or Left/Right: Cycle options (for select fields)
 * - Enter: Edit text fields or open Model Browser
 * - Space: Cycle options (for select fields)
 * - Esc: Close overlay or cancel edit
 * - d: Reset selected field to default
 * - r: Reset all to defaults
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useInput, useStdout } from "ink";
import { calculateScrollWindow } from "../completion/navigation.ts";
import { handleTextEditingKey } from "../utils/text-editing.ts";
import {
  type ConfigKey,
  DEFAULT_CONFIG,
  type HlvmConfig,
  normalizeModelId,
  PERMISSION_MODES,
  validateValue,
} from "../../../../common/config/types.ts";
import {
  buildSelectedModelConfigUpdates,
  persistSelectedModelConfig,
} from "../../../../common/config/model-selection.ts";
import { THEME_NAMES, type ThemeName, useTheme } from "../../theme/index.ts";
import {
  fetchModelInfo,
  formatCapabilityTags,
  type ModelInfo,
} from "../utils/model-info.ts";
import {
  getRuntimeConfigApi,
  listRuntimeInstalledModels,
  type RuntimeConfigApi,
} from "../../../runtime/host-client.ts";
import {
  ansi,
  bg,
  clearOverlay,
  CONFIG_OVERLAY_SPEC,
  drawOverlayFrame,
  fg,
  OVERLAY_BG_COLOR,
  resolveOverlayChromeLayout,
  resolveOverlayFrame,
  type RGB,
  shouldClearOverlay,
  themeToOverlayColors,
  writeToTerminal,
} from "../overlay/index.ts";
import { CURSOR_BLINK_MS } from "../ui-constants.ts";
import { buildCursorWindowDisplay } from "../utils/cursor-window.ts";
import { getErrorMessage } from "../../../../common/utils.ts";

// ============================================================
// Types
// ============================================================

/** Persistent overlay state that survives open/close */
export interface ConfigOverlayState {
  selectedIndex: number;
}

interface ConfigOverlayProps {
  onClose: () => void;
  /** Callback to open Model Browser panel */
  onOpenModelBrowser?: () => void;
  /** Called when effective config changes */
  onConfigChange?: (config: HlvmConfig) => void;
  /** Initial state from previous session */
  initialState?: ConfigOverlayState;
  /** Called when state changes (for persistence) */
  onStateChange?: (state: ConfigOverlayState) => void;
}

// Field type determines UX
type FieldType = "select" | "input";

interface FieldMeta {
  label: string;
  description: string;
  type: FieldType;
  options?: string[]; // For select type
}

type Mode = "navigate" | "edit";
type EditableConfigKey =
  | "model"
  | "endpoint"
  | "temperature"
  | "maxTokens"
  | "theme"
  | "sessionMemory"
  | "permissionMode";

// ============================================================
// Layout Constants
// ============================================================

const PADDING = CONFIG_OVERLAY_SPEC.padding;
const OVERLAY_CONFIG_KEYS: readonly EditableConfigKey[] = [
  "model",
  "endpoint",
  "temperature",
  "maxTokens",
  "theme",
  "sessionMemory",
  "permissionMode",
];
const OVERLAY_HEIGHT = CONFIG_OVERLAY_SPEC.height;
const SELECTED_BG_COLOR: RGB = [55, 55, 65];

// Config field metadata
const FIELD_META: Record<EditableConfigKey, FieldMeta> = {
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
  sessionMemory: {
    label: "Session Mem",
    description: "Remember context",
    type: "select",
    options: ["true", "false"],
  },
  permissionMode: {
    label: "Permission",
    description: "Tool approval mode",
    type: "select",
    options: PERMISSION_MODES,
  },
};

const OVERLAY_FALLBACK_VALUES: Record<EditableConfigKey, string> = {
  model: DEFAULT_CONFIG.model,
  endpoint: DEFAULT_CONFIG.endpoint,
  temperature: String(DEFAULT_CONFIG.temperature),
  maxTokens: String(DEFAULT_CONFIG.maxTokens),
  theme: DEFAULT_CONFIG.theme,
  sessionMemory: "true",
  permissionMode: "default",
};

function clampSelectedIndex(index: number): number {
  if (index < 0) return 0;
  if (index >= OVERLAY_CONFIG_KEYS.length) {
    return OVERLAY_CONFIG_KEYS.length - 1;
  }
  return index;
}

function parseOptionValue(key: EditableConfigKey, value: string): unknown {
  if (key === "sessionMemory") return value === "true";
  return value;
}

// ============================================================
// Helpers
// ============================================================

/** Runtime-host-backed config accessor for shell overlays. */
function getConfigApi(): RuntimeConfigApi {
  return getRuntimeConfigApi();
}

// ============================================================
// Component
// ============================================================

export function ConfigOverlay({
  onClose,
  onOpenModelBrowser,
  onConfigChange,
  initialState,
  onStateChange,
}: ConfigOverlayProps): React.ReactElement | null {
  const { theme, setTheme } = useTheme();
  const { stdout } = useStdout();

  // Config state
  const [config, setConfig] = useState<HlvmConfig>(DEFAULT_CONFIG);
  const [selectedIndex, setSelectedIndex] = useState(
    clampSelectedIndex(initialState?.selectedIndex ?? 0),
  );
  const [mode, setMode] = useState<Mode>("navigate");
  const [editValue, setEditValue] = useState("");
  const [editCursor, setEditCursor] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [cursorVisible, setCursorVisible] = useState(true);

  // Refs for overlay management
  const previousFrameRef = useRef<
    {
      x: number;
      y: number;
      width: number;
      height: number;
    } | null
  >(null);
  const isFirstRender = useRef(true);
  const terminalColumns = stdout?.columns ?? 0;
  const terminalRows = stdout?.rows ?? 0;
  const overlayFrame = useMemo(
    () =>
      resolveOverlayFrame(CONFIG_OVERLAY_SPEC.width, OVERLAY_HEIGHT, {
        minWidth: CONFIG_OVERLAY_SPEC.minWidth,
        minHeight: CONFIG_OVERLAY_SPEC.minHeight,
      }),
    [terminalColumns, terminalRows],
  );
  const chromeLayout = useMemo(
    () => resolveOverlayChromeLayout(overlayFrame.height, CONFIG_OVERLAY_SPEC),
    [overlayFrame.height],
  );
  const contentWidth = Math.max(
    18,
    overlayFrame.width - PADDING.left - PADDING.right,
  );
  const visibleFieldCount = Math.max(
    2,
    chromeLayout.visibleRows - 1,
  );
  const visibleWindow = useMemo(
    () =>
      calculateScrollWindow(
        selectedIndex,
        OVERLAY_CONFIG_KEYS.length,
        visibleFieldCount,
      ),
    [selectedIndex, visibleFieldCount],
  );

  // Theme colors (memoized)
  const colors = useMemo(() => {
    const c = themeToOverlayColors(theme);
    return {
      highlight: c.warning,
      accent: c.accent,
      primary: c.primary,
      muted: c.muted,
      error: c.error,
      bgStyle: bg(OVERLAY_BG_COLOR),
      selectedBgStyle: bg(SELECTED_BG_COLOR),
    };
  }, [theme]);

  // Current field info
  const selectedKey = OVERLAY_CONFIG_KEYS[selectedIndex];
  const fieldMeta = FIELD_META[selectedKey];

  // Get options for current field
  const getOptions = useCallback((): string[] => {
    if (selectedKey === "model") {
      return availableModels;
    }
    return FIELD_META[selectedKey].options || [];
  }, [selectedKey, availableModels]);

  // Fetch model info for current model
  const updateModelInfo = useCallback(async (model: string) => {
    try {
      const info = await fetchModelInfo(model);
      setModelInfo(info);
    } catch {
      setModelInfo(null);
    }
  }, []);

  // Fetch available models through the runtime host boundary.
  const fetchOllamaModels = useCallback(async (currentModel: string) => {
    try {
      const modelList = await listRuntimeInstalledModels("ollama");
      const models = modelList
        .map((m) => normalizeModelId(m.name))
        .filter((model): model is string => typeof model === "string");
      setAvailableModels(
        models.length > 0 ? models : [currentModel || DEFAULT_CONFIG.model],
      );
    } catch {
      setAvailableModels([currentModel || DEFAULT_CONFIG.model]);
    }
  }, []);

  const applyModelSelection = useCallback(async (modelName: string) => {
    const configApi = getConfigApi();
    const updates = buildSelectedModelConfigUpdates(modelName);
    const normalized = await persistSelectedModelConfig(configApi, modelName);
    setConfig((prev: HlvmConfig) => ({
      ...prev,
      ...updates,
      model: normalized,
    }));
    updateModelInfo(normalized);
    setError(null);
  }, [updateModelInfo]);

  // Load config on mount - use config API for single source of truth
  useEffect(() => {
    const configApi = getConfigApi();

    const loadConfigFromApi = async () => {
      const cfg = configApi?.all ? await configApi.all : DEFAULT_CONFIG;
      setConfig(cfg);
      updateModelInfo(cfg.model);
      fetchOllamaModels(cfg.model);
    };

    loadConfigFromApi();
  }, [updateModelInfo, fetchOllamaModels]);

  // Report state changes for persistence
  useEffect(() => {
    onStateChange?.({ selectedIndex });
  }, [selectedIndex, onStateChange]);

  useEffect(() => {
    onConfigChange?.(config);
  }, [config, onConfigChange]);

  // Format value for display
  const formatValue = useCallback(
    (key: EditableConfigKey, value: unknown): string => {
      if (value == null) {
        return OVERLAY_FALLBACK_VALUES[key];
      }
      if (key === "temperature" && typeof value === "number") {
        return value.toFixed(1);
      }
      return String(value);
    },
    [],
  );

  // Check if value is default
  const isDefault = useCallback((key: EditableConfigKey): boolean => {
    return config[key as keyof HlvmConfig] ===
      DEFAULT_CONFIG[key as keyof HlvmConfig];
  }, [config]);

  // Cycle through options for select fields - use config API for single source of truth
  const cycleOption = useCallback((direction: number) => {
    const options = getOptions();
    if (options.length === 0) return;

    const currentValue = formatValue(
      selectedKey,
      config[selectedKey as keyof HlvmConfig],
    );
    const currentIdx = options.indexOf(currentValue);
    let nextIdx: number;

    if (currentIdx === -1) {
      nextIdx = 0;
    } else {
      nextIdx = (currentIdx + direction + options.length) % options.length;
    }

    const newValue = parseOptionValue(selectedKey, options[nextIdx]);
    const configApi = getConfigApi();

    if (selectedKey === "model") {
      applyModelSelection(String(newValue)).catch((e: unknown) => {
        setError(getErrorMessage(e));
      });
      return;
    }

    if (configApi?.set) {
      configApi.set(selectedKey, newValue).then(() => {
        setConfig((prev: HlvmConfig) => ({ ...prev, [selectedKey]: newValue }));
        if (selectedKey === "theme") {
          setTheme(newValue as ThemeName);
        }
      }).catch((e) => {
        setError(getErrorMessage(e));
      });
    }
  }, [selectedKey, getOptions, setTheme, formatValue, applyModelSelection]);

  // Save text input value - use config API for single source of truth
  const saveValue = useCallback(async () => {
    let parsedValue: unknown = editValue;

    if (selectedKey === "temperature") {
      parsedValue = parseFloat(editValue);
    } else if (selectedKey === "maxTokens") {
      parsedValue = parseInt(editValue, 10);
    }

    const validation = validateValue(selectedKey as ConfigKey, parsedValue);
    if (!validation.valid) {
      setError(validation.error || "Invalid value");
      return;
    }

    try {
      const configApi = getConfigApi();

      if (configApi?.set) {
        await configApi.set(selectedKey, parsedValue);
        setConfig((prev: HlvmConfig) => ({
          ...prev,
          [selectedKey]: parsedValue,
        }));
        setMode("navigate");
        setEditValue("");
        setEditCursor(0);
        setError(null);
      } else {
        setError("Config API not available");
      }
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }, [selectedKey, editValue, config]);

  // Draw full overlay
  const drawOverlay = useCallback(() => {
    if (shouldClearOverlay(previousFrameRef.current, overlayFrame)) {
      clearOverlay(previousFrameRef.current!);
    }
    previousFrameRef.current = overlayFrame;
    const bgStyle = colors.bgStyle;
    let output = ansi.cursorSave + ansi.cursorHide;

    // Helper: draw a full-width row with content left-aligned
    // content is the visible text (without ANSI codes for length calculation)
    // styledContent is the actual output with ANSI styling
    // rowBgStyle is optional - uses default bgStyle if not provided
    const drawRow = (
      y: number,
      styledContent: string,
      visibleLen: number,
      rowBgStyle?: string,
    ) => {
      const bg = rowBgStyle || bgStyle;
      output += ansi.cursorTo(overlayFrame.x, y) + bg;
      output += styledContent;
      // Pad to full width
      const padding = overlayFrame.width - visibleLen;
      if (padding > 0) {
        output += " ".repeat(padding);
      }
    };

    // Helper: draw empty row
    const drawEmptyRow = (y: number) => {
      output += ansi.cursorTo(overlayFrame.x, y) + bgStyle +
        " ".repeat(overlayFrame.width);
    };

    // === Top padding ===
    for (let i = 0; i < PADDING.top; i++) {
      drawEmptyRow(overlayFrame.y + i);
    }

    const headerY = overlayFrame.y + PADDING.top;
    drawEmptyRow(headerY);

    // === Config field rows ===
    for (let i = 0; i < visibleFieldCount; i++) {
      const rowY = overlayFrame.y + chromeLayout.contentStart + i;
      const key = OVERLAY_CONFIG_KEYS[visibleWindow.start + i];
      if (!key) {
        drawEmptyRow(rowY);
        continue;
      }
      const meta = FIELD_META[key];
      const value = config[key as keyof HlvmConfig];
      const actualIndex = visibleWindow.start + i;
      const isSelected = actualIndex === selectedIndex;
      const isEditing = isSelected && mode === "edit";
      const defaultMark = isDefault(key) ? " (default)" : "";
      const isSelectType = meta.type === "select";
      const isModelField = key === "model";
      const capabilityTags = isModelField && modelInfo
        ? formatCapabilityTags(modelInfo.capabilities)
        : "";

      // Use selected background for highlighted row
      const rowBg = isSelected ? colors.selectedBgStyle : bgStyle;

      let rowContent = "";
      let visibleLen = 0;

      // Left padding + selection indicator (PADDING.left chars total)
      rowContent += " ".repeat(PADDING.left - 2);
      visibleLen += PADDING.left - 2;

      if (isSelected) {
        rowContent += fg(colors.accent) + "\u203a " + ansi.reset + rowBg;
      } else {
        rowContent += "  ";
      }
      visibleLen += 2;

      // Label (14 chars fixed width)
      const label = meta.label.padEnd(14).slice(0, 14);
      if (isSelected) {
        rowContent += ansi.bold + label + ansi.reset + rowBg;
      } else {
        rowContent += label;
      }
      visibleLen += 14;

      // Value area
      if (isEditing) {
        // Edit mode: show editable value with cursor
        const maxEditWidth = contentWidth - 14 - 2; // Remaining space after label
        const display = buildCursorWindowDisplay(
          editValue,
          editCursor,
          maxEditWidth,
        );

        rowContent += display.beforeCursor;
        rowContent += cursorVisible
          ? ansi.inverse + display.cursorChar + ansi.reset + rowBg
          : display.cursorChar;
        rowContent += display.afterCursor;
        visibleLen += display.renderWidth;
      } else {
        // Navigate mode
        const formattedValue = formatValue(key, value);

        // Left arrow for select fields
        if (isSelected && isSelectType) {
          rowContent += fg(colors.accent) + "\u25c0 " + ansi.reset + rowBg;
          visibleLen += 2;
        }

        // Value + default mark
        const maxValueLen = isSelectType ? 24 : 26;
        const displayValue = formattedValue.slice(0, maxValueLen);
        rowContent += displayValue;
        visibleLen += displayValue.length;

        const displayDefault = defaultMark.slice(0, 10);
        rowContent += fg(colors.muted) + displayDefault + ansi.reset + rowBg;
        visibleLen += displayDefault.length;

        // Right arrow for select fields
        if (isSelected && isSelectType) {
          rowContent += fg(colors.accent) + " \u25b6" + ansi.reset + rowBg;
          visibleLen += 2;
        }

        // Capability tags for model field (if there's room)
        if (isModelField && capabilityTags) {
          const usedWidth = PADDING.left + 14 + (isSelectType ? 4 : 0) +
            displayValue.length + displayDefault.length;
          const remainingSpace = overlayFrame.width - usedWidth -
            PADDING.right - 1;
          if (remainingSpace >= capabilityTags.length + 1) {
            rowContent += " " + fg(colors.muted) + capabilityTags + ansi.reset +
              rowBg;
            visibleLen += 1 + capabilityTags.length;
          }
        }
      }

      // Right padding
      rowContent += " ".repeat(PADDING.right);
      visibleLen += PADDING.right;

      drawRow(rowY, rowContent, visibleLen, rowBg);
    }

    // === Empty row before footer ===
    const preFooterY = overlayFrame.y + chromeLayout.contentStart +
      visibleFieldCount;
    drawEmptyRow(preFooterY);

    // === Footer row (shows error if any, otherwise hints) ===
    const footerY = preFooterY + 1;
    let footerText: string;
    let footerColor: RGB;

    if (error) {
      footerText = error.slice(0, contentWidth);
      footerColor = colors.error;
    } else if (mode === "edit") {
      footerText = "Type value  Enter Save  Esc Cancel";
      footerColor = colors.muted;
    } else if (fieldMeta.type === "select") {
      footerText =
        "\u2191\u2193 Navigate  Tab/\u2190\u2192 Cycle  d Default  r Reset";
      footerColor = colors.muted;
    } else {
      footerText = "\u2191\u2193 Navigate  Enter Edit  d Default  r Reset";
      footerColor = colors.muted;
    }
    const footerCount = OVERLAY_CONFIG_KEYS.length > visibleFieldCount
      ? ` ${selectedIndex + 1}/${OVERLAY_CONFIG_KEYS.length}`
      : "";
    const footerDisplay = (footerText + footerCount).slice(0, contentWidth);

    const footerContent = " ".repeat(PADDING.left) +
      fg(footerColor) + footerDisplay + ansi.reset + bgStyle +
      " ".repeat(PADDING.right);
    drawRow(
      footerY,
      footerContent,
      PADDING.left + footerDisplay.length + PADDING.right,
    );

    // === Bottom padding ===
    for (let i = 1; i <= PADDING.bottom; i++) {
      drawEmptyRow(footerY + i);
    }

    output += drawOverlayFrame(overlayFrame, {
      borderColor: colors.primary,
      backgroundColor: OVERLAY_BG_COLOR,
      title: "Configuration",
      rightText: "esc close",
    });
    output += ansi.reset + ansi.cursorRestore + ansi.cursorShow;

    writeToTerminal(output);
  }, [
    config,
    selectedIndex,
    mode,
    editValue,
    editCursor,
    cursorVisible,
    error,
    colors,
    formatValue,
    isDefault,
    modelInfo,
    fieldMeta.type,
    contentWidth,
    chromeLayout.contentStart,
    overlayFrame,
    selectedIndex,
    visibleFieldCount,
    visibleWindow.start,
  ]);

  // Draw cursor only (optimized for blink in edit mode)
  // Uses selectedBgStyle since edit mode is always on the selected row
  const drawCursor = useCallback(() => {
    if (mode !== "edit") return;
    const selectedRow = selectedIndex - visibleWindow.start;
    if (selectedRow < 0 || selectedRow >= visibleFieldCount) return;
    const rowY = overlayFrame.y + chromeLayout.contentStart + selectedRow;
    const maxEditWidth = contentWidth - 14 - 2; // label + selection indicator
    const display = buildCursorWindowDisplay(
      editValue,
      editCursor,
      maxEditWidth,
    );
    const cursorX = overlayFrame.x + PADDING.left + 14 +
      display.beforeCursor.length;

    const cursorStyle = cursorVisible
      ? ansi.inverse + display.cursorChar + ansi.reset
      : display.cursorChar;

    // Use selectedBgStyle - edit mode is always on the selected row
    const output = ansi.cursorSave + ansi.cursorHide +
      ansi.cursorTo(cursorX, rowY) +
      colors.selectedBgStyle + cursorStyle +
      ansi.cursorRestore + ansi.cursorShow;

    writeToTerminal(output);
  }, [
    mode,
    selectedIndex,
    editValue,
    editCursor,
    cursorVisible,
    colors.selectedBgStyle,
    contentWidth,
    chromeLayout.contentStart,
    overlayFrame,
    visibleFieldCount,
    visibleWindow.start,
  ]);

  // Cursor blink effect
  useEffect(() => {
    const interval = setInterval(() => {
      setCursorVisible((v: boolean) => !v);
    }, CURSOR_BLINK_MS);
    return () => clearInterval(interval);
  }, []);

  // Cursor-only redraw on blink (edit mode only)
  useEffect(() => {
    if (isFirstRender.current) return;
    if (mode === "edit") {
      drawCursor();
    }
  }, [cursorVisible, drawCursor, mode]);

  // Full overlay draw on content changes
  useEffect(() => {
    drawOverlay();
    isFirstRender.current = false;
  }, [drawOverlay]);

  // Reset cursor visibility when typing
  useEffect(() => {
    setCursorVisible(true);
  }, [editValue]);

  // Keyboard handling
  useInput((input, key) => {
    if (mode === "navigate") {
      // === NAVIGATE MODE ===

      // Up/Down: Navigate between fields
      if (key.upArrow) {
        setSelectedIndex((i: number) => Math.max(0, i - 1));
        setError(null);
        return;
      }
      if (key.downArrow) {
        setSelectedIndex((i: number) =>
          Math.min(OVERLAY_CONFIG_KEYS.length - 1, i + 1)
        );
        setError(null);
        return;
      }
      if (key.pageUp) {
        setSelectedIndex((i: number) => Math.max(0, i - visibleFieldCount));
        setError(null);
        return;
      }
      if (key.pageDown) {
        setSelectedIndex((i: number) =>
          Math.min(OVERLAY_CONFIG_KEYS.length - 1, i + visibleFieldCount)
        );
        setError(null);
        return;
      }

      const isSelectField = fieldMeta.type === "select";
      const options = getOptions();

      // Tab/Left/Right: Cycle options for select fields
      if (isSelectField && options.length > 0) {
        if (key.tab && !key.shift) {
          cycleOption(1);
          return;
        }
        if (key.tab && key.shift) {
          cycleOption(-1);
          return;
        }
        if (key.rightArrow) {
          cycleOption(1);
          return;
        }
        if (key.leftArrow) {
          cycleOption(-1);
          return;
        }
        if (input === " ") {
          cycleOption(1);
          return;
        }
      }

      // Enter: Edit for input fields, open Model Browser for model field
      if (key.return) {
        if (fieldMeta.type === "input") {
          const currentValue = config[selectedKey as keyof HlvmConfig];
          const valueStr = String(currentValue);
          setEditValue(valueStr);
          setEditCursor(valueStr.length);
          setMode("edit");
          setError(null);
          return;
        }
        if (selectedKey === "model" && onOpenModelBrowser) {
          onOpenModelBrowser();
          return;
        }
      }

      // Escape: Close overlay
      if (key.escape) {
        onClose();
        return;
      }

      // 'd': Reset selected field to default - use config API for single source of truth
      if (input === "d") {
        const defaultValue = DEFAULT_CONFIG[selectedKey as keyof HlvmConfig];
        const configApi = getConfigApi();

        if (selectedKey === "model") {
          applyModelSelection(String(defaultValue)).catch((e: unknown) => {
            setError(getErrorMessage(e));
          });
          return;
        }

        if (configApi?.set) {
          configApi.set(selectedKey, defaultValue).then(() => {
            setConfig((prev: HlvmConfig) => ({
              ...prev,
              [selectedKey]: defaultValue,
            }));
            if (selectedKey === "theme") {
              setTheme(defaultValue as ThemeName);
            }
            setError(null);
          }).catch((e) => {
            setError(getErrorMessage(e));
          });
        }
        return;
      }

      // 'r': Reset ALL to defaults - use config API for single source of truth
      if (input === "r") {
        const configApi = getConfigApi();

        if (configApi?.reset) {
          configApi.reset().then((newConfig) => {
            setConfig(newConfig);
            setTheme(newConfig.theme as ThemeName);
            updateModelInfo(newConfig.model);
            setError(null);
          });
        }
        return;
      }
    } else {
      // === EDIT MODE ===

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

      // Text editing shortcuts
      const result = handleTextEditingKey(input, key, editValue, editCursor);
      if (result) {
        setEditValue(result.value);
        setEditCursor(result.cursor);
      }
    }
  });

  return null;
}
