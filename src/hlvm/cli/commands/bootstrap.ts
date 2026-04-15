/**
 * Bootstrap Command — materializes the local AI substrate.
 *
 * Usage:
 *   hlvm bootstrap            Full materialization (engine + fallback model)
 *   hlvm bootstrap --verify   Check existing installation integrity
 *   hlvm bootstrap --repair   Re-materialize missing/corrupt assets
 *   hlvm bootstrap --status   Print manifest as JSON
 */

import { log } from "../../api/log.ts";
import { hasHelpFlag } from "../utils/common-helpers.ts";
import { verifyBootstrap } from "../../runtime/bootstrap-verify.ts";
import {
  readBootstrapManifest,
} from "../../runtime/bootstrap-manifest.ts";
import { LOCAL_FALLBACK_MODEL_ID } from "../../runtime/local-fallback.ts";
import { materializeBootstrap, type MaterializeProgress } from "../../runtime/bootstrap-materialize.ts";
import { recoverBootstrap } from "../../runtime/bootstrap-recovery.ts";
import { aiEngine } from "../../runtime/ai-runtime.ts";
import { waitForModelAccess } from "../../runtime/model-access.ts";
import { upgradeDefaultToAutoRouting } from "../../../common/ai-default-model.ts";

const BOOTSTRAP_MODEL_READY_TIMEOUT_MS = 900_000;
const BOOTSTRAP_MODEL_READY_LOG_INTERVAL_MS = 30_000;

function showBootstrapHelp(): void {
  log.info(`
hlvm bootstrap — Prepare local AI substrate

Usage:
  hlvm bootstrap              Pull AI engine + fallback model
  hlvm bootstrap --verify     Check integrity of existing installation
  hlvm bootstrap --repair     Re-materialize missing/corrupt assets
  hlvm bootstrap --status     Print bootstrap manifest as JSON
  hlvm bootstrap --help       Show this help

After bootstrap completes, \`hlvm ask "hello"\` works immediately.
`.trim());
}

function logProgress(p: MaterializeProgress): void {
  if (p.percent !== undefined) {
    log.info(`  [${p.phase}] ${p.message} (${p.percent}%)`);
  } else {
    log.info(`  [${p.phase}] ${p.message}`);
  }
}

export async function bootstrapCommand(args: string[]): Promise<number> {
  if (hasHelpFlag(args)) {
    showBootstrapHelp();
    return 0;
  }

  const flag = args[0] ?? "";

  // --status: print manifest JSON
  if (flag === "--status") {
    const manifest = await readBootstrapManifest();
    if (!manifest) {
      log.info("No bootstrap manifest found. Run `hlvm bootstrap` first.");
      return 1;
    }
    log.info(JSON.stringify(manifest, null, 2));
    return 0;
  }

  // --verify: check integrity
  if (flag === "--verify") {
    log.info("Verifying bootstrap...");
    const result = await verifyBootstrap();
    log.info(`State: ${result.state}`);
    log.info(`Engine: ${result.engineOk ? "OK" : "MISSING/CORRUPT"}`);
    log.info(`Model:  ${result.modelOk ? "OK" : "MISSING/CORRUPT"}`);
    log.info(result.message);
    return result.state === "verified" ? 0 : 1;
  }

  // --repair: recover degraded state
  if (flag === "--repair") {
    log.info("Checking bootstrap state...");
    const verification = await verifyBootstrap();
    if (verification.state === "verified") {
      log.info("Bootstrap is already verified. Nothing to repair.");
      return 0;
    }
    log.info(`State: ${verification.state} — starting repair...`);
    const recovery = await recoverBootstrap(
      verification.manifest,
      verification,
      { onProgress: logProgress },
    );
    log.info(recovery.message);
    return recovery.success ? 0 : 1;
  }

  // Default: full materialization
  log.info("Bootstrapping HLVM local AI substrate...");
  try {
    const manifest = await materializeBootstrap({ onProgress: logProgress });
    const verification = await verifyBootstrap();
    if (verification.state !== "verified") {
      log.error(`Bootstrap materialized assets but verification failed: ${verification.message}`);
      return 1;
    }
    const upgradedToAuto = await upgradeDefaultToAutoRouting();
    if (upgradedToAuto) {
      log.info(`Configured initial model: ${upgradedToAuto}`);
    }
    log.info(`Warming local fallback: ${LOCAL_FALLBACK_MODEL_ID}`);
    const engineReady = await aiEngine.ensureRunning();
    if (!engineReady) {
      log.error(
        "Bootstrap completed, but the local AI engine could not be started for readiness verification.",
      );
      return 1;
    }
    let lastLoggedWaitBucket = -1;
    const access = await waitForModelAccess(LOCAL_FALLBACK_MODEL_ID, {
      timeoutMs: BOOTSTRAP_MODEL_READY_TIMEOUT_MS,
      onRetry: (_result, elapsedMs) => {
        const waitBucket = Math.floor(
          elapsedMs / BOOTSTRAP_MODEL_READY_LOG_INTERVAL_MS,
        );
        if (waitBucket <= lastLoggedWaitBucket) return;
        lastLoggedWaitBucket = waitBucket;
        log.info(
          `Still warming ${LOCAL_FALLBACK_MODEL_ID}... (${Math.round(elapsedMs / 1000)}s elapsed)`,
        );
      },
    });
    if (!access.available) {
      const reason = access.authRequired
        ? "authentication is unexpectedly required"
        : access.error ?? "the model did not answer a readiness probe in time";
      log.error(
        `Bootstrap completed, but ${LOCAL_FALLBACK_MODEL_ID} is not ready for requests: ${reason}`,
      );
      return 1;
    }
    log.info(`Ready: ${LOCAL_FALLBACK_MODEL_ID} answered a probe request.`);
    log.info(`Bootstrap complete. State: ${manifest.state}`);
    log.info(`Engine:  ${manifest.engine.adapter} (${manifest.engine.path})`);
    for (const m of manifest.models) {
      log.info(`Model:   ${m.modelId}`);
    }
    return 0;
  } catch (error) {
    log.error(`Bootstrap failed: ${(error as Error).message}`);
    return 1;
  }
}

export { showBootstrapHelp };
