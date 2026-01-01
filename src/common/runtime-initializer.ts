/**
 * HQL Runtime Initialization System
 *
 * This module provides a centralized system for tracking and managing
 * initialization states of various HQL runtime components.
 */

import { globalLogger as logger } from "../logger.ts";
import { dirname, exists, fromFileUrl, join } from "../platform/platform.ts";
import { copyNeighborFiles, processHqlFile } from "./hql-cache-tracker.ts";
import { getErrorMessage } from "./utils.ts";
import { initializeRuntimeHelpers } from "./runtime-helpers.ts";
import { initAIRuntime } from "../runtime/ai-runtime.ts";

// Runtime component initialization states
interface InitializationState {
  stdlib: boolean;
  cache: boolean;
  // Add other components as needed
}

// Singleton instance to track runtime initialization
class HqlRuntimeInitializer {
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
    logger.debug("Initializing HQL runtime...");

    initializeRuntimeHelpers();

    // Initialize components in parallel
    await Promise.all([
      this.initializeStdlib(),
      this.initializeCache(),
    ]);

    // Initialize AI runtime (checks if Ollama is running, starts if embedded)
    try {
      await initAIRuntime();
    } catch {
      // AI initialization is optional - don't fail if it doesn't work
      logger.debug("AI runtime not available (optional)");
    }

    logger.debug("HQL runtime initialization complete");
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
    logger.debug("Initializing HQL standard library...");

    // Check if running from compiled binary with embedded packages
    let embeddedStdlib: string | undefined;
    try {
      const embeddedModule = await import("../embedded-packages.ts");
      embeddedStdlib = embeddedModule.EMBEDDED_PACKAGES?.["@hql/lib/stdlib/stdlib.hql"];
    } catch {
      // No embedded packages available
    }

    // If stdlib is embedded, we're done (no file processing needed)
    if (embeddedStdlib) {
      logger.debug("Using embedded stdlib (binary mode)");
      return;
    }

    let stdlibSource = "";

    // Try to find stdlib in various locations (development mode)
    const macroRegistryDir = dirname(fromFileUrl(import.meta.url));
    const possibleLocations = [
      join(macroRegistryDir, "../../lib/stdlib/stdlib.hql"),
      join(macroRegistryDir, "../../../lib/stdlib/stdlib.hql"),
      join(macroRegistryDir, "../../../core/lib/stdlib/stdlib.hql"),
    ];

    for (const location of possibleLocations) {
      if (await exists(location)) {
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
      await copyNeighborFiles(stdlibSource, join(cachedPath, ".."));

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

const runtimeInitializer = new HqlRuntimeInitializer();

export async function initializeRuntime(): Promise<void> {
  await runtimeInitializer.initializeRuntime();
}
