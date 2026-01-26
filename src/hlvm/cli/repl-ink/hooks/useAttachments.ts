/**
 * useAttachments Hook
 *
 * Manages attachment state for the Ink REPL:
 * - Add/remove attachments with sequential IDs
 * - Track attachments across input sessions
 * - Clear attachments after submit
 */

import { useState, useCallback, useRef } from "npm:react@18";
import {
  type Attachment,
  type TextAttachment,
  type AttachmentError,
  type AnyAttachment,
  createAttachment,
  createTextAttachment,
  isAttachment,
} from "../../repl/attachment.ts";

// Re-export for consumers
export type { AnyAttachment };

export interface UseAttachmentsReturn {
  /** Current list of attachments (media and text) */
  attachments: AnyAttachment[];
  /** Add a new attachment from file path */
  addAttachment: (path: string) => Promise<Attachment | AttachmentError>;
  /** Add attachment with pre-reserved ID (for instant placeholder) */
  addAttachmentWithId: (path: string, id: number) => Promise<Attachment | AttachmentError>;
  /** Add a text attachment (for large pasted text) */
  addTextAttachment: (content: string) => TextAttachment;
  /** Reserve the next ID synchronously (for instant placeholder insertion) */
  reserveNextId: () => number;
  /** Remove an attachment by ID */
  removeAttachment: (id: number) => void;
  /** Clear all attachments */
  clearAttachments: () => void;
  /** Get combined display text for all attachments */
  getDisplayText: () => string;
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
  }, []);  // No dependencies - always returns current ref value

  /**
   * Add attachment with a specific ID (used after reserveNextId)
   */
  const addAttachmentWithId = useCallback(async (path: string, id: number): Promise<Attachment | AttachmentError> => {
    setLastError(null);

    const result = await createAttachment(path, id);

    if (isAttachment(result)) {
      setAttachments((prev: AnyAttachment[]) => [...prev, result]);
    } else {
      setLastError(result);
    }

    return result;
  }, []);

  /**
   * Add a new attachment from file path (auto-assigns ID)
   */
  const addAttachment = useCallback((path: string): Promise<Attachment | AttachmentError> => {
    const id = reserveNextId();
    return addAttachmentWithId(path, id);
  }, [reserveNextId, addAttachmentWithId]);

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
    setAttachments((prev: AnyAttachment[]) => prev.filter((a: AnyAttachment) => a.id !== id));
  }, []);

  /**
   * Clear all attachments (call after submit)
   */
  const clearAttachments = useCallback(() => {
    setAttachments([]);
    nextIdRef.current = 1;  // Reset ID counter
    setLastError(null);
  }, []);

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
    clearAttachments,
    getDisplayText,
    nextId: nextIdRef.current,
    lastError,
  };
}
