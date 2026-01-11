/**
 * useOverlay Hook
 *
 * React hook for managing floating overlays on top of Ink's output.
 * Uses raw ANSI escape codes to draw content at absolute screen positions.
 */

import { useEffect, useCallback, useRef } from "npm:react@18";
import {
  drawOverlay,
  clearOverlay,
  centerOverlay,
  getTerminalSize,
  type OverlayConfig,
  type OverlayLine,
} from "./renderer.ts";

export interface UseOverlayOptions {
  /** Whether the overlay is currently visible */
  visible: boolean;
  /** Width of the overlay (default: 60) */
  width?: number;
  /** Height of the overlay (default: 20) */
  height?: number;
  /** Title shown in the border */
  title?: string;
  /** Footer text */
  footer?: string;
  /** Position: "center" or specific {x, y} */
  position?: "center" | { x: number; y: number };
  /** Border color as hex string (e.g., "#00ff00") or RGB tuple */
  borderColor?: string | [number, number, number];
  /** Background color */
  bgColor?: string | [number, number, number];
}

/**
 * Parse hex color to RGB tuple
 */
function parseColor(color: string | [number, number, number]): [number, number, number] {
  if (Array.isArray(color)) return color;

  // Remove # if present
  const hex = color.replace(/^#/, "");

  // Parse hex
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  return [r || 0, g || 0, b || 0];
}

/**
 * Hook for managing a floating overlay
 */
export function useOverlay(options: UseOverlayOptions) {
  const {
    visible,
    width = 60,
    height = 20,
    title,
    footer,
    position = "center",
    borderColor,
    bgColor,
  } = options;

  // Track the last config for cleanup
  const lastConfigRef = useRef<OverlayConfig | null>(null);

  // Calculate position
  const getPosition = useCallback(() => {
    if (position === "center") {
      return centerOverlay(width, height);
    }
    return position;
  }, [position, width, height]);

  // Build config
  const getConfig = useCallback((): OverlayConfig => {
    const pos = getPosition();
    return {
      x: pos.x,
      y: pos.y,
      width,
      height,
      title,
      borderColor: borderColor ? parseColor(borderColor) : undefined,
      bgColor: bgColor ? parseColor(bgColor) : undefined,
    };
  }, [getPosition, width, height, title, borderColor, bgColor]);

  // Draw function that can be called manually
  const draw = useCallback((lines: OverlayLine[], footerOverride?: string) => {
    if (!visible) return;

    const config = getConfig();
    lastConfigRef.current = config;
    drawOverlay(config, lines, footerOverride ?? footer);
  }, [visible, getConfig, footer]);

  // Clear the overlay
  const clear = useCallback(() => {
    if (lastConfigRef.current) {
      clearOverlay(lastConfigRef.current);
      lastConfigRef.current = null;
    }
  }, []);

  // Cleanup on unmount or when hidden
  useEffect(() => {
    if (!visible && lastConfigRef.current) {
      // Don't clear immediately - let Ink re-render first
      // The overlay area will be repainted by Ink
      lastConfigRef.current = null;
    }

    return () => {
      // Cleanup on unmount
      if (lastConfigRef.current) {
        clearOverlay(lastConfigRef.current);
        lastConfigRef.current = null;
      }
    };
  }, [visible]);

  // Handle terminal resize
  useEffect(() => {
    if (!visible) return;

    const handleResize = () => {
      // Recalculate position on resize
      // The next draw() call will use updated dimensions
    };

    process.stdout.on("resize", handleResize);
    return () => {
      process.stdout.off("resize", handleResize);
    };
  }, [visible]);

  return {
    draw,
    clear,
    getConfig,
    terminalSize: getTerminalSize,
  };
}

/**
 * Convert string content to OverlayLine array
 */
export function textToLines(
  text: string,
  options?: {
    selectedIndex?: number;
    highlightColor?: [number, number, number];
  }
): OverlayLine[] {
  const lines = text.split("\n");
  return lines.map((line, i) => ({
    text: line,
    selected: options?.selectedIndex === i,
    color: options?.highlightColor,
  }));
}
