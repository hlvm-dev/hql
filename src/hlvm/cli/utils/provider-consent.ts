import { getPlatform } from "../../../platform/platform.ts";
import { log } from "../../api/log.ts";
import {
  createRuntimeConfigManager,
  type RuntimeConfigManager,
} from "../../runtime/model-config.ts";
import { readSingleKey } from "./input.ts";

/** Prompt user for one-time consent to use a paid provider, save to config. */
export async function confirmPaidProviderConsent(
  modelId: string,
  runtimeConfig?: RuntimeConfigManager,
): Promise<boolean> {
  const configManager = runtimeConfig ?? await createRuntimeConfigManager();
  const decision = configManager.evaluateProviderApproval(modelId);
  if (decision.status !== "approval_required") {
    return true;
  }

  if (!getPlatform().terminal.stdin.isTerminal()) {
    return false;
  }

  log.raw.log(
    `\nThis model uses your ${decision.label} API key.` +
      `\nAPI calls will be charged to your ${decision.label} account.`,
  );
  log.raw.log("Continue? [y/N] ");

  const key = await readSingleKey();
  log.raw.log("");

  if (key !== "y") {
    return false;
  }

  await configManager.approveProvider(decision.provider);
  return true;
}
