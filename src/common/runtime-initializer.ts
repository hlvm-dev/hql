/**
 * HLVM Runtime Initialization System
 *
 * This module provides a centralized system for tracking and managing
 * initialization states of various HLVM runtime components.
 */

import { globalLogger as logger } from "../logger.ts";
import { getPlatform } from "../platform/platform.ts";
import { copyNeighborFiles, processHqlFile } from "./hlvm-cache-tracker.ts";
import { getErrorMessage } from "./utils.ts";
import { initializeRuntimeHelpers } from "./runtime-helpers.ts";
import { initAIRuntime } from "../hlvm/runtime/ai-runtime.ts";
import { config } from "../hlvm/api/config.ts";
// Note: Model installation is now handled by the REPL's ModelSetupOverlay
// for better UX with progress display. See useInitialization.ts

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
   */
  public async initializeRuntime(): Promise<void> {
    logger.debug("Initializing HLVM runtime...");

    initializeRuntimeHelpers();

    try {
      await config.reload();
    } catch (error) {
      logger.debug(`Config load failed (using defaults): ${getErrorMessage(error)}`);
    }

    // Initialize components in parallel
    await Promise.all([
      this.initializeStdlib(),
      this.initializeCache(),
    ]);

    // Initialize AI runtime (checks if Ollama is running, starts if embedded)
    try {
      await initAIRuntime();
    } catch (error) {
      // AI initialization is optional - don't fail if it doesn't work
      // Log the actual error for debugging purposes
      logger.debug(`AI runtime not available (optional): ${getErrorMessage(error)}`);
    }

    // Note: Default model installation is handled by REPL's ModelSetupOverlay
    // This provides better UX with progress display instead of blocking here

    logger.debug("HLVM runtime initialization complete");
  }

  /**
   * Initialize the standard library
   */
  public async initializeStdlib(): Promise<void> {
    // Return existing promise if initialization is in progress
    if (this.initPromises.stdlib) {
      return this.initPromises.stdlib;
    }

    // Skip if already initialized
    if (this.state.stdlib) {
      return;
    }

    // Create and store the promise
    this.initPromises.stdlib = this._initializeStdlib();

    try {
      await this.initPromises.stdlib;
      this.state.stdlib = true;
    } finally {
      // Clear the promise reference after completion (success or failure)
      delete this.initPromises.stdlib;
    }
  }

  /**
   * Initialize the cache system
   */
  public async initializeCache(): Promise<void> {
    // Return existing promise if initialization is in progress
    if (this.initPromises.cache) {
      return this.initPromises.cache;
    }

    // Skip if already initialized
    if (this.state.cache) {
      return;
    }

    // Create and store the promise
    this.initPromises.cache = this._initializeCache();

    try {
      await this.initPromises.cache;
      this.state.cache = true;
    } finally {
      // Clear the promise reference after completion (success or failure)
      delete this.initPromises.cache;
    }
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
      embeddedStdlib = embeddedModule.EMBEDDED_PACKAGES?.["@hlvm/lib/stdlib/stdlib.hql"];
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
    const macroRegistryDir = p.path.dirname(p.path.fromFileUrl(import.meta.url));
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
      await copyNeighborFiles(stdlibSource, getPlatform().path.join(cachedPath, ".."));

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

export async function initializeRuntime(): Promise<void> {
  await runtimeInitializer.initializeRuntime();
}
