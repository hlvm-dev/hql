/**
 * Computer Use — Barrel Re-export
 */

// Tool definitions for registry
export { COMPUTER_USE_TOOLS } from "./tools.ts";

// Executor (CC clone)
export { createCliExecutor, unhideComputerUseApps } from "./executor.ts";
export type { ComputerExecutor } from "./types.ts";

// Lock (CC clone)
export {
  tryAcquireComputerUseLock,
  releaseComputerUseLock,
  checkComputerUseLock,
  isLockHeldLocally,
  acquireLock,
  releaseLock,
} from "./lock.ts";
export type { AcquireResult, CheckResult } from "./lock.ts";

// Cleanup (CC clone)
export { cleanupComputerUseAfterTurn, cleanupComputerUse } from "./cleanup.ts";

// App names (CC clone — verbatim)
export { filterAppsForDescription } from "./app-names.ts";

// Common (CC clone)
export {
  CLI_HOST_BUNDLE_ID,
  CLI_CU_CAPABILITIES,
  getTerminalBundleId,
} from "./common.ts";

// Backend resolution (native GUI vs JXA fallback)
export {
  resolveBackend,
  invalidateBackendResolution,
  getResolvedBackend,
  upgradeSwiftInstanceToNative,
} from "./bridge.ts";
export type { CUBackendResolution, CUNativeCapabilities } from "./types.ts";
