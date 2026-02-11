/**
 * First-Run Auto-Setup
 *
 * Zero-config setup: user presses Y once, everything auto-configures.
 * Uses the AIEngineLifecycle abstraction — works with embedded or system Ollama.
 * Picks best cloud model, pulls it, saves config.
 * Falls back to model browser on any failure or user decline.
 */

import { config } from "../../api/config.ts";
import { ai } from "../../api/ai.ts";
import { log } from "../../api/log.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { getOllamaCatalog } from "../../providers/ollama/catalog.ts";
import { isOllamaCloudModel } from "../../providers/ollama/cloud.ts";
import { pullModelWithProgress } from "../../../common/ai-default-model.ts";
import { aiEngine } from "../../runtime/ai-runtime.ts";
import type { AIEngineLifecycle } from "../../runtime/ai-runtime.ts";
import type { ModelInfo } from "../../providers/types.ts";

// ============================================================================
// Constants
// ============================================================================

const PREFERRED_CLOUD_MODELS = [
  "deepseek-v3.1:671b-cloud",
  "qwen3-coder:480b-cloud",
  "mistral-large-3:675b-cloud",
];

// ============================================================================
// Helpers
// ============================================================================

/** Read a single keypress from raw-mode stdin. Returns lowercase character. */
async function readSingleKey(): Promise<string> {
  const platform = getPlatform();
  const stdin = platform.terminal.stdin;
  stdin.setRaw(true);
  try {
    const buf = new Uint8Array(1);
    const n = await stdin.read(buf);
    if (n === null || n === 0) return "";
    return String.fromCharCode(buf[0]).toLowerCase();
  } finally {
    stdin.setRaw(false);
  }
}

/** Prompt "Continue? [Y/n]" and return true for Y/Enter, false for N. */
async function confirmSetup(): Promise<boolean> {
  if (getPlatform().env.get("HLVM_FORCE_SETUP") === "1") return true;

  log.raw.log("Continue? [Y/n] ");
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

/** Pick the best cloud model with tool-calling from the catalog. */
export function pickBestCloudModel(): ModelInfo | null {
  const catalog = getOllamaCatalog({ maxVariants: Infinity });
  const cloudTools = catalog.filter(
    (m) => isOllamaCloudModel(m.name) && m.capabilities?.includes("tools"),
  );

  for (const preferred of PREFERRED_CLOUD_MODELS) {
    const found = cloudTools.find((m) => m.name === preferred);
    if (found) return found;
  }

  cloudTools.sort(
    (a, b) => parseParamSize(b.parameterSize) - parseParamSize(a.parameterSize),
  );
  return cloudTools[0] ?? null;
}

/** Detect auth/sign-in errors from Ollama HTTP responses. */
export function isOllamaAuthErrorMessage(message: string): boolean {
  return /unauthorized|auth|401|sign.?in/i.test(message);
}

/** Run `engine signin` with inherited stdio for interactive auth. */
export async function runOllamaSignin(
  engine: AIEngineLifecycle = aiEngine,
): Promise<boolean> {
  const enginePath = await engine.getEnginePath();
  log.raw.log("Signing in to Ollama...");
  const platform = getPlatform();
  try {
    const process = platform.command.run({
      cmd: [enginePath, "signin"],
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const status = await process.status;
    return status.success;
  } catch {
    return false;
  }
}

/** Probe cloud model access with a tiny non-streaming chat request. */
export async function verifyOllamaCloudModelAccess(
  modelId: string,
): Promise<boolean> {
  try {
    const stream = ai.chat(
      [{ role: "user", content: "ok" }],
      {
        model: modelId,
        stream: false,
        maxTokens: 1,
        temperature: 0,
      },
    );
    await stream.next();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isOllamaAuthErrorMessage(message)) return false;
    log.error(`Cloud access check failed: ${message}`);
    return false;
  }
}

/** Pull a model, reactively signing in on auth error. */
async function pullWithSignin(
  modelName: string,
  engine: AIEngineLifecycle,
): Promise<boolean> {
  log.raw.log(`Pulling ${modelName}...`);
  try {
    await pullModelWithProgress(modelName, "ollama", (msg) => log.raw.log(msg));
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isAuthError = isOllamaAuthErrorMessage(message);
    if (!isAuthError) {
      log.error(`Pull failed: ${message}`);
      return false;
    }
    if (!(await runOllamaSignin(engine))) return false;
    if (!(await verifyOllamaCloudModelAccess(`ollama/${modelName}`))) {
      log.error(
        "Cloud sign-in not completed. Open the URL above and try again.",
      );
      return false;
    }
    try {
      await pullModelWithProgress(
        modelName,
        "ollama",
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
  log.raw.log("Opening model browser...\n");
  const { startModelBrowser } = await import("../repl-ink/model-browser.tsx");
  const result = await startModelBrowser();
  if (result.selectedModel) {
    await config.set("modelConfigured", true);
    return result.selectedModel;
  }
  await config.set("modelConfigured", true);
  return null;
}

export interface FirstRunSetupDeps {
  confirmSetup: () => Promise<boolean>;
  ensureEngineRunning: (engine: AIEngineLifecycle) => Promise<boolean>;
  pickBestCloudModel: () => ModelInfo | null;
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
    pullWithSignin,
    fallbackToModelBrowser,
    saveConfiguredModel: async (modelId: string) => {
      await config.set("model", modelId);
      await config.set("modelConfigured", true);
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
  engine: AIEngineLifecycle = aiEngine,
  depsOverride: Partial<FirstRunSetupDeps> = {},
): Promise<string | null> {
  const deps = { ...getDefaultFirstRunSetupDeps(), ...depsOverride };

  deps.logRaw("Welcome to HLVM!");
  deps.logRaw(
    "Setup will configure the best cloud model (free, no GPU needed).\n",
  );

  // 1. Confirm
  if (!(await deps.confirmSetup())) {
    return await deps.fallbackToModelBrowser();
  }

  // 2. Ensure AI engine running (embedded extraction + start, or system fallback)
  deps.logRaw("Starting AI engine...");
  if (!(await deps.ensureEngineRunning(engine))) {
    deps.logError("Could not start AI engine. Falling back to model browser.");
    return await deps.fallbackToModelBrowser();
  }

  // 3. Pick best cloud model
  const model = deps.pickBestCloudModel();
  if (!model) {
    deps.logError(
      "No suitable cloud model found. Falling back to model browser.",
    );
    return await deps.fallbackToModelBrowser();
  }

  // 4. Pull model (with reactive signin)
  if (!(await deps.pullWithSignin(model.name, engine))) {
    deps.logError("Model pull failed. Falling back to model browser.");
    return await deps.fallbackToModelBrowser();
  }

  // 5. Save config
  const modelId = `ollama/${model.name}`;
  await deps.saveConfiguredModel(modelId);

  deps.logRaw(`\nReady! Using ${model.displayName ?? model.name}\n`);
  return modelId;
}
