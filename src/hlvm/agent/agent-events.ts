import type {
  AgentEvent,
  AgentEventSink,
  AgentLoopResult,
  AgentUIEvent,
  FinalResponseMeta,
  MaybePromise,
  TraceEvent,
} from "./orchestrator.ts";

export interface AgentEventCallbacks {
  onToken?: (text: string) => MaybePromise<unknown>;
  onAgentEvent?: (event: AgentUIEvent) => MaybePromise<unknown>;
  onTrace?: (event: TraceEvent) => MaybePromise<unknown>;
  onFinalResponseMeta?: (meta: FinalResponseMeta) => MaybePromise<unknown>;
}

export function createCallbackEventSink(
  callbacks: AgentEventCallbacks,
): AgentEventSink {
  return {
    async emit(event) {
      switch (event.type) {
        case "token":
          await callbacks.onToken?.(event.text);
          return;
        case "ui":
          await callbacks.onAgentEvent?.(event.event);
          return;
        case "trace":
          await callbacks.onTrace?.(event.event);
          return;
        case "final_response_meta":
          await callbacks.onFinalResponseMeta?.(event.meta);
          return;
        case "result":
          return undefined;
      }
    },
  };
}

export function createCompositeEventSink(
  sinks: readonly AgentEventSink[],
): AgentEventSink {
  const activeSinks = sinks.filter(Boolean);
  return {
    async emit(event) {
      for (const sink of activeSinks) {
        await sink.emit(event);
      }
    },
    async close(result) {
      for (const sink of activeSinks) {
        if (sink.close) {
          await sink.close(result);
        } else {
          await sink.emit({ type: "result", result });
        }
      }
    },
    async error(error) {
      for (const sink of activeSinks) {
        await sink.error?.(error);
      }
    },
  };
}

/**
 * Create a ReadableStream-backed event sink.
 *
 * Events are enqueued immediately (no backpressure).  The orchestrator emits
 * many events fire-and-forget (without awaiting), so blocking on consumer
 * reads would deadlock: the consumer awaits `handle.result` which can't
 * resolve until the loop finishes, but a backpressure-blocked emit inside
 * the loop would wait for the consumer to read first.
 *
 * Agent events are small objects and a typical run produces hundreds, not
 * millions, so unbounded buffering is safe.
 */
export function createReadableStreamEventSink(): {
  sink: AgentEventSink;
  stream: ReadableStream<AgentEvent>;
} {
  let controller: ReadableStreamDefaultController<AgentEvent> | undefined;
  let closed = false;

  const stream = new ReadableStream<AgentEvent>({
    start(c) {
      controller = c;
    },
    cancel() {
      closed = true;
    },
  });

  return {
    stream,
    sink: {
      emit(event) {
        if (closed || !controller) return;
        controller.enqueue(event);
      },
      close(result) {
        if (closed || !controller) return;
        controller.enqueue({ type: "result", result });
        closed = true;
        controller.close();
      },
      error(err) {
        if (closed || !controller) return;
        closed = true;
        controller.error(err);
      },
    },
  };
}
