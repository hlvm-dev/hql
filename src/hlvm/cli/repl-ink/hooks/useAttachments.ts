/**
 * useAttachments Hook
 *
 * Manages attachment state for the Ink REPL:
 * - Add/remove attachments with sequential IDs
 * - Track attachments across input sessions
 * - Clear attachments after submit
 */

import { useCallback, useRef, useState } from "react";
import {
  type AnyAttachment,
  type Attachment,
  type AttachmentError,
  createAttachment,
  createTextAttachment,
  isAttachment,
  type TextAttachment,
} from "../../repl/attachment.ts";

// Re-export for consumers
export type { AnyAttachment };
export type AttachmentAddResult = Attachment | AttachmentError | null;

export interface UseAttachmentsReturn {
  /** Current list of attachments (media and text) */
  attachments: AnyAttachment[];
  /** Add attachment with pre-reserved ID (for instant placeholder) */
  addAttachmentWithId: (
    path: string,
    id: number,
  ) => Promise<AttachmentAddResult>;
  /** Add a text attachment (for large pasted text) */
  addTextAttachment: (content: string) => TextAttachment;
  /** Reserve the next ID synchronously (for instant placeholder insertion) */
  reserveNextId: () => number;
  /** Replace all attachments while keeping attachment labels monotonic */
  replaceAttachments: (attachments: AnyAttachment[]) => void;
  /** Clear all attachments without reusing old attachment labels */
  clearAttachments: () => void;
  /** Last error if any */
  lastError: AttachmentError | null;
}

/**
 * React hook for managing REPL attachments
 */
export function useAttachments(): UseAttachmentsReturn {
  const [attachments, setAttachments] = useState<AnyAttachment[]>([]);
  // Use ref for nextId to avoid useCallback dependency issues and ensure
  // synchronous access to current value (no stale closure problems). IDs stay
  // monotonic across clears/restores so placeholder labels are never reused.
  const nextIdRef = useRef(1);
  // Invalidation token for async attachment operations.
  // Incremented on clear so stale in-flight results don't get appended later.
  const generationRef = useRef(0);
  const [lastError, setLastError] = useState<AttachmentError | null>(null);

  /**
   * Reserve the next ID synchronously - for instant placeholder insertion
   * Uses ref instead of state to avoid closure issues and ensure
   * rapid successive calls get unique IDs
   */
  const reserveNextId = useCallback((): number => {
    const id = nextIdRef.current;
    nextIdRef.current += 1;
    return id;
  }, []); // No dependencies - always returns current ref value

  /**
   * Add attachment with a specific ID (used after reserveNextId)
   */
  const addAttachmentWithId = useCallback(
    async (path: string, id: number): Promise<AttachmentAddResult> => {
      setLastError(null);
      const generation = generationRef.current;

      const result = await createAttachment(path, id);

      if (generation !== generationRef.current) {
        return null;
      }

      if (isAttachment(result)) {
        setAttachments((prev: AnyAttachment[]) => [...prev, result]);
      } else {
        setLastError(result);
      }

      return result;
    },
    [],
  );

  /**
   * Add a text attachment for large pasted text (synchronous for instant UI)
   */
  const addTextAttachment = useCallback((content: string): TextAttachment => {
    const id = reserveNextId();
    const textAttachment = createTextAttachment(content, id);
    setAttachments((prev: AnyAttachment[]) => [...prev, textAttachment]);
    return textAttachment;
  }, [reserveNextId]);

  /**
   * Replace all attachments with a restored draft snapshot.
   */
  const replaceAttachments = useCallback((nextAttachments: AnyAttachment[]) => {
    generationRef.current += 1;
    setAttachments(
      nextAttachments.map((attachment: AnyAttachment) => ({ ...attachment })),
    );
    nextIdRef.current = Math.max(
      nextIdRef.current,
      nextAttachments.reduce(
        (maxId, attachment) => Math.max(maxId, attachment.id),
        0,
      ) + 1,
    );
    setLastError(null);
  }, []);

  /**
   * Clear all attachments (call after submit)
   */
  const clearAttachments = useCallback(() => {
    generationRef.current += 1;
    setAttachments([]);
    setLastError(null);
  }, []);

  return {
    attachments,
    addAttachmentWithId,
    addTextAttachment,
    reserveNextId,
    replaceAttachments,
    clearAttachments,
    lastError,
  };
}
