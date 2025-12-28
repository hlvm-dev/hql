/**
 * AI Runtime Manager for HQL
 *
 * Handles extraction and lifecycle of the embedded AI engine (Ollama).
 * This is internal - users never see or interact with this directly.
 */

const HOME = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "/tmp";
const RUNTIME_DIR = `${HOME}/.hql/.runtime`;
const AI_ENGINE_PATH = `${RUNTIME_DIR}/engine`;
const OLLAMA_URL = "http://127.0.0.1:11434";

let aiProcess: Deno.ChildProcess | null = null;
let initialized = false;

/**
 * Check if AI runtime (Ollama) is already running
 */
async function isAIRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(1000)
    });
    // Must consume or cancel the response body to avoid resource leaks
    if (response.body) {
      await response.body.cancel();
    }
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Extract embedded AI engine if needed
 */
async function extractAIEngine(): Promise<void> {
  try {
    await Deno.stat(AI_ENGINE_PATH);
    return; // Already extracted
  } catch {
    // Need to extract
  }

  try {
    // Read embedded AI engine from compiled binary
    const engineBytes = await Deno.readFile(
      new URL("../../resources/ai-engine", import.meta.url)
    );

    // Create runtime directory
    await Deno.mkdir(RUNTIME_DIR, { recursive: true });

    // Write AI engine
    await Deno.writeFile(AI_ENGINE_PATH, engineBytes);
    await Deno.chmod(AI_ENGINE_PATH, 0o755);
  } catch (error) {
    // In development mode, AI engine might not be embedded
    // This is OK - user might have Ollama installed separately
    if ((error as Error).message.includes("No such file")) {
      return; // Skip extraction in dev mode
    }
    throw error;
  }
}

/**
 * Start the AI engine
 */
async function startAIEngine(): Promise<void> {
  // Try embedded engine first
  let enginePath = AI_ENGINE_PATH;

  try {
    await Deno.stat(enginePath);
  } catch {
    // Try system ollama
    enginePath = "ollama";
  }

  try {
    const command = new Deno.Command(enginePath, {
      args: ["serve"],
      stdout: "null",
      stderr: "null",
    });
    aiProcess = command.spawn();

    // Unref the process so Node/Deno can exit without waiting for it
    // This prevents the CLI from hanging after AI operations complete
    aiProcess.unref();

    // Wait for AI engine to be ready
    for (let i = 0; i < 30; i++) {
      if (await isAIRunning()) {
        return;
      }
      await new Promise(r => setTimeout(r, 300));
    }
    throw new Error("AI engine failed to start");
  } catch (error) {
    // If embedded engine fails, AI features will just not work
    // but HQL itself continues to function
    console.error("Warning: AI features unavailable -", (error as Error).message);
  }
}

/**
 * Initialize AI runtime
 * Call this at CLI startup if AI features might be used
 */
export async function initAIRuntime(): Promise<void> {
  if (initialized) return;
  initialized = true;

  // Check for disable flag (e.g. during tests)
  if (Deno.env.get("HQL_DISABLE_AI_AUTOSTART")) {
    return;
  }

  // Check if already running
  if (await isAIRunning()) {
    return;
  }

  // Extract if needed
  await extractAIEngine();

  // Start AI engine
  await startAIEngine();
}

/**
 * Shutdown AI runtime
 * Call this when CLI exits
 */
export async function shutdownAIRuntime(): Promise<void> {
  if (aiProcess) {
    try {
      aiProcess.kill("SIGTERM");
      aiProcess = null;
    } catch {
      // Ignore shutdown errors
    }
  }
}

/**
 * Check if AI is available
 */
export async function isAIAvailable(): Promise<boolean> {
  return isAIRunning();
}

/**
 * Get AI runtime status
 */
export function getAIRuntimeStatus(): { initialized: boolean; running: boolean } {
  return {
    initialized,
    running: aiProcess !== null
  };
}
