/**
 * Unified Completion System - Dropdown Component
 *
 * GENERIC dropdown that renders items via getRenderSpec().
 * No provider-specific logic - all behavior defined by providers.
 */

import React from "npm:react@18";
import { Text, Box } from "npm:ink@5";
import type { CompletionItem, ScrollWindow, ItemRenderSpec } from "./types.ts";

// ============================================================
// Generic Item Rendering
// ============================================================

/**
 * Truncate a label based on the truncation strategy.
 */
function truncateLabel(
  label: string,
  maxWidth: number,
  strategy: "start" | "end" | "none"
): string {
  if (strategy === "none" || label.length <= maxWidth) {
    return label;
  }

  if (strategy === "start") {
    // Truncate from start (show end of path)
    return "…" + label.slice(-(maxWidth - 1));
  }

  // Truncate from end (show start of name)
  return label.slice(0, maxWidth - 1) + "…";
}

interface GenericItemProps {
  /** React key for list rendering */
  readonly key?: string | number;
  /** The render specification for this item */
  readonly spec: ItemRenderSpec;
  /** Whether this item is selected */
  readonly isSelected: boolean;
}

/**
 * Generic item renderer - uses ItemRenderSpec to display any completion item.
 */
function GenericItem({ spec, isSelected }: GenericItemProps): React.ReactElement {
  const label = truncateLabel(spec.label, spec.maxWidth, spec.truncate);

  return (
    <Box>
      <Text color={isSelected ? "cyan" : undefined} inverse={isSelected}>
        {spec.icon} {label}
      </Text>
      {spec.description && <Text dimColor> {spec.description}</Text>}
      {spec.typeLabel && <Text color="gray"> {spec.typeLabel}</Text>}
    </Box>
  );
}

// ============================================================
// Dropdown Component
// ============================================================

interface DropdownProps {
  /** Items to display (full list, will be virtualized) */
  readonly items: readonly CompletionItem[];
  /** Currently selected index (-1 for none) */
  readonly selectedIndex: number;
  /** Scroll window for virtualization */
  readonly scrollWindow: ScrollWindow;
  /** Whether there are items above the visible window */
  readonly hasMoreAbove: boolean;
  /** Whether there are items below the visible window */
  readonly hasMoreBelow: boolean;
  /** Help text to display (from provider) */
  readonly helpText: string;
  /** Whether the dropdown is loading */
  readonly isLoading: boolean;
  /** Margin from left edge */
  readonly marginLeft?: number;
}

/**
 * Dropdown component for displaying completion suggestions.
 *
 * FULLY GENERIC - no provider-specific logic.
 * Each item defines its own rendering via getRenderSpec().
 *
 * Features:
 * - Virtualized rendering (only visible items rendered)
 * - Scroll indicators (↑↓) for large lists
 * - Loading state display
 * - Customizable help text
 */
export function Dropdown({
  items,
  selectedIndex,
  scrollWindow,
  hasMoreAbove,
  hasMoreBelow,
  helpText,
  isLoading,
  marginLeft = 5,
}: DropdownProps): React.ReactElement | null {
  // Don't render if no items and not loading
  if (items.length === 0 && !isLoading) {
    return null;
  }

  // Get visible items from scroll window
  const visibleItems = items.slice(scrollWindow.start, scrollWindow.end);

  return (
    <Box flexDirection="column" marginLeft={marginLeft}>
      {/* Loading indicator */}
      {isLoading && items.length === 0 && (
        <Text dimColor>Searching...</Text>
      )}

      {/* Scroll up indicator */}
      {hasMoreAbove && (
        <Text dimColor>  ↑ more</Text>
      )}

      {/* Visible items - GENERIC rendering via getRenderSpec() */}
      {visibleItems.map((item, i) => {
        const isSelected = scrollWindow.start + i === selectedIndex;
        const spec = item.getRenderSpec();
        return <GenericItem key={item.id} spec={spec} isSelected={isSelected} />;
      })}

      {/* Scroll down indicator */}
      {hasMoreBelow && (
        <Text dimColor>  ↓ more</Text>
      )}

      {/* Help hint from provider */}
      {items.length > 0 && (
        <Text dimColor>  {helpText}</Text>
      )}
    </Box>
  );
}

// ============================================================
// Exports
// ============================================================

export { GenericItem };
export type { DropdownProps, GenericItemProps };
