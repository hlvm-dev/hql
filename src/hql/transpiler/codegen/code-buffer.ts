/**
 * CodeBuffer - Structured code emission with source map support.
 *
 * This class encapsulates code generation with automatic position tracking
 * for source map generation. It provides:
 * - Automatic line/column tracking
 * - Source map mapping collection
 * - Original name tracking for rich source maps (superiority feature)
 * - Debug comment generation (superiority feature)
 * - Indent management
 */

import type { SourcePosition } from "../type/hql_ir.ts";

// Re-export for consumers who import from here
export type { SourcePosition };

/**
 * A single source map mapping entry.
 */
export interface SourceMapping {
  generated: { line: number; column: number };
  original: { line: number; column: number } | null;
  source: string | null;
  /** Original identifier name - enables rich debugger experience */
  name: string | null;
}

/**
 * Options for CodeBuffer construction.
 */
export interface CodeBufferOptions {
  /** Source file path for source maps. Defaults to "input.hql" */
  sourceFilePath?: string;
  /** Indentation string. Defaults to "  " (two spaces) */
  indentStr?: string;
  /** Enable debug comments showing HQL origin. Defaults to false */
  debug?: boolean;
}

/**
 * Result of code generation - the code string and source map data.
 */
export interface CodeBufferResult {
  code: string;
  mappings: SourceMapping[];
}

/**
 * Structured code buffer with automatic position tracking.
 *
 * This is the core abstraction for code emission, replacing scattered
 * emit/emitLine/emitIndent calls with a unified buffer API.
 */
export class CodeBuffer {
  private chunks: string[] = [];
  private currentLine: number = 1;
  private currentColumn: number = 0;
  private mappings: SourceMapping[] = [];
  private indentLevel: number = 0;
  private readonly indentStr: string;
  private readonly sourceFilePath: string;
  /** Whether debug comments are enabled (superiority feature) */
  readonly debug: boolean;

  constructor(options: CodeBufferOptions = {}) {
    this.sourceFilePath = options.sourceFilePath || "input.hql";
    this.indentStr = options.indentStr || "  ";
    this.debug = options.debug || false;
  }

  /**
   * Write text to buffer with optional source position and original name.
   *
   * @param text - The text to write
   * @param pos - Optional source position for source map
   * @param name - Optional original name for rich source maps (superiority feature)
   */
  write(text: string, pos?: SourcePosition, name?: string): void {
    // Record mapping if we have a source position
    if (pos && pos.line !== undefined) {
      this.mappings.push({
        generated: { line: this.currentLine, column: this.currentColumn },
        original: { line: pos.line, column: pos.column || 0 },
        source: pos.filePath || this.sourceFilePath,
        name: name ?? null, // Superiority: track original names
      });
    }

    this.updatePosition(text);
    this.chunks.push(text);
  }

  /**
   * Write a line of text with indentation and newline.
   *
   * @param text - Optional text to write (empty for blank line)
   * @param pos - Optional source position for source map
   */
  writeLine(text: string = "", pos?: SourcePosition): void {
    if (text) {
      this.writeIndent();
      this.write(text, pos);
    }
    this.write("\n");
  }

  /**
   * Write the current indentation.
   */
  writeIndent(): void {
    this.write(this.indentStr.repeat(this.indentLevel));
  }

  /**
   * Write items separated by commas.
   *
   * @param items - Array of items to process
   * @param processor - Function to emit each item
   */
  writeCommaSeparated<T>(items: T[], processor: (item: T) => void): void {
    for (let i = 0; i < items.length; i++) {
      if (i > 0) this.write(", ");
      processor(items[i]);
    }
  }

  /**
   * Write debug comment showing HQL origin (superiority feature).
   * Only emits when debug mode is enabled.
   *
   * @param pos - Source position from HQL
   * @param hint - Optional hint text (e.g., "(fn foo ...)")
   */
  writeDebugComment(pos?: SourcePosition, hint?: string): void {
    if (this.debug && pos?.line !== undefined) {
      const comment = hint
        ? `/* HQL:${pos.line} ${hint} */ `
        : `/* HQL:${pos.line} */ `;
      this.write(comment);
    }
  }

  /**
   * Increase indentation level.
   */
  indent(): void {
    this.indentLevel++;
  }

  /**
   * Decrease indentation level.
   */
  dedent(): void {
    this.indentLevel = Math.max(0, this.indentLevel - 1);
  }

  /**
   * Get the current indentation level.
   */
  getIndentLevel(): number {
    return this.indentLevel;
  }

  /**
   * Set the indentation level directly.
   */
  setIndentLevel(level: number): void {
    this.indentLevel = Math.max(0, level);
  }

  /**
   * Update position tracking after writing text.
   * Optimized to avoid character-by-character iteration.
   */
  private updatePosition(text: string): void {
    // Fast path: no newlines (most common case for tokens/identifiers)
    if (!text.includes("\n")) {
      this.currentColumn += text.length;
    } else {
      // Has newlines - split is well-optimized in V8
      const lines = text.split("\n");
      this.currentLine += lines.length - 1;
      this.currentColumn = lines[lines.length - 1].length;
    }
  }

  /**
   * Get the generated code and source mappings.
   */
  getResult(): CodeBufferResult {
    return {
      code: this.chunks.join(""),
      mappings: this.mappings,
    };
  }
}
