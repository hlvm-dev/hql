/**
 * Bootstrap recovery — repairs a degraded bootstrap by re-extracting the
 * engine or re-pulling the fallback model as needed.
 */

import { log } from "../api/log.ts";
import {
  type BootstrapManifest,
  writeBootstrapManifest,
} from "./bootstrap-manifest.ts";
import {
  type BootstrapVerificationResult,
  verifyBootstrap,
} from "./bootstrap-verify.ts";
import {
  materializeBootstrap,
  type MaterializeOptions,
} from "./bootstrap-materialize.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecoveryResult {
  /** Whether recovery succeeded. */
  success: boolean;
  /** The new manifest after recovery (null if recovery failed completely). */
  manifest: BootstrapManifest | null;
  /** Human-readable summary. */
  message: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Attempt to recover a degraded or uninitialized bootstrap.
 *
 * Strategy:
 * - If completely uninitialized → full materialize.
 * - If degraded (engine or model missing) → full materialize (re-extract + re-pull).
 *
 * A targeted partial recovery (re-extract engine only, re-pull model only) is
 * possible but adds complexity for marginal benefit — the full flow is
 * idempotent and safe.
 */
export async function recoverBootstrap(
  _manifest: BootstrapManifest | null,
  _verification: BootstrapVerificationResult,
  options?: MaterializeOptions,
): Promise<RecoveryResult> {
  log.debug?.("Starting bootstrap recovery...");

  try {
    const manifest = await materializeBootstrap(options);

    // Re-verify after materialization
    const postCheck = await verifyBootstrap();
    if (postCheck.state === "verified") {
      return {
        success: true,
        manifest,
        message: "Bootstrap recovered successfully.",
      };
    }

    // Materialization returned but post-check is still degraded
    return {
      success: false,
      manifest,
      message: `Recovery completed but verification still degraded: ${postCheck.message}`,
    };
  } catch (error) {
    log.error?.(`Bootstrap recovery failed: ${(error as Error).message}`);
    return {
      success: false,
      manifest: null,
      message: `Recovery failed: ${(error as Error).message}`,
    };
  }
}
