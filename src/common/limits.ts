/**
 * HQL Limits and Thresholds
 * Single source of truth for all magic numbers and configuration limits.
 */

/** Maximum elements when realizing lazy sequences for display or processing */
export const MAX_SEQ_LENGTH = 10000;

/** Default LRU cache capacity for module resolution and import tracking */
export const DEFAULT_LRU_CACHE_SIZE = 10000;

/** Maximum macro expansion iterations to prevent infinite loops */
export const MAX_EXPANSION_ITERATIONS = 100;
