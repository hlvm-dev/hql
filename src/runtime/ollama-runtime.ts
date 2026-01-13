/**
 * Ollama Runtime
 *
 * Provides the global `ollama` object for HQL with programmatic model management.
 * Auto-available without imports - injected into globalThis during startup.
 *
 * Usage in HQL:
 *   (await ollama.models)           ; List all known models
 *   (await ollama.local)            ; List installed models
 *   (ollama.pull "llama3.2")        ; Download model (returns task handle)
 *   (await (ollama.remove "x"))     ; Delete model
 *   (await (ollama.info "x"))       ; Get model details
 */

import { getTaskManager } from "../cli/repl/task-manager/index.ts";
import type { PullProgress, TaskEvent } from "../cli/repl/task-manager/types.ts";
import { isModelPullTask } from "../cli/repl/task-manager/types.ts";

// Import scraped models catalog (205 models from ollama.com)
import ollamaModelsData from "../cli/repl-ink/data/ollama_models.json" with { type: "json" };

// ============================================================
// Global Type Declarations
// ============================================================

/**
 * Declare the global `ollama` object type.
 * This makes TypeScript aware of the global in HQL code.
 */
declare global {
  // deno-lint-ignore no-var
  var ollama: {
    /** All known models (local + popular catalog) */
    readonly models: Promise<Array<OllamaLocalModel | OllamaRemoteModel>>;
    /** Only installed (local) models */
    readonly local: Promise<OllamaLocalModel[]>;
    /** Available models not yet installed */
    readonly available: Promise<OllamaRemoteModel[]>;
    /** Current endpoint */
    readonly endpoint: string;
    /** Pull (download) a model - returns task handle immediately */
    pull(name: string): OllamaTaskHandle;
    /** Remove (delete) an installed model */
    remove(name: string): Promise<{ success: boolean; name: string }>;
    /** Get detailed info about a model */
    info(name: string): Promise<OllamaModelInfo>;
    /** Search available models by query */
    search(query: string): OllamaRemoteModel[];
    /** Force refresh the cache */
    refresh(): void;
  };
}

// ============================================================
// Types
// ============================================================

/** Model info returned by ollama.local */
export interface OllamaLocalModel {
  name: string;
  size: number;
  modified: string;
  digest?: string;
}

/** Model info from catalog (ollama.available) */
export interface OllamaRemoteModel {
  name: string;
  description?: string;
  sizes?: string[];
  capabilities?: string[];
}

/** Detailed model info from ollama.info */
export interface OllamaModelInfo {
  name: string;
  modified?: string;
  size?: number;
  digest?: string;
  details?: {
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
    format?: string;
  };
  capabilities?: string[];
  modelfile?: string;
}

/** Task handle returned by ollama.pull */
export interface OllamaTaskHandle {
  /** Current status */
  readonly status: string;
  /** Current progress */
  readonly progress: {
    completed?: number;
    total?: number;
    percent?: number;
    status: string;
  };
  /** Cancel the download */
  cancel(): boolean;
  /** Wait for completion */
  await(): Promise<void>;
}

// ============================================================
// Models Catalog - Loaded from scraped ollama_models.json
// ============================================================

interface ScrapedModelVariant {
  id: string;
  name: string;
  parameters: string;
  size: string;
  context: string;
  vision: boolean;
}

interface ScrapedModel {
  id: string;
  name: string;
  description: string;
  variants: ScrapedModelVariant[];
  vision: boolean;
  downloads: number;
  model_type?: string;
}

/**
 * Load models from scraped JSON and transform to OllamaRemoteModel format.
 * Returns flattened list of model variants (e.g., llama3.1:8b, llama3.1:70b).
 */
