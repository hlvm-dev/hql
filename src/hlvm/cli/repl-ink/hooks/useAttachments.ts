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

type AttachmentStatus = "loading" | "ready" | "error";

interface UseAttachmentsReturn {
  /** Current list of attachments (media and text) */
  attachments: AnyAttachment[];
  /** Add a new attachment from file path */
  addAttachment: (path: string) => Promise<Attachment | AttachmentError>;
  /** Add attachment with pre-reserved ID (for instant placeholder) */
  addAttachmentWithId: (
    path: string,
    id: number,
  ) => Promise<Attachment | AttachmentError>;
  /** Add a text attachment (for large pasted text) */
  addTextAttachment: (content: string) => TextAttachment;
  /** Reserve the next ID synchronously (for instant placeholder insertion) */
  reserveNextId: () => number;
  /** Remove an attachment by ID */
  removeAttachment: (id: number) => void;
  /** Replace all attachments and reset next ID accordingly */
  replaceAttachments: (attachments: AnyAttachment[]) => void;
  /** Clear all attachments */
  clearAttachments: () => void;
  /** Get combined display text for all attachments */
  getDisplayText: () => string;
  /** Get status of an attachment by ID */
  getAttachmentStatus: (id: number) => AttachmentStatus | undefined;
  /** Next ID to use */
  nextId: number;
  /** Last error if any */
  lastError: AttachmentError | null;
}

/**
 * React hook for managing REPL attachments
 */
export function useAttachments(): UseAttachmentsReturn {
  const [attachments, setAttachments] = useState<AnyAttachment[]>([]);
  // Use ref for nextId to avoid useCallback dependency issues and ensure
  // synchronous access to current value (no stale closure problems)
  const nextIdRef = useRef(1);
  // Invalidation token for async attachment operations.
  // Incremented on clear so stale in-flight results don't get appended later.
  const generationRef = useRef(0);
  const [lastError, setLastError] = useState<AttachmentError | null>(null);
  const statusMapRef = useRef<Map<number, AttachmentStatus>>(new Map());

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
    async (path: string, id: number): Promise<Attachment | AttachmentError> => {
      setLastError(null);
      statusMapRef.current.set(id, "loading");
      const generation = generationRef.current;

      const result = await createAttachment(path, id);

      if (isAttachment(result)) {
        // Ignore stale async completions from previous cleared sessions.
        if (generation === generationRef.current) {
          statusMapRef.current.set(id, "ready");
          setAttachments((prev: AnyAttachment[]) => [...prev, result]);
        }
      } else {
        statusMapRef.current.set(id, "error");
        setLastError(result);
      }

      return result;
    },
    [],
  );

  /**
   * Add a new attachment from file path (auto-assigns ID)
   */
  const addAttachment = useCallback(
    (path: string): Promise<Attachment | AttachmentError> => {
      const id = reserveNextId();
      return addAttachmentWithId(path, id);
    },
    [reserveNextId, addAttachmentWithId],
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
   * Remove an attachment by ID
   */
  const removeAttachment = useCallback((id: number) => {
    setAttachments((prev: AnyAttachment[]) =>
      prev.filter((a: AnyAttachment) => a.id !== id)
    );
  }, []);

  /**
   * Replace all attachments with a restored draft snapshot.
   */
  const replaceAttachments = useCallback((nextAttachments: AnyAttachment[]) => {
    generationRef.current += 1;
    setAttachments(
      nextAttachments.map((attachment: AnyAttachment) => ({ ...attachment })),
    );
    nextIdRef.current = nextAttachments.reduce(
      (maxId, attachment) => Math.max(maxId, attachment.id),
      0,
    ) + 1;
    setLastError(null);
  }, []);

  /**
   * Clear all attachments (call after submit)
   */
  const clearAttachments = useCallback(() => {
    generationRef.current += 1;
    setAttachments([]);
    nextIdRef.current = 1; // Reset ID counter
    statusMapRef.current.clear();
    setLastError(null);
  }, []);

  const getAttachmentStatus = useCallback(
    (id: number): AttachmentStatus | undefined => {
      return statusMapRef.current.get(id);
    },
    [],
  );

  /**
   * Get combined display text for all attachments
   * Example: "[Image #1] [Pasted text #2 +183 lines]"
   */
  const getDisplayText = useCallback((): string => {
    return attachments.map((a: AnyAttachment) => a.displayName).join(" ");
  }, [attachments]);

  return {
    attachments,
    addAttachment,
    addAttachmentWithId,
    addTextAttachment,
    reserveNextId,
    removeAttachment,
    replaceAttachments,
    clearAttachments,
    getDisplayText,
    getAttachmentStatus,
    nextId: nextIdRef.current,
    lastError,
  };
}
