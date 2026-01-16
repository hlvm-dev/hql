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

import React, { useState, useEffect, useCallback, useMemo, useRef } from "npm:react@18";
import { useInput } from "npm:ink@5";
import { handleTextEditingKey } from "../utils/text-editing.ts";
import {
  type ConfigKey,
  type HqlConfig,
  CONFIG_KEYS,
  DEFAULT_CONFIG,
  validateValue,
} from "../../../common/config/types.ts";
import { useTheme, THEME_NAMES, type ThemeName } from "../../theme/index.ts";
import {
  fetchModelInfo,
  formatCapabilityTags,
  type ModelInfo,
} from "../utils/model-info.ts";
import {
  clearOverlay,
  getTerminalSize,
  ansi,
  hexToRgb,
} from "../overlay/index.ts";

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
  options?: string[];  // For select type
}

type Mode = "navigate" | "edit";

type RGB = [number, number, number];

// ============================================================
// Layout Constants
// ============================================================

const OVERLAY_WIDTH = 68;
const PADDING = { top: 1, bottom: 1, left: 3, right: 3 };
const HEADER_ROWS = 2;  // Title row + empty row
const CONTENT_START = PADDING.top + HEADER_ROWS;  // 3
const VISIBLE_FIELDS = CONFIG_KEYS.length;  // 5 fields
// Layout: top(1) + header(1) + empty(1) + fields(5) + empty(1) + footer(1) + bottom(1) = 11
const OVERLAY_HEIGHT = PADDING.top + HEADER_ROWS + VISIBLE_FIELDS + 1 + 1 + PADDING.bottom;  // 11
const BG_COLOR: RGB = [35, 35, 40];
const SELECTED_BG_COLOR: RGB = [55, 55, 65];  // Brighter background for selected row

// Cursor blink timing (macOS standard)
const CURSOR_BLINK_MS = 530;

// Shared encoder for terminal output
const encoder = new TextEncoder();

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

// ============================================================
// Helpers
// ============================================================

/** Calculate centered position */
function getOverlayPosition(): { x: number; y: number } {
  const term = getTerminalSize();
  return {
    x: Math.max(2, Math.floor((term.columns - OVERLAY_WIDTH) / 2)),
    y: Math.max(2, Math.floor((term.rows - OVERLAY_HEIGHT) / 2)),
  };
}

/** Create ANSI foreground color string from RGB */
function fg(rgb: RGB): string {
  return ansi.fg(rgb[0], rgb[1], rgb[2]);
}

/** Create ANSI background color string from RGB */
function bg(rgb: RGB): string {
  return ansi.bg(rgb[0], rgb[1], rgb[2]);
}

// ============================================================
// Component
// ============================================================