function loadScrapedModels(): OllamaRemoteModel[] {
  const models = ollamaModelsData.models as ScrapedModel[];
  const result: OllamaRemoteModel[] = [];

  for (const model of models) {
    // Derive capabilities from model properties
    const capabilities: string[] = ["text"];
    if (model.vision) capabilities.push("vision");
    if (model.model_type === "embedding") {
      capabilities.length = 0; // Clear "text"
      capabilities.push("embedding");
    }
    // Add "tools" for popular tool-capable models
    if (/llama3|qwen|mistral|gemma/i.test(model.id) && !model.vision && model.model_type !== "embedding") {
      capabilities.push("tools");
    }

    // Add each variant as a separate entry
    for (const variant of model.variants.slice(0, 3)) { // Limit to 3 variants per model
      result.push({
        name: variant.id,
        description: model.description,
        sizes: [variant.size],
        capabilities,
      });
    }

    // If no variants, add the model itself
    if (model.variants.length === 0) {
      result.push({
        name: model.id,
        description: model.description,
        capabilities,
      });
    }
  }

  return result;
}

/** Cached models from scraped JSON */
let _scrapedModels: OllamaRemoteModel[] | null = null;

function getScrapedModels(): OllamaRemoteModel[] {
  if (!_scrapedModels) {
    _scrapedModels = loadScrapedModels();
  }
  return _scrapedModels;
}

// ============================================================
// Event-Driven Cache
// ============================================================

/**
 * Cache for Ollama model lists with event-driven invalidation.
 * Subscribes to TaskManager events to invalidate when models change.
 */
class OllamaCache {
  private endpoint: string;
  private localModelsPromise: Promise<OllamaLocalModel[]> | null = null;
  private modelsPromise: Promise<Array<OllamaLocalModel | OllamaRemoteModel>> | null = null;
  private availablePromise: Promise<OllamaRemoteModel[]> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
    this.setupEventListeners();
  }

  /** Subscribe to TaskManager events to invalidate cache */
  private setupEventListeners(): void {
    const manager = getTaskManager(this.endpoint);
    this.unsubscribe = manager.onEvent((event: TaskEvent) => {
      // Invalidate cache when a model pull completes
      if (event.type === "task:completed") {
        const task = manager.getTask(event.taskId);
        if (task && isModelPullTask(task)) {
          this.invalidate();
        }
      }
    });
  }

  /** Invalidate all cached promises */
  invalidate(): void {
    this.localModelsPromise = null;
    this.modelsPromise = null;
    this.availablePromise = null;
  }

  /** Update endpoint and invalidate cache */
  updateEndpoint(endpoint: string): void {
    if (this.endpoint !== endpoint) {
      this.endpoint = endpoint;
      this.invalidate();
      // Re-setup listeners with new endpoint
      if (this.unsubscribe) {
        this.unsubscribe();
      }
      this.setupEventListeners();
    }
  }

  /** Get local models (cached) */
  getLocalModels(): Promise<OllamaLocalModel[]> {
    if (!this.localModelsPromise) {
      this.localModelsPromise = fetchLocalModels(this.endpoint);
    }
    return this.localModelsPromise;
  }

  /** Get all models (cached) - uses scraped 205 models from ollama_models.json */
  getModels(): Promise<Array<OllamaLocalModel | OllamaRemoteModel>> {
    if (!this.modelsPromise) {
      this.modelsPromise = (async () => {
        const local = await this.getLocalModels();
        const localNames = new Set(local.map((m) => m.name.split(":")[0]));
        const remote = getScrapedModels().filter((m) => !localNames.has(m.name.split(":")[0]));
        return [...local, ...remote];
      })();
    }
    return this.modelsPromise;
  }

  /** Get available models (cached) - uses scraped 205 models from ollama_models.json */
  getAvailable(): Promise<OllamaRemoteModel[]> {
    if (!this.availablePromise) {
      this.availablePromise = (async () => {
        const local = await this.getLocalModels();
        const localNames = new Set(local.map((m) => m.name.split(":")[0]));
        return getScrapedModels().filter((m) => !localNames.has(m.name.split(":")[0]));
      })();
    }
    return this.availablePromise;
  }

  /** Cleanup */
  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.invalidate();
  }
}

