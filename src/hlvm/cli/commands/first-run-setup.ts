/**
 * First-run setup now follows the same Gemma-first policy as the runtime host:
 * prepare the embedded local AI substrate and return the default local model.
 */

import { log } from "../../api/log.ts";
import { DEFAULT_MODEL_ID } from "../../../common/config/types.ts";
import type { AIEngineLifecycle } from "../../runtime/ai-runtime.ts";
import { materializeBootstrap } from "../../runtime/bootstrap-materialize.ts";
import { parseModelString } from "../../providers/index.ts";
import { ANSI_COLORS } from "../ansi.ts";
import { getPlatform } from "../../../platform/platform.ts";

const { RESET, BOLD, CYAN, DIM, GREEN } = ANSI_COLORS;

function isInteractiveTerminal(): boolean {
  return getPlatform().terminal.stdin.isTerminal();
}

function style(message: string, ...codes: string[]): string {
  if (!isInteractiveTerminal()) return message;
  return `${codes.join("")}${message}${RESET}`;
}

function printSetupBanner(): void {
  log.raw.log(style("============================================================", CYAN));
  log.raw.log(style("Preparing local Gemma fallback for HLVM...", BOLD, CYAN));
  log.raw.log("Fresh installs now default to the bundled local model.");
  log.raw.log(style("============================================================", CYAN));
  log.raw.log("");
}

export async function runFirstTimeSetup(
  _engine?: AIEngineLifecycle,
): Promise<string | null> {
  printSetupBanner();

  try {
    const [, modelName] = parseModelString(DEFAULT_MODEL_ID);
    log.raw.log(style("[1/2] Bootstrapping embedded local AI...", BOLD, CYAN));
    await materializeBootstrap({
      onProgress: (progress) => {
        const suffix = typeof progress.percent === "number"
          ? ` ${progress.percent}%`
          : "";
        log.raw.log(style(`  -> ${progress.message}${suffix}`, DIM));
      },
    });

    log.raw.log(style("[2/2] Selecting default local model...", BOLD, CYAN));
    log.raw.log(style(`  -> ${modelName} is now the default HLVM model.`, GREEN));
    return DEFAULT_MODEL_ID;
  } catch (error) {
    log.error(
      `Local AI setup failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
