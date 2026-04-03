/**
 * HLVM Runtime Initialization System
 *
 * This module provides a centralized system for tracking and managing
 * initialization states of various HLVM runtime components.
 *
 * SSOT: This is the ONLY entry point for runtime initialization.
 * All other code should use initializeRuntime() from this module.
 */

import { globalLogger as logger } from "../logger.ts";
import { getPlatform } from "../platform/platform.ts";
import { copyNeighborFiles, processHqlFile } from "./hlvm-cache-tracker.ts";
import { getErrorMessage } from "./utils.ts";
import { initializeRuntimeHelpers } from "./runtime-helpers.ts";
import { initAIRuntime } from "../hlvm/runtime/ai-runtime.ts";
import { config } from "../hlvm/api/config.ts";
import { initContext } from "../hlvm/cli/repl/context.ts";
import { runtimeProgress } from "./runtime-progress.ts";
// Note: Model installation is now handled by the REPL's ModelSetupOverlay
// for better UX with progress display. See useInitialization.ts

/**
 * Options for partial runtime initialization.
 * All options default to true if not specified.
 */
export interface InitOptions {
  /** Initialize runtime helpers (required for most operations) */
  helpers?: boolean;
  /** Load configuration from file */
  config?: boolean;
  /** Initialize standard library */
  stdlib?: boolean;
  /** Initialize cache system */
  cache?: boolean;
  /** Initialize AI runtime (Ollama) */
  ai?: boolean;
  /** Initialize REPL context on globalThis */
  context?: boolean;
}

// Runtime component initialization states
interface InitializationState {
  stdlib: boolean;
  cache: boolean;
  // Add other components as needed
}

// Singleton instance to track runtime initialization
class HlvmRuntimeInitializer {
  private state: InitializationState = {
    stdlib: false,
    cache: false,
  };

  private initPromises: Partial<
    Record<keyof InitializationState, Promise<void>>
  > = {};

  /**
   * Check if a specific component is initialized
   */
  public isInitialized(component: keyof InitializationState): boolean {
    return this.state[component];
  }

  /**
   * Initialize all core components
   * @param options - Partial initialization options (all default to true)
   */
  public async initializeRuntime(options?: InitOptions): Promise<void> {
    const opts: Required<InitOptions> = {
      helpers: true,
      config: true,
      stdlib: true,
      cache: true,
      ai: true,
      context: true,
      ...options,
    };

    logger.debug &&
      logger.debug(
        `Initializing HLVM runtime with options: ${JSON.stringify(opts)}`,
      );

    let step = 0;
    const totalSteps = [
      opts.helpers,
      opts.config,
      opts.context,
      opts.stdlib || opts.cache,
      opts.ai,
    ].filter(Boolean).length;

    // Initialize runtime helpers (usually required)
    if (opts.helpers) {
      step++;
      runtimeProgress.emit("helpers", "Initializing runtime helpers", step, totalSteps);
      initializeRuntimeHelpers();
    }

    // Load configuration
    if (opts.config) {
      step++;
      runtimeProgress.emit("config", "Loading configuration", step, totalSteps);
      try {
        await config.reload();
      } catch (error) {
        logger.debug(
          `Config load failed (using defaults): ${getErrorMessage(error)}`,
        );
      }
    }

    // Initialize REPL context on globalThis
    if (opts.context) {
      step++;
      runtimeProgress.emit("context", "Initializing REPL context", step, totalSteps);
      initContext();
    }

    // Initialize stdlib and cache in parallel (if enabled)
    if (opts.stdlib || opts.cache) {
      step++;
      runtimeProgress.emit("stdlib", "Loading standard library", step, totalSteps);
      const parallelInits: Promise<void>[] = [];
      if (opts.stdlib) {
        parallelInits.push(this.initializeComponent("stdlib", this._initializeStdlib.bind(this)));
      }
      if (opts.cache) {
        parallelInits.push(this.initializeComponent("cache", this._initializeCache.bind(this)));
      }
      await Promise.all(parallelInits);
    }

    // Initialize AI runtime (checks if Ollama is running, starts if embedded)
    if (opts.ai) {
      step++;
      runtimeProgress.emit("ai", "Starting AI engine", step, totalSteps);
      try {
        await initAIRuntime();
      } catch (error) {
        // AI initialization is optional - don't fail if it doesn't work
        // Log the actual error for debugging purposes
        logger.debug(
          `AI runtime not available (optional): ${getErrorMessage(error)}`,
        );
      }
    }

    // Note: Default model installation is handled by REPL's ModelSetupOverlay
    // This provides better UX with progress display instead of blocking here

    runtimeProgress.emit("complete", "Runtime ready", totalSteps, totalSteps);
    logger.debug("HLVM runtime initialization complete");
  }

