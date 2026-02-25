/**
 * Companion Agent — Rolling Context Buffer
 *
 * Maintains observation history and builds prompt context.
 */

import type { CompanionState, Observation } from "./types.ts";

const DEFAULT_MAX_BUFFER = 20;

export class CompanionContext {
  private buffer: Observation[] = [];
  private maxBuffer: number;
  private state: CompanionState = "idle";
  private activeApp = "";
  private activeWindowTitle = "";
  private recentClipboard = "";
  private lastActivityTs = 0;

  constructor(maxBuffer = DEFAULT_MAX_BUFFER) {
    this.maxBuffer = maxBuffer;
  }

  addBatch(batch: Observation[]): void {
    for (const obs of batch) {
      this.buffer.push(obs);
      this.lastActivityTs = Date.now();

      if (obs.kind === "app.switch") {
        if (typeof obs.data.appName === "string") {
          this.activeApp = obs.data.appName;
        }
      }
      if (
        obs.kind === "ui.window.title.changed" ||
        obs.kind === "ui.window.focused"
      ) {
        if (typeof obs.data.title === "string") {
          this.activeWindowTitle = obs.data.title;
        }
      }
      if (obs.kind === "clipboard.changed") {
        if (typeof obs.data.text === "string") {
          this.recentClipboard = obs.data.text;
        }
      }
    }

    // Cap rolling buffer
    if (this.buffer.length > this.maxBuffer) {
      this.buffer = this.buffer.slice(-this.maxBuffer);
    }
  }

  buildPromptContext(): string {
    const lines: string[] = ["# Companion Context"];
    if (this.activeApp) lines.push(`- Active app: ${this.activeApp}`);
    if (this.activeWindowTitle) {
      lines.push(`- Window title: ${this.activeWindowTitle}`);
    }
    if (this.recentClipboard) {
      lines.push(`- Recent clipboard: ${this.recentClipboard.slice(0, 100)}`);
    }
    lines.push(`- Observation count: ${this.buffer.length}`);

    if (this.buffer.length > 0) {
      lines.push("\n## Recent Observations");
      for (const obs of this.buffer.slice(-5)) {
        lines.push(
          `- [${obs.kind}] ${obs.timestamp} — ${JSON.stringify(obs.data)}`,
        );
      }
    }
    return lines.join("\n");
  }

  setState(s: CompanionState): void {
    this.state = s;
  }

  getState(): CompanionState {
    return this.state;
  }

  isUserActive(quietWindowMs: number): boolean {
    return Date.now() - this.lastActivityTs < quietWindowMs;
  }

  getActiveApp(): string {
    return this.activeApp;
  }

  getActiveWindowTitle(): string {
    return this.activeWindowTitle;
  }

  getBufferSize(): number {
    return this.buffer.length;
  }

  toJSON(): Record<string, unknown> {
    return {
      state: this.state,
      activeApp: this.activeApp,
      activeWindowTitle: this.activeWindowTitle,
      recentClipboard: this.recentClipboard,
      lastActivityTs: this.lastActivityTs,
      bufferSize: this.buffer.length,
    };
  }
}
