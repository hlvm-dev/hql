/**
 * Agent Metrics - Structured local metrics/events
 *
 * Provides a lightweight event stream for core engine observability.
 * Metrics are local-only (no remote dependencies).
 */

import { appendJsonLine } from "../../common/jsonl.ts";

interface MetricEvent {
  ts: number;
  type: string;
  data: Record<string, unknown>;
}

export interface MetricsSink {
  emit(event: MetricEvent): void | Promise<void>;
}

export class InMemoryMetrics implements MetricsSink {
  private events: MetricEvent[] = [];

  emit(event: MetricEvent): void {
    this.events.push(event);
  }

  getEvents(): MetricEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }
}

/**
 * JSONL metrics sink (one event per line)
 */
export function createJsonlMetricsSink(path: string): MetricsSink {
  return {
    async emit(event: MetricEvent): Promise<void> {
      await appendJsonLine(path, event);
    },
  };
}
