/**
 * First-Run Auto-Setup
 *
 * Zero-config setup: user presses Y once, everything auto-configures.
 * Uses the AIEngineLifecycle abstraction — works with embedded or system Ollama.
 * Picks best cloud model, pulls it, saves config.
 * Falls back to model browser on any failure or user decline.
 */

import { log } from "../../api/log.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { readSingleKey } from "../utils/input.ts";
import { isOllamaCloudModel } from "../../providers/ollama/cloud.ts";
import { logModelPullProgress } from "../../../common/ai-default-model.ts";
import { persistSelectedModelConfig } from "../../../common/config/model-selection.ts";
import { isOllamaAuthErrorMessage } from "../../../common/ollama-auth.ts";
import type { AIEngineLifecycle } from "../../runtime/ai-runtime.ts";
import type { ModelInfo } from "../../providers/types.ts";
import {
  ensureRuntimeHostReady,
  getRuntimeConfigApi,
  getRuntimeModelDiscovery,
  pullRuntimeModelViaHost,
  runRuntimeOllamaSignin,
  verifyRuntimeModelAccess,
} from "../../runtime/host-client.ts";
import { OLLAMA_SETTINGS_URL } from "./shared.ts";

// ============================================================================
// Constants
// ============================================================================

const CLOUD_SIGNIN_WAIT_TIMEOUT_MS = 120_000;
const CLOUD_SIGNIN_WAIT_INTERVAL_MS = 2_000;
const TOTAL_SETUP_STEPS = 4;

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
};

const HOST_RUNTIME_ENGINE: AIEngineLifecycle = {
  isRunning: async () => true,
  ensureRunning: async () => {
    await ensureRuntimeHostReady();
    return true;
  },
  getEnginePath: async () => "",
};

// ============================================================================
// Helpers
// ============================================================================

function isInteractiveTerminal(): boolean {
  return getPlatform().terminal.stdin.isTerminal();
}

function style(message: string, ...codes: string[]): string {
  if (!isInteractiveTerminal()) return message;
  return `${codes.join("")}${message}${ANSI.reset}`;
}

function printSetupBanner(logRaw: (message: string) => void): void {
  logRaw(
    style(
      "============================================================",
      ANSI.cyan,
    ),
  );
  logRaw(style("Welcome to HLVM!", ANSI.bold, ANSI.cyan));
  logRaw("Setup will configure the best cloud model (free, no GPU needed).");
  logRaw(
    style(
      "============================================================",
      ANSI.cyan,
    ),
  );
  logRaw("");
}

function printSetupStep(
  logRaw: (message: string) => void,
  step: number,
  message: string,
): void {
  logRaw(
    style(`[${step}/${TOTAL_SETUP_STEPS}] ${message}`, ANSI.bold, ANSI.cyan),
  );
}

/** Prompt "Continue? [Y/n]" and return true for Y/Enter, false for N. */
async function confirmSetup(): Promise<boolean> {
  if (getPlatform().env.get("HLVM_FORCE_SETUP") === "1") return true;

  log.raw.log(style("Continue? [Y/n] ", ANSI.bold, ANSI.yellow));
  const key = await readSingleKey();
  log.raw.log("");
  return key !== "n";
}

/** Parse parameter size string ("3B" -> 3, "671B" -> 671, unknown -> Infinity). */
export function parseParamSize(size: string | undefined): number {
  if (!size) return Infinity;
  const match = size.match(/^(\d+(?:\.\d+)?)\s*[Bb]/);
  return match ? parseFloat(match[1]) : Infinity;
}

/** Pick the best cloud model with tool-calling from the catalog (dynamic, no hardcoded list). */
export async function pickBestCloudModel(): Promise<ModelInfo | null> {
  const snapshot = await getRuntimeModelDiscovery();
  const cloudTools = snapshot.cloudModels.filter(
    (m) => isOllamaCloudModel(m.name) && m.capabilities?.includes("tools"),
  );

  // Sort by parameter size descending — largest = most capable
  cloudTools.sort(
    (a, b) => parseParamSize(b.parameterSize) - parseParamSize(a.parameterSize),
  );
  return cloudTools[0] ?? null;
}

/** Run Ollama sign-in through the runtime host. */
export async function runOllamaSignin(
  _engine?: AIEngineLifecycle,
): Promise<boolean> {
  log.raw.log(style("  -> Signing in to Ollama...", ANSI.yellow));
  try {
    const result = await runRuntimeOllamaSignin();
    for (const line of result.output) {
      log.raw.log(line);
    }
    return result.success;
  } catch {
    return false;
  }
}