/** Global cache instance */
let _cache: OllamaCache | null = null;

function getCache(endpoint: string): OllamaCache {
  if (!_cache) {
    _cache = new OllamaCache(endpoint);
  } else {
    _cache.updateEndpoint(endpoint);
  }
  return _cache;
}

// ============================================================
// OllamaTask Class
// ============================================================

/**
 * Task handle for model downloads.
 * Wraps TaskManager task for HQL API.
 */
class OllamaTask implements OllamaTaskHandle {
  private taskId: string;
  private endpoint: string;

  constructor(endpoint: string, modelName: string) {
    this.endpoint = endpoint;
    const manager = getTaskManager(endpoint);
    this.taskId = manager.pullModel(modelName);
  }

  get status(): string {
    const task = getTaskManager().getTask(this.taskId);
    return task?.status || "unknown";
  }

  get progress(): { completed?: number; total?: number; percent?: number; status: string } {
    const task = getTaskManager().getTask(this.taskId);
    if (!task?.progress) return { status: "unknown" };
    const p = task.progress as PullProgress;
    return {
      completed: p.completed,
      total: p.total,
      percent: p.percent,
      status: p.status,
    };
  }

  cancel(): boolean {
    return getTaskManager().cancel(this.taskId);
  }

  async await(): Promise<void> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const task = getTaskManager().getTask(this.taskId);
        if (!task) {
          reject(new Error("Task not found"));
          return;
        }
        switch (task.status) {
          case "completed":
            resolve();
            break;
          case "failed":
            reject(task.error || new Error("Pull failed"));
            break;
          case "cancelled":
            reject(new Error("Pull cancelled"));
            break;
          default:
            // Still running, check again
            setTimeout(check, 100);
        }
      };
      check();
    });
  }
}

// ============================================================
// Ollama API Functions - 100% SSOT via ai.models API
// ============================================================

// Type for ai.models API
type AiModelsApi = {
  models: {
    list: () => Promise<{ name: string; size?: number; modifiedAt?: Date; digest?: string }[]>;
    get: (name: string) => Promise<{
      name?: string;
      size?: number;
      modifiedAt?: Date;
      digest?: string;
      details?: Record<string, unknown>;
      capabilities?: string[];
      modelfile?: string;
    } | null>;
    remove: (name: string) => Promise<boolean>;
  };
} | undefined;

/**
 * Fetch local models - 100% SSOT via ai.models.list()
 */
async function fetchLocalModels(_endpoint: string): Promise<OllamaLocalModel[]> {
  try {
    // 100% SSOT: Use ai.models API only
    const aiApi = (globalThis as Record<string, unknown>).ai as AiModelsApi;
    if (!aiApi?.models?.list) {
      return []; // API not ready
    }
    const models = await aiApi.models.list();
    return models.map((m) => ({
      name: m.name,
      size: m.size || 0,
      modified: m.modifiedAt?.toISOString() || "",
      digest: m.digest || "",
    }));
  } catch {
    return [];
  }
}

/**
 * Fetch model info - 100% SSOT via ai.models.get()
 */
async function fetchModelInfo(_endpoint: string, name: string): Promise<OllamaModelInfo> {
  // 100% SSOT: Use ai.models API only
  const aiApi = (globalThis as Record<string, unknown>).ai as AiModelsApi;
  if (!aiApi?.models?.get) {
    throw new Error("AI Provider API not initialized");
  }
  const data = await aiApi.models.get(name);
  if (!data) {
    throw new Error(`Model not found: ${name}`);
  }
  return {
    name,
    modified: data.modifiedAt?.toISOString(),
    size: data.size,
    digest: data.digest,
    details: data.details,
    capabilities: data.capabilities,
    modelfile: data.modelfile,
  };
}

/**
 * Delete a model - 100% SSOT via ai.models.remove()
 */
