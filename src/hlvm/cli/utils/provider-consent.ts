import { getPlatform } from "../../../platform/platform.ts";
import { log } from "../../api/log.ts";
import {
  extractProvider,
  getProviderApprovalLabel,
} from "../../providers/approval.ts";
import {
  getRuntimeConfig,
  getRuntimeConfigApi,
} from "../../runtime/host-client.ts";
import { readSingleKey } from "./input.ts";

/** Prompt user for one-time consent to use a paid provider, save to config. */
export async function confirmPaidProviderConsent(
  modelId: string,
): Promise<boolean> {
  const provider = extractProvider(modelId);
  if (!provider) return true;

  const label = getProviderApprovalLabel(modelId) ?? provider;

  if (!getPlatform().terminal.stdin.isTerminal()) {
    return false;
  }

  log.raw.log(
    `\nThis model uses your ${label} API key.` +
      `\nAPI calls will be charged to your ${label} account.`,
  );
  log.raw.log("Continue? [y/N] ");

  const key = await readSingleKey();
  log.raw.log("");

  if (key !== "y") {
    return false;
  }

  const configApi = getRuntimeConfigApi();
  const approved = (await getRuntimeConfig()).approvedProviders ?? [];
  if (!approved.includes(provider)) {
    await configApi.set("approvedProviders", [...approved, provider]);
  }
  return true;
}