/** Probe cloud model access with a tiny non-streaming chat request. */
export async function verifyOllamaCloudModelAccess(
  modelId: string,
): Promise<boolean> {
  try {
    return await verifyRuntimeModelAccess(modelId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Cloud access check failed: ${message}`);
    return false;
  }
}

async function waitForCloudAccess(modelId: string): Promise<boolean> {
  const deadline = Date.now() + CLOUD_SIGNIN_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await verifyOllamaCloudModelAccess(modelId)) return true;
    await new Promise((resolve) =>
      setTimeout(resolve, CLOUD_SIGNIN_WAIT_INTERVAL_MS)
    );
  }
  return false;
}

/**
 * Ensure cloud auth is truly completed for a model.
 * `ollama signin` may exit successfully before browser completion, so verify after signin.
 */
export async function ensureCloudAccessWithSignin(
  modelId: string,
  _engine?: AIEngineLifecycle,
): Promise<boolean> {
  if (await verifyOllamaCloudModelAccess(modelId)) return true;
  if (!(await runOllamaSignin())) return false;
  log.raw.log(style("  -> Waiting for cloud sign-in completion...", ANSI.dim));
  if (!(await waitForCloudAccess(modelId))) {
    log.error(
      "Cloud sign-in not completed. Open the URL above and try again.",
    );
    log.raw.log(
      style(`  -> Check cloud usage/sign-in: ${OLLAMA_SETTINGS_URL}`, ANSI.dim),
    );
    return false;
  }
  return true;
}

/** Pull a model, reactively signing in on auth error. */
async function pullWithSignin(
  modelName: string,
  _engine: AIEngineLifecycle,
): Promise<boolean> {
  log.raw.log(`Pulling ${modelName}...`);
  try {
    await logModelPullProgress(
      pullRuntimeModelViaHost(modelName, "ollama"),
      (msg) => log.raw.log(msg),
    );
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isAuthError = isOllamaAuthErrorMessage(message);
    if (!isAuthError) {
      log.error(`Pull failed: ${message}`);
      return false;
    }
    if (!(await ensureCloudAccessWithSignin(`ollama/${modelName}`))) {
      return false;
    }
    try {
      await logModelPullProgress(
        pullRuntimeModelViaHost(modelName, "ollama"),
        (msg) => log.raw.log(msg),
      );
      return true;
    } catch {
      return false;
    }
  }
}

/** Fall back to the model browser (existing behavior). */
async function fallbackToModelBrowser(): Promise<string | null> {
  log.raw.log(style("Opening model browser...\n", ANSI.yellow));
  const { startModelBrowser } = await import("../repl-ink/model-browser.tsx");
  const result = await startModelBrowser();
  return result.selectedModel ?? null;
}

export interface FirstRunSetupDeps {
  confirmSetup: () => Promise<boolean>;
  ensureEngineRunning: (engine: AIEngineLifecycle) => Promise<boolean>;
  pickBestCloudModel: () => Promise<ModelInfo | null>;
  ensureCloudModelAccess: (
    modelId: string,
    engine: AIEngineLifecycle,
  ) => Promise<boolean>;
  pullWithSignin: (
    modelName: string,
    engine: AIEngineLifecycle,
  ) => Promise<boolean>;
  fallbackToModelBrowser: () => Promise<string | null>;
  saveConfiguredModel: (modelId: string) => Promise<void>;
  logRaw: (message: string) => void;
  logError: (message: string) => void;
}

function getDefaultFirstRunSetupDeps(): FirstRunSetupDeps {
  return {
    confirmSetup,
    ensureEngineRunning: (engine: AIEngineLifecycle) => engine.ensureRunning(),
    pickBestCloudModel,
    ensureCloudModelAccess: (modelId: string, engine: AIEngineLifecycle) =>
      ensureCloudAccessWithSignin(modelId, engine),
    pullWithSignin,
    fallbackToModelBrowser,
    saveConfiguredModel: async (modelId: string) => {
      await persistSelectedModelConfig(getRuntimeConfigApi(), modelId);
    },
    logRaw: (message: string) => log.raw.log(message),
    logError: (message: string) => log.error(message),
  };
}

// ============================================================================
// Main
// ============================================================================

/**
 * Run the first-time auto-setup flow.
 * Depends on AIEngineLifecycle abstraction — works with embedded or system engine.
 * Returns model ID on success, null on abort/failure.
 */
export async function runFirstTimeSetup(
  engine?: AIEngineLifecycle,
  depsOverride: Partial<FirstRunSetupDeps> = {},
): Promise<string | null> {
  const resolvedEngine = engine ?? HOST_RUNTIME_ENGINE;
  const deps = { ...getDefaultFirstRunSetupDeps(), ...depsOverride };

  printSetupBanner(deps.logRaw);

  // 1. Confirm
  if (!(await deps.confirmSetup())) {
    return await deps.fallbackToModelBrowser();
  }

  // 2. Ensure AI engine running (embedded extraction + start, or system fallback)
  printSetupStep(deps.logRaw, 1, "Starting AI engine...");
  if (!(await deps.ensureEngineRunning(resolvedEngine))) {
    deps.logError("Could not start AI engine. Falling back to model browser.");
    return await deps.fallbackToModelBrowser();
  }

  // 3. Pick best cloud model
  printSetupStep(deps.logRaw, 2, "Selecting best cloud model...");
  const model = await deps.pickBestCloudModel();
  if (!model) {
    deps.logError(
      "No suitable cloud model found. Falling back to model browser.",
    );
    return await deps.fallbackToModelBrowser();
  }
  deps.logRaw(
    style(`  -> Selected: ${model.displayName ?? model.name}`, ANSI.dim),
  );

  // 4. Pull model (with reactive signin)
  printSetupStep(deps.logRaw, 3, "Pulling selected model...");
  if (!(await deps.pullWithSignin(model.name, resolvedEngine))) {
    deps.logError("Model pull failed. Falling back to model browser.");
    return await deps.fallbackToModelBrowser();
  }

  const modelId = `ollama/${model.name}`;
  if (!(await deps.ensureCloudModelAccess(modelId, resolvedEngine))) {
    deps.logError("Cloud sign-in required. Falling back to model browser.");
    return await deps.fallbackToModelBrowser();
  }

  // 5. Save config
  printSetupStep(deps.logRaw, 4, "Saving configuration...");
  await deps.saveConfiguredModel(modelId);

  deps.logRaw(
    `\n${style("Ready! Using", ANSI.bold, ANSI.green)} ${
      model.displayName ?? model.name
    }\n`,
  );
  deps.logRaw(style(`Cloud usage & limits: ${OLLAMA_SETTINGS_URL}`, ANSI.dim));
  deps.logRaw(
    style(
      "Tip: if cloud quota is exhausted, switch to a local model in model browser.",
      ANSI.dim,
    ),
  );
  return modelId;
}