  /**
   * Initialize a component with deduplication guard (idempotent, concurrent-safe).
   * Consolidates the repeated init-guard pattern from initializeStdlib/initializeCache.
   */
  private async initializeComponent(
    key: keyof InitializationState,
    init: () => Promise<void>,
  ): Promise<void> {
    if (this.initPromises[key]) return this.initPromises[key]!;
    if (this.state[key]) return;

    this.initPromises[key] = init();
    try {
      await this.initPromises[key];
      this.state[key] = true;
    } finally {
      delete this.initPromises[key];
    }
  }

  /** Initialize the standard library */
  public initializeStdlib(): Promise<void> {
    return this.initializeComponent("stdlib", this._initializeStdlib.bind(this));
  }

  /** Initialize the cache system */
  public initializeCache(): Promise<void> {
    return this.initializeComponent("cache", this._initializeCache.bind(this));
  }

  /**
   * Internal function to initialize stdlib
   */
  private async _initializeStdlib(): Promise<void> {
    logger.debug("Initializing standard library...");

    // Check if running from compiled binary with embedded packages
    let embeddedStdlib: string | undefined;
    try {
      const embeddedModule = await import("../hql/embedded-packages.ts");
      embeddedStdlib = embeddedModule.EMBEDDED_PACKAGES
        ?.["@hlvm/lib/stdlib/stdlib.hql"];
    } catch (error) {
      // No embedded packages available - this is expected in development mode
      logger.debug(`No embedded packages available: ${getErrorMessage(error)}`);
    }

    // If stdlib is embedded, we're done (no file processing needed)
    if (embeddedStdlib) {
      logger.debug("Using embedded stdlib (binary mode)");
      return;
    }

    let stdlibSource = "";

    // Try to find stdlib in various locations (development mode)
    const p = getPlatform();
    const macroRegistryDir = p.path.dirname(
      p.path.fromFileUrl(import.meta.url),
    );
    const possibleLocations = [
      p.path.join(macroRegistryDir, "../../lib/stdlib/stdlib.hql"),
      p.path.join(macroRegistryDir, "../../../lib/stdlib/stdlib.hql"),
      p.path.join(macroRegistryDir, "../../../core/lib/stdlib/stdlib.hql"),
    ];

    for (const location of possibleLocations) {
      if (await p.fs.exists(location)) {
        stdlibSource = location;
        break;
      }
    }

    if (!stdlibSource) {
      logger.debug("Stdlib not found (optional - using embedded packages)");
      return;
    }

    logger.debug(`Found stdlib at: ${stdlibSource}`);

    try {
      // Process the stdlib file
      const cachedPath = await processHqlFile(stdlibSource);
      logger.debug(`Processed stdlib to: ${cachedPath}`);

      // Copy any JS implementations associated with the stdlib
      await copyNeighborFiles(
        stdlibSource,
        getPlatform().path.join(cachedPath, ".."),
      );

      logger.debug("Standard library initialization complete");
    } catch (error) {
      logger.error(`Error initializing stdlib: ${getErrorMessage(error)}`);
      throw error; // Re-throw to properly mark initialization as failed
    }
  }

  /**
   * Internal function to initialize cache
   */
  private _initializeCache(): Promise<void> {
    logger.debug("Cache system initialized");
    return Promise.resolve();
  }
}

const runtimeInitializer = new HlvmRuntimeInitializer();

/**
 * SSOT entry point for runtime initialization.
 * This is the ONLY function that should be used to initialize the runtime.
 *
 * @param options - Partial initialization options (all default to true)
 *
 * @example
 * // Full initialization (default)
 * await initializeRuntime();
 *
 * @example
 * // Config-only initialization (no AI startup)
 * await initializeRuntime({ ai: false });
 *
 * @example
 * // Minimal initialization
 * await initializeRuntime({ helpers: true, config: true, stdlib: false, cache: false, ai: false });
 */
export async function initializeRuntime(options?: InitOptions): Promise<void> {
  await runtimeInitializer.initializeRuntime(options);
}
