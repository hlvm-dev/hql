/**
 * Semantic Color Layer
 *
 * Maps flat ThemePalette (9 colors) → structured semantic tokens.
 * All semantic colors derive from existing palette values — no new colors.
 * Each of the 8 themes automatically gets semantic colors.
 */

import type { ThemePalette } from "./palettes.ts";

// ============================================================
// Types
// ============================================================

/** Structured semantic color tokens for conversation UI */
export interface SemanticColors {
  text: {
    primary: string;
    secondary: string;
    muted: string;
  };
  status: {
    success: string;
    error: string;
    warning: string;
  };
  border: {
    default: string;
    active: string;
    dim: string;
  };
  background: {
    diff: {
      added: string;
      removed: string;
    };
  };
  tool: {
    running: string;
    success: string;
    error: string;
  };
  syntax: {
    keyword: string;
    string: string;
    number: string;
    comment: string;
    function: string;
    operator: string;
    default: string;
  };
}

// ============================================================
// Builder
// ============================================================

/**
 * Build semantic color tokens from a theme palette.
 * Pure function — deterministic mapping from flat palette → structured tokens.
 */
export function buildSemanticColors(palette: ThemePalette): SemanticColors {
  return {
    text: {
      primary: palette.text,
      secondary: palette.muted,
      muted: palette.muted,
    },
    status: {
      success: palette.success,
      error: palette.error,
      warning: palette.warning,
    },
    border: {
      default: palette.muted,
      active: palette.primary,
      dim: palette.muted,
    },
    background: {
      diff: {
        added: palette.success,
        removed: palette.error,
      },
    },
    tool: {
      running: palette.warning,
      success: palette.success,
      error: palette.error,
    },
    syntax: {
      keyword: palette.primary,
      string: palette.secondary,
      number: palette.accent,
      comment: palette.muted,
      function: palette.success,
      operator: palette.accent,
      default: palette.text,
    },
  };
}