export function ConfigOverlay({
  onClose,
  onOpenModelBrowser,
  initialState,
  onStateChange,
}: ConfigOverlayProps): React.ReactElement | null {
  const { theme, setTheme } = useTheme();

  // Config state
  const [config, setConfig] = useState<HqlConfig>(DEFAULT_CONFIG);
  const [selectedIndex, setSelectedIndex] = useState(initialState?.selectedIndex ?? 0);
  const [mode, setMode] = useState<Mode>("navigate");
  const [editValue, setEditValue] = useState("");
  const [editCursor, setEditCursor] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [cursorVisible, setCursorVisible] = useState(true);

  // Refs for overlay management
  const overlayPosRef = useRef({ x: 0, y: 0 });
  const isFirstRender = useRef(true);

  // Theme colors (memoized)
  const colors = useMemo(() => ({
    highlight: hexToRgb(theme.warning) as RGB,
    accent: hexToRgb(theme.accent) as RGB,
    primary: hexToRgb(theme.primary) as RGB,
    muted: hexToRgb(theme.muted) as RGB,
    error: hexToRgb(theme.error) as RGB,
    bgStyle: bg(BG_COLOR),
    selectedBgStyle: bg(SELECTED_BG_COLOR),
  }), [theme]);

  // Current field info
  const selectedKey = CONFIG_KEYS[selectedIndex];
  const fieldMeta = FIELD_META[selectedKey];

  // Get options for current field
  const getOptions = useCallback((): string[] => {
    if (selectedKey === "model") {
      return availableModels;
    }
    return FIELD_META[selectedKey].options || [];
  }, [selectedKey, availableModels]);

  // Fetch model info for current model
  const updateModelInfo = useCallback(async (model: string, endpoint: string) => {
    try {
      const info = await fetchModelInfo(endpoint, model);
      setModelInfo(info);
    } catch {
      setModelInfo(null);
    }
  }, []);

  // Fetch available models - 100% SSOT via ai.models API (no fallback)
  const fetchOllamaModels = useCallback(async (_endpoint: string, currentModel: string) => {
    try {
      // 100% SSOT: Use ai.models API only - no direct fetch fallback
      const aiApi = (globalThis as Record<string, unknown>).ai as {
        models: { list: () => Promise<{ name: string }[]> };
      } | undefined;

      if (aiApi?.models?.list) {
        const modelList = await aiApi.models.list();
        const models = modelList.map((m: { name: string }) => `ollama/${m.name}`);
        setAvailableModels(models.length > 0 ? models : [currentModel || DEFAULT_CONFIG.model]);
      } else {
        // API not ready - show current model only (no direct fetch bypass)
        setAvailableModels([currentModel || DEFAULT_CONFIG.model]);
      }
    } catch {
      setAvailableModels([currentModel || DEFAULT_CONFIG.model]);
    }
  }, []);

  // Load config on mount - use config API for single source of truth
  useEffect(() => {
    const configApi = (globalThis as Record<string, unknown>).config as {
      all: Promise<HqlConfig>;
    } | undefined;

    const loadConfigFromApi = async () => {
      const cfg = configApi?.all
        ? await configApi.all
        : DEFAULT_CONFIG;
      setConfig(cfg);
      updateModelInfo(cfg.model, cfg.endpoint || DEFAULT_CONFIG.endpoint);
      fetchOllamaModels(cfg.endpoint || DEFAULT_CONFIG.endpoint, cfg.model);
    };

    loadConfigFromApi();
  }, [updateModelInfo, fetchOllamaModels]);

  // Report state changes for persistence
  useEffect(() => {
    onStateChange?.({ selectedIndex });
  }, [selectedIndex, onStateChange]);

  // Format value for display
  const formatValue = useCallback((key: ConfigKey, value: unknown): string => {
    if (value == null) {
      return String(DEFAULT_CONFIG[key as keyof HqlConfig]);
    }
    if (key === "temperature" && typeof value === "number") {
      return value.toFixed(1);
    }
    return String(value);
  }, []);

  // Check if value is default
  const isDefault = useCallback((key: ConfigKey): boolean => {
    return config[key as keyof HqlConfig] === DEFAULT_CONFIG[key as keyof HqlConfig];
  }, [config]);

  // Cycle through options for select fields - use config API for single source of truth
  const cycleOption = useCallback((direction: number) => {
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
    const configApi = (globalThis as Record<string, unknown>).config as {
      set: (key: string, value: unknown) => Promise<unknown>;
    } | undefined;

    if (configApi?.set) {
      configApi.set(selectedKey, newValue).then(() => {
        setConfig({ ...config, [selectedKey]: newValue });
        if (selectedKey === "theme") {
          setTheme(newValue as ThemeName);
        }
        if (selectedKey === "model") {
          updateModelInfo(newValue, config.endpoint || DEFAULT_CONFIG.endpoint);
        }
      }).catch((e) => {
        setError(e instanceof Error ? e.message : "Update failed");
      });
    }
  }, [selectedKey, config, getOptions, setTheme, updateModelInfo]);

  // Save text input value - use config API for single source of truth
  const saveValue = useCallback(async () => {
    let parsedValue: unknown = editValue;

    if (selectedKey === "temperature") {
      parsedValue = parseFloat(editValue);
    } else if (selectedKey === "maxTokens") {
      parsedValue = parseInt(editValue, 10);
    }

    const validation = validateValue(selectedKey, parsedValue);
    if (!validation.valid) {
      setError(validation.error || "Invalid value");
      return;
    }

    try {
      const configApi = (globalThis as Record<string, unknown>).config as {
        set: (key: string, value: unknown) => Promise<unknown>;
      } | undefined;

      if (configApi?.set) {
        await configApi.set(selectedKey, parsedValue);
        setConfig({ ...config, [selectedKey]: parsedValue });
        setMode("navigate");
        setEditValue("");
        setEditCursor(0);
        setError(null);
      } else {
        setError("Config API not available");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  }, [selectedKey, editValue, config]);

  // Draw full overlay
  const drawOverlay = useCallback(() => {
    const pos = getOverlayPosition();
    overlayPosRef.current = pos;

    const contentWidth = OVERLAY_WIDTH - PADDING.left - PADDING.right;
    const bgStyle = colors.bgStyle;
    let output = ansi.cursorSave + ansi.cursorHide;

    // Helper: draw a full-width row with content left-aligned
    // content is the visible text (without ANSI codes for length calculation)
    // styledContent is the actual output with ANSI styling
    // rowBgStyle is optional - uses default bgStyle if not provided
    const drawRow = (y: number, styledContent: string, visibleLen: number, rowBgStyle?: string) => {
      const bg = rowBgStyle || bgStyle;
      output += ansi.cursorTo(pos.x, y) + bg;
      output += styledContent;
      // Pad to full width
      const padding = OVERLAY_WIDTH - visibleLen;
      if (padding > 0) {
        output += " ".repeat(padding);
      }
    };

    // Helper: draw empty row
    const drawEmptyRow = (y: number) => {
      output += ansi.cursorTo(pos.x, y) + bgStyle + " ".repeat(OVERLAY_WIDTH);
    };

    // === Top padding ===
    for (let i = 0; i < PADDING.top; i++) {
      drawEmptyRow(pos.y + i);
    }

    // === Header row ===
    const headerY = pos.y + PADDING.top;
    const title = "Configuration";
    const hints = "d: default  r: reset all";
    const headerPad = contentWidth - title.length - hints.length;
    const headerContent = " ".repeat(PADDING.left)
      + fg(colors.primary) + ansi.bold + title + ansi.reset + bgStyle
      + " ".repeat(Math.max(1, headerPad))
      + fg(colors.muted) + hints + ansi.reset + bgStyle
      + " ".repeat(PADDING.right);
    const headerVisibleLen = PADDING.left + title.length + Math.max(1, headerPad) + hints.length + PADDING.right;
    drawRow(headerY, headerContent, headerVisibleLen);

    // === Empty row after header ===
    drawEmptyRow(headerY + 1);

    // === Config field rows ===
    for (let i = 0; i < VISIBLE_FIELDS; i++) {
      const rowY = pos.y + CONTENT_START + i;
      const key = CONFIG_KEYS[i];
      const meta = FIELD_META[key];
      const value = config[key as keyof HqlConfig];
      const isSelected = i === selectedIndex;
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
        const displayValue = editValue.slice(0, maxEditWidth);
        const displayCursor = Math.min(editCursor, displayValue.length);

        rowContent += displayValue.slice(0, displayCursor);
        const charAtCursor = displayValue[displayCursor] || " ";
        rowContent += cursorVisible
          ? ansi.inverse + charAtCursor + ansi.reset + rowBg
          : charAtCursor;
        rowContent += displayValue.slice(displayCursor + 1);
        visibleLen += displayValue.length + 1; // +1 for cursor char
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
          const usedWidth = PADDING.left + 14 + (isSelectType ? 4 : 0) + displayValue.length + displayDefault.length;
          const remainingSpace = OVERLAY_WIDTH - usedWidth - PADDING.right - 1;
          if (remainingSpace >= capabilityTags.length + 1) {
            rowContent += " " + fg(colors.muted) + capabilityTags + ansi.reset + rowBg;
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
    const preFooterY = pos.y + CONTENT_START + VISIBLE_FIELDS;
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
      footerText = "\u2191\u2193 Navigate  Tab/\u2190\u2192 Cycle  Esc Close";
      footerColor = colors.muted;
    } else {
      footerText = "\u2191\u2193 Navigate  Enter Edit  Esc Close";
      footerColor = colors.muted;
    }

    const footerContent = " ".repeat(PADDING.left)
      + fg(footerColor) + footerText + ansi.reset + bgStyle
      + " ".repeat(PADDING.right);
    drawRow(footerY, footerContent, PADDING.left + footerText.length + PADDING.right);

    // === Bottom padding ===
    for (let i = 1; i <= PADDING.bottom; i++) {
      drawEmptyRow(footerY + i);
    }

    output += ansi.reset + ansi.cursorRestore + ansi.cursorShow;

    Deno.stdout.writeSync(encoder.encode(output));
  }, [config, selectedIndex, mode, editValue, editCursor, cursorVisible, error, colors, formatValue, isDefault, modelInfo, fieldMeta.type]);

  // Draw cursor only (optimized for blink in edit mode)
  // Uses selectedBgStyle since edit mode is always on the selected row
  const drawCursor = useCallback(() => {
    if (mode !== "edit") return;

    const pos = overlayPosRef.current;
    if (pos.x === 0 && pos.y === 0) return;

    const rowY = pos.y + CONTENT_START + selectedIndex;

    const contentWidth = OVERLAY_WIDTH - PADDING.left - PADDING.right;
    const maxEditWidth = contentWidth - 14 - 2; // label + selection indicator
    const displayValue = editValue.slice(0, maxEditWidth);
    const displayCursor = Math.min(editCursor, displayValue.length);
    const cursorX = pos.x + PADDING.left + 14 + displayCursor; // label width + cursor pos

    const charAtCursor = displayValue[displayCursor] || " ";
    const cursorStyle = cursorVisible
      ? ansi.inverse + charAtCursor + ansi.reset
      : charAtCursor;

    // Use selectedBgStyle - edit mode is always on the selected row
    const output = ansi.cursorSave + ansi.cursorHide
      + ansi.cursorTo(cursorX, rowY)
      + colors.selectedBgStyle + cursorStyle
      + ansi.cursorRestore + ansi.cursorShow;

    Deno.stdout.writeSync(encoder.encode(output));
  }, [mode, selectedIndex, editValue, editCursor, cursorVisible, colors.selectedBgStyle]);

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

  // Clear overlay on unmount
  useEffect(() => {
    return () => {
      const pos = overlayPosRef.current;
      if (pos.x !== 0 || pos.y !== 0) {
        clearOverlay({
          x: pos.x,
          y: pos.y,
          width: OVERLAY_WIDTH,
          height: OVERLAY_HEIGHT,
        });
      }
    };
  }, []);

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
        setSelectedIndex((i: number) => Math.min(CONFIG_KEYS.length - 1, i + 1));
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
          const currentValue = config[selectedKey as keyof HqlConfig];
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
        const defaultValue = DEFAULT_CONFIG[selectedKey as keyof HqlConfig];
        const configApi = (globalThis as Record<string, unknown>).config as {
          set: (key: string, value: unknown) => Promise<unknown>;
        } | undefined;

        if (configApi?.set) {
          configApi.set(selectedKey, defaultValue).then(() => {
            setConfig({ ...config, [selectedKey]: defaultValue });
            if (selectedKey === "theme") {
              setTheme(defaultValue as ThemeName);
            }
            if (selectedKey === "model") {
              updateModelInfo(String(defaultValue), config.endpoint || DEFAULT_CONFIG.endpoint);
            }
            setError(null);
          }).catch((e) => {
            setError(e instanceof Error ? e.message : "Reset failed");
          });
        }
        return;
      }

      // 'r': Reset ALL to defaults - use config API for single source of truth
      if (input === "r") {
        const configApi = (globalThis as Record<string, unknown>).config as {
          reset: () => Promise<HqlConfig>;
        } | undefined;

        if (configApi?.reset) {
          configApi.reset().then((newConfig) => {
            setConfig(newConfig);
            setTheme(newConfig.theme as ThemeName);
            updateModelInfo(newConfig.model, newConfig.endpoint || DEFAULT_CONFIG.endpoint);
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
