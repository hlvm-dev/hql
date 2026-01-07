/**
 * useStreaming Hook
 *
 * Manages streaming state for async iterators.
 * Uses high throttle and raw text during streaming for smooth output.
 * Markdown is only applied at the end (one visual change).
 *
 * Design decision: Progressive markdown causes visual jumps because
 * block structures change (borders appear, headers format). Claude Code CLI
 * achieves smoothness by writing directly to terminal, not through React.
 * With Ink/React, the smoothest approach is raw streaming + final format.
 */

import { useState, useEffect, useRef, useCallback } from "npm:react@18";

interface UseStreamingOptions {
  /** Throttle interval for display updates in ms (default: 100) */
  renderInterval?: number;
}

interface UseStreamingReturn {
  /** Raw accumulated text */
  text: string;
  /** Text for display (raw during streaming, markdown when done) */
  displayText: string;
  /** Currently receiving data */
  isStreaming: boolean;
  /** Stream has completed */
  isDone: boolean;
  /** Timestamp when streaming started */
  startTime: number;
  /** Cancel the stream */
  cancel: () => void;
}

/**
 * Hook for managing streaming async iterator state.
 * Streams raw text smoothly, applies markdown only at end.
 */
export function useStreaming(
  iterator: AsyncIterableIterator<string> | null,
  options: UseStreamingOptions = {}
): UseStreamingReturn {
  const { renderInterval = 100 } = options;

  const [displayText, setDisplayText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [startTime, setStartTime] = useState(0);

  // Use refs to avoid re-renders during streaming
  const bufferRef = useRef("");
  const lastUpdateRef = useRef(0);
  const pendingUpdateRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);

  // Cancel function exposed to caller
  const cancel = useCallback(() => {
    if (cancelledRef.current) return;
    cancelledRef.current = true;

    // Clear any pending update
    if (pendingUpdateRef.current) {
      clearTimeout(pendingUpdateRef.current);
      pendingUpdateRef.current = null;
    }

    // Final update with what we have
    setDisplayText(bufferRef.current + "\n\n[Cancelled]");
    setIsStreaming(false);
    setIsDone(true);
  }, []);

  useEffect(() => {
    if (!iterator) return;

    cancelledRef.current = false;

    // Reset state
    bufferRef.current = "";
    setDisplayText("");
    setIsStreaming(true);
    setIsDone(false);
    setStartTime(Date.now());

    // Throttled update function
    const scheduleUpdate = () => {
      const now = Date.now();
      const elapsed = now - lastUpdateRef.current;

      if (elapsed >= renderInterval) {
        // Update immediately
        setDisplayText(bufferRef.current);
        lastUpdateRef.current = now;
      } else if (!pendingUpdateRef.current) {
        // Schedule update
        pendingUpdateRef.current = setTimeout(() => {
          if (!cancelledRef.current) {
            setDisplayText(bufferRef.current);
            lastUpdateRef.current = Date.now();
          }
          pendingUpdateRef.current = null;
        }, renderInterval - elapsed) as unknown as number;
      }
    };

    (async () => {
      try {
        for await (const chunk of iterator) {
          if (cancelledRef.current) break;

          const content = typeof chunk === "string"
            ? chunk
            : (chunk as { content?: string }).content || "";

          if (content) {
            bufferRef.current += content;
            scheduleUpdate();
          }
        }
      } catch {
        // Stream interrupted
      }

      if (!cancelledRef.current) {
        // Clear any pending update
        if (pendingUpdateRef.current) {
          clearTimeout(pendingUpdateRef.current);
          pendingUpdateRef.current = null;
        }

        // Final update - raw text only (no markdown)
        setDisplayText(bufferRef.current);
        setIsStreaming(false);
        setIsDone(true);
      }
    })();

    return () => {
      cancelledRef.current = true;
      if (pendingUpdateRef.current) {
        clearTimeout(pendingUpdateRef.current);
      }
    };
  }, [iterator, renderInterval]);

  return {
    text: bufferRef.current,
    displayText,
    isStreaming,
    isDone,
    startTime,
    cancel,
  };
}
