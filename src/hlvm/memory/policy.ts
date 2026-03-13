/**
 * Shared persistent-memory policy.
 *
 * All chat and agent paths should consult this module so the
 * disablePersistentMemory flag means the same thing everywhere.
 */

export function isPersistentMemoryEnabled(
  disablePersistentMemory?: boolean,
): boolean {
  return disablePersistentMemory !== true;
}
