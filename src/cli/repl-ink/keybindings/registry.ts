/**
 * Keybindings Registry
 *
 * Central registry for all keyboard shortcuts.
 * Single source of truth - used by CommandPalette and /help.
 */

import { fuzzyFilter } from "../../repl/fuzzy.ts";
import type {
  Keybinding,
  KeybindingMatch,
  KeybindingCategory,
} from "./types.ts";
import { CATEGORY_ORDER, getDisplay } from "./types.ts";

// ============================================================
// Registry Class
// ============================================================

/**
 * KeybindingRegistry - central store for all keybindings.
 * Provides search and help text generation.
 */
class KeybindingRegistry {
  private bindings: Keybinding[] = [];
  private byCategory = new Map<KeybindingCategory, Keybinding[]>();

  /**
   * Register a single keybinding.
   */
  register(binding: Keybinding): void {
    this.bindings.push(binding);

    // Index by category
    const cat = this.byCategory.get(binding.category) ?? [];
    cat.push(binding);
    this.byCategory.set(binding.category, cat);
  }

  /**
   * Register multiple keybindings.
   */
  registerAll(bindings: readonly Keybinding[]): void {
    bindings.forEach((b) => this.register(b));
  }

  /**
   * Get all registered keybindings.
   */
  getAll(): readonly Keybinding[] {
    return this.bindings;
  }

  /**
   * Get keybindings grouped by category.
   */
  getByCategory(): ReadonlyMap<KeybindingCategory, readonly Keybinding[]> {
    return this.byCategory;
  }

  /**
   * Get keybindings for a specific category.
   */
  getCategory(category: KeybindingCategory): readonly Keybinding[] {
    return this.byCategory.get(category) ?? [];
  }

  /**
   * Fuzzy search keybindings.
   * Searches label, description, and display string.
   *
   * @param query - Search query (empty returns all)
   * @returns Sorted matches (best first)
   */
  search(query: string): KeybindingMatch[] {
    // Empty query: return all in category order
    if (!query.trim()) {
      const result: KeybindingMatch[] = [];
      for (const category of CATEGORY_ORDER) {
        const items = this.byCategory.get(category) ?? [];
        for (const kb of items) {
          result.push({ keybinding: kb, score: 0, indices: [] });
        }
      }
      return result;
    }

    // Fuzzy filter using existing fuzzy.ts
    const filtered = fuzzyFilter(
      this.bindings,
      query,
      (b) => `${b.label} ${b.description ?? ""} ${getDisplay(b)}`
    );

    return filtered.map((r) => ({
      keybinding: r,
      score: r.matchResult.score,
      indices: r.matchResult.indices,
    }));
  }

  /**
   * Generate help text for /help command.
   * Replaces hardcoded keyboard shortcuts section.
   */
  generateHelpText(): string {
    const sections: string[] = [];

    // Only include certain categories in /help (keep it concise)
    const helpCategories: KeybindingCategory[] = [
      "Global",
      "Editing",
      "Navigation",
      "Paredit",
    ];

    for (const category of helpCategories) {
      const items = this.byCategory.get(category);
      if (!items || items.length === 0) continue;

      const lines = items.map((b) => {
        const display = getDisplay(b);
        return `  ${display.padEnd(14)} ${b.label}`;
      });

      sections.push(`${category}:\n${lines.join("\n")}`);
    }

    return sections.join("\n\n");
  }

  /**
   * Clear all keybindings (for testing).
   */
  clear(): void {
    this.bindings = [];
    this.byCategory.clear();
  }
}

// ============================================================
// Singleton Instance
// ============================================================

/** Global registry instance */
export const registry = new KeybindingRegistry();
