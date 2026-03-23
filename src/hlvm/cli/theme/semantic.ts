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
  banner: {
    logoStart: string;
    logoMiddle: string;
    logoEnd: string;
    meta: string;
    bullet: string;
    status: {
      ready: string;
      attention: string;
      error: string;
    };
  };
  chrome: {
    separator: string;
    sectionLabel: string;
    chipNeutral: {
      background: string;
      foreground: string;
    };
    chipActive: {
      background: string;
      foreground: string;
    };
    chipSuccess: {
      background: string;
      foreground: string;
    };
    chipWarning: {
      background: string;
      foreground: string;
    };
    chipError: {
      background: string;
      foreground: string;
    };
  };
  shell: {
    prompt: string;
    separator: string;
    queueHint: string;
    chipNeutral: {
      background: string;
      foreground: string;
    };
    chipActive: {
      background: string;
      foreground: string;
    };
    chipWarning: {
      background: string;
      foreground: string;
    };
  };
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

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace(/^#/, "");
  return [
    parseInt(clean.slice(0, 2), 16) || 0,
    parseInt(clean.slice(2, 4), 16) || 0,
    parseInt(clean.slice(4, 6), 16) || 0,
  ];
}

function toLinearChannel(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function getRelativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * toLinearChannel(r) +
    0.7152 * toLinearChannel(g) +
    0.0722 * toLinearChannel(b);
}

function getContrastRatio(a: string, b: string): number {
  const lighter = Math.max(getRelativeLuminance(a), getRelativeLuminance(b));
  const darker = Math.min(getRelativeLuminance(a), getRelativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

function pickReadableForeground(
  background: string,
  palette: ThemePalette,
): string {
  return getContrastRatio(background, palette.text) >=
      getContrastRatio(background, palette.bg)
    ? palette.text
    : palette.bg;
}

/**
 * Build semantic color tokens from a theme palette.
 * Pure function — deterministic mapping from flat palette → structured tokens.
 */
export function buildSemanticColors(palette: ThemePalette): SemanticColors {
  const chrome = {
    separator: palette.muted,
    sectionLabel: palette.accent,
    chipNeutral: {
      background: palette.muted,
      foreground: pickReadableForeground(palette.muted, palette),
    },
    chipActive: {
      background: palette.accent,
      foreground: pickReadableForeground(palette.accent, palette),
    },
    chipSuccess: {
      background: palette.success,
      foreground: pickReadableForeground(palette.success, palette),
    },
    chipWarning: {
      background: palette.warning,
      foreground: pickReadableForeground(palette.warning, palette),
    },
    chipError: {
      background: palette.error,
      foreground: pickReadableForeground(palette.error, palette),
    },
  } as const;

  return {
    banner: {
      logoStart: palette.primary,
      logoMiddle: palette.secondary,
      logoEnd: palette.accent,
      meta: palette.text,
      bullet: palette.secondary,
      status: {
        ready: palette.success,  // Green for AI available
        attention: palette.warning,  // Yellow for setup required
        error: palette.error,  // Red for AI unavailable
      },
    },
    chrome,
    shell: {
      prompt: palette.primary,
      separator: chrome.separator,
      queueHint: palette.muted,
      chipNeutral: chrome.chipNeutral,
      chipActive: chrome.chipActive,
      chipWarning: chrome.chipWarning,
    },
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
      string: palette.success,
      number: palette.warning,
      comment: palette.muted,
      function: palette.primary,
      operator: palette.text,
      default: palette.text,
    },
  };
}
