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
  surface: {
    userMessage: string;
    modal: {
      border: string;
      borderActive: string;
      background: string;
      selectedBackground: string;
      title: string;
      meta: string;
      section: string;
      footer: string;
      empty: string;
    };
    field: {
      border: string;
      borderActive: string;
      background: string;
      text: string;
      placeholder: string;
      cursor: string;
    };
    inline: {
      border: string;
      selectedBackground: string;
      selectedForeground: string;
      meta: string;
    };
  };
  footer: {
    status: {
      ready: string;
      active: string;
      error: string;
    };
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

/** Blend two hex colors by factor t (0 = a, 1 = b). */
function blendHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bv = Math.round(ab + (bb - ab) * t);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bv.toString(16).padStart(2, "0")}`;
}

/**
 * Build semantic color tokens from a theme palette.
 * Pure function — deterministic mapping from flat palette → structured tokens.
 */
export function buildSemanticColors(palette: ThemePalette): SemanticColors {
  const inlineSelectedForeground = pickReadableForeground(palette.muted, palette);
  const chrome = {
    separator: palette.muted,
    sectionLabel: palette.accent,
    chipNeutral: {
      background: palette.muted,
      foreground: inlineSelectedForeground,
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
        ready: palette.accent,     // Theme-neutral (avoids SICP success gold)
        attention: palette.secondary,  // Theme-neutral (avoids SICP warning gold)
        error: palette.error,      // Red for AI unavailable
      },
    },
    chrome,
    shell: {
      prompt: palette.text,
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
    surface: {
      userMessage: blendHex(palette.bg, palette.text, 0.12),
      modal: {
        border: palette.primary,
        borderActive: palette.accent,
        background: palette.bg,
        selectedBackground: palette.muted,
        title: palette.primary,
        meta: palette.muted,
        section: palette.accent,
        footer: palette.muted,
        empty: palette.muted,
      },
      field: {
        border: palette.muted,
        borderActive: palette.accent,
        background: palette.bg,
        text: palette.text,
        placeholder: palette.muted,
        cursor: palette.text,
      },
      inline: {
        border: palette.muted,
        selectedBackground: palette.muted,
        selectedForeground: inlineSelectedForeground,
        meta: palette.muted,
      },
    },
    footer: {
      status: {
        ready: palette.success,
        active: palette.accent,
        error: palette.error,
      },
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
      keyword: palette.accent,
      string: palette.secondary,
      number: palette.warning,
      comment: palette.muted,
      function: palette.primary,
      operator: palette.text,
      default: palette.text,
    },
  };
}
