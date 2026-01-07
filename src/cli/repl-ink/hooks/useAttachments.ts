/**
 * useAttachments Hook
 *
 * Manages attachment state for the Ink REPL:
 * - Add/remove attachments with sequential IDs
 * - Track attachments across input sessions
 * - Clear attachments after submit
 */

import { useState, useCallback } from "npm:react@18";
import {
  type Attachment,
  type AttachmentError,
  createAttachment,
  isAttachment,
} from "../../repl/attachment.ts";

export interface UseAttachmentsReturn {
  /** Current list of attachments */
  attachments: Attachment[];
  /** Add a new attachment from file path */
  addAttachment: (path: string) => Promise<Attachment | AttachmentError>;
  /** Add attachment with pre-reserved ID (for instant placeholder) */
  addAttachmentWithId: (path: string, id: number) => Promise<Attachment | AttachmentError>;
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
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [nextId, setNextId] = useState(1);
  const [lastError, setLastError] = useState<AttachmentError | null>(null);

  /**
   * Reserve the next ID synchronously - for instant placeholder insertion
   */
  const reserveNextId = useCallback((): number => {
    const id = nextId;
    setNextId((n: number) => n + 1);
    return id;
  }, [nextId]);

  /**
   * Add attachment with a specific ID (used after reserveNextId)
   */
  const addAttachmentWithId = useCallback(async (path: string, id: number): Promise<Attachment | AttachmentError> => {
    setLastError(null);

    const result = await createAttachment(path, id);

    if (isAttachment(result)) {
      setAttachments((prev: Attachment[]) => [...prev, result]);
    } else {
      setLastError(result);
    }

    return result;
  }, []);

  /**
   * Add a new attachment from file path (auto-assigns ID)
   */
  const addAttachment = useCallback(async (path: string): Promise<Attachment | AttachmentError> => {
    const id = reserveNextId();
    return addAttachmentWithId(path, id);
  }, [reserveNextId, addAttachmentWithId]);

  /**
   * Remove an attachment by ID
   */
  const removeAttachment = useCallback((id: number) => {
    setAttachments((prev: Attachment[]) => prev.filter((a: Attachment) => a.id !== id));
  }, []);

  /**
   * Clear all attachments (call after submit)
   */
  const clearAttachments = useCallback(() => {
    setAttachments([]);
    setNextId(1);
    setLastError(null);
  }, []);

  /**
   * Get combined display text for all attachments
   * Example: "[Image #1] [PDF #2]"
   */
  const getDisplayText = useCallback((): string => {
    return attachments.map((a: Attachment) => a.displayName).join(" ");
  }, [attachments]);

  return {
    attachments,
    addAttachment,
    addAttachmentWithId,
    reserveNextId,
    removeAttachment,
    clearAttachments,
    getDisplayText,
    nextId,
    lastError,
  };
}