async function removeModel(_endpoint: string, name: string): Promise<{ success: boolean; name: string }> {
  // 100% SSOT: Use ai.models API only
  const aiApi = (globalThis as Record<string, unknown>).ai as AiModelsApi;
  if (!aiApi?.models?.remove) {
    throw new Error("AI Provider API not initialized");
  }
  const success = await aiApi.models.remove(name);
  if (!success) {
    throw new Error(`Failed to delete model: ${name}`);
  }
  return { success: true, name };
}

/**
 * Search models by query (searches scraped catalog of 205 models)
 */
function searchModels(query: string): OllamaRemoteModel[] {
  const q = query.toLowerCase();
  return getScrapedModels().filter(
    (m) =>
      m.name.toLowerCase().includes(q) ||
      (m.description?.toLowerCase().includes(q) ?? false)
  );
}

// ============================================================
// Global Ollama Object
// ============================================================

/**
 * Create the global ollama object.
 * Uses event-driven cache for efficient model list queries.
 */
function createOllamaObject(endpoint: string) {
  const cache = getCache(endpoint);

  return {
    /**
     * All known models (local + popular catalog)
     * Returns Promise<Array> - cached with event-driven invalidation
     */
    get models(): Promise<Array<OllamaLocalModel | OllamaRemoteModel>> {
      return cache.getModels();
    },

    /**
     * Only installed (local) models
     * Returns Promise<Array> - cached with event-driven invalidation
     */
    get local(): Promise<OllamaLocalModel[]> {
      return cache.getLocalModels();
    },

    /**
     * Available models not yet installed
     * Returns Promise<Array> - cached with event-driven invalidation
     */
    get available(): Promise<OllamaRemoteModel[]> {
      return cache.getAvailable();
    },

    /**
     * Pull (download) a model
     * Returns task handle immediately
     */
    pull(name: string): OllamaTaskHandle {
      return new OllamaTask(endpoint, name);
    },

    /**
     * Remove (delete) an installed model
     * Returns Promise - invalidates cache on success
     */
    async remove(name: string): Promise<{ success: boolean; name: string }> {
      const result = await removeModel(endpoint, name);
      // Invalidate cache after successful removal
      cache.invalidate();
      return result;
    },

    /**
     * Get detailed info about a model
     * Returns Promise
     */
    info(name: string): Promise<OllamaModelInfo> {
      return fetchModelInfo(endpoint, name);
    },

    /**
     * Search available models by query
     * Returns array (synchronous, searches catalog)
     */
    search(query: string): OllamaRemoteModel[] {
      return searchModels(query);
    },

    /**
     * Get the current endpoint
     */
    get endpoint(): string {
      return endpoint;
    },

    /**
     * Force refresh the cache (manual invalidation)
     */
    refresh(): void {
      cache.invalidate();
    },
  };
}

// ============================================================
// Initialization
// ============================================================

let initialized = false;

/**
 * Initialize the ollama runtime.
 * Injects `ollama` global object into globalThis.
 * Should be called during config runtime initialization.
 */
export function initOllamaRuntime(endpoint: string = "http://127.0.0.1:11434"): void {
  if (initialized) return;
  initialized = true;

  const ollama = createOllamaObject(endpoint);
  (globalThis as Record<string, unknown>).ollama = ollama;

  // Also initialize TaskManager with endpoint
  getTaskManager(endpoint);
}

/**
 * Update the ollama endpoint.
 * Recreates the global object with new endpoint.
 */
export function updateOllamaEndpoint(endpoint: string): void {
  const ollama = createOllamaObject(endpoint);
  (globalThis as Record<string, unknown>).ollama = ollama;
  getTaskManager(endpoint);
}

/**
 * Get the current ollama object (for internal use)
 */
export function getOllamaRuntime(): ReturnType<typeof createOllamaObject> | undefined {
  return (globalThis as Record<string, unknown>).ollama as ReturnType<typeof createOllamaObject> | undefined;
}
