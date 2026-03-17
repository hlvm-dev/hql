/**
 * Chat Command - One-shot plain LLM chat (non-agent).
 *
 * CLI shell over the shared /api/chat runtime host path.
 */

import { ValidationError } from "../../../common/error.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { log } from "../../api/log.ts";
import { confirmPaidProviderConsent } from "../utils/provider-consent.ts";
import { hasHelpFlag } from "../utils/common-helpers.ts";
import { runDirectChatViaHost } from "../../runtime/host-client.ts";
import { createRuntimeConfigManager } from "../../runtime/model-config.ts";

interface ParsedChatArgs {
  modelOverride?: string;
  query: string;
}

export function showChatHelp(): void {
  log.raw.log(`
HLVM Chat - Plain non-agent chat

USAGE:
  hlvm chat "<query>"          Continue the latest global chat
  hlvm chat --help             Show this help message

OPTIONS:
  --help, -h                   Show this help message
  --model <provider/model>     Use a specific AI model

EXAMPLES:
  hlvm chat "hello"
  hlvm chat --model openai/gpt-4o "summarize this repo"
`);
}

export function parseChatArgs(args: string[]): ParsedChatArgs {
  let modelOverride: string | undefined;
  const queryParts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--model") {
      i++;
      if (i >= args.length) {
        throw new ValidationError(
          "--model requires a value (e.g. openai/gpt-4o)",
          "chat",
        );
      }
      modelOverride = args[i];
      continue;
    }
    if (arg.startsWith("-")) {
      throw new ValidationError(`Unknown option: ${arg}`, "chat");
    }
    queryParts.push(arg);
  }

  const query = queryParts.join(" ").trim();
  if (!query) {
    throw new ValidationError(
      'Missing query. Usage: hlvm chat "<query>"',
      "chat",
    );
  }

  return {
    modelOverride,
    query,
  };
}

export async function chatCommand(args: string[]): Promise<void> {
  if (hasHelpFlag(args)) {
    showChatHelp();
    return;
  }

  const parsedArgs = parseChatArgs(args);
  const runtimeConfig = await createRuntimeConfigManager();

  if (!parsedArgs.modelOverride) {
    await runtimeConfig.ensureInitialModelConfigured({
      allowFirstRunSetup: getPlatform().terminal.stdin.isTerminal(),
      runFirstTimeSetup: async () => {
        const { runFirstTimeSetup } = await import("./first-run-setup.ts");
        return await runFirstTimeSetup();
      },
    });
  }

  let resolvedModel = parsedArgs.modelOverride ??
    runtimeConfig.getConfiguredModel();
  resolvedModel = await runtimeConfig.resolveCompatibleClaudeCodeModel(
    resolvedModel,
  );

  if (
    runtimeConfig.evaluateProviderApproval(resolvedModel).status ===
      "approval_required"
  ) {
    const consented = await confirmPaidProviderConsent(resolvedModel, runtimeConfig);
    if (!consented) {
      log.raw.log("Aborted.");
      return;
    }
  }

  let wroteOutput = false;
  const result = await runDirectChatViaHost({
    query: parsedArgs.query,
    model: resolvedModel,
    callbacks: {
      onToken: (text) => {
        wroteOutput = true;
        log.raw.write(text);
      },
    },
  });

  if (wroteOutput) {
    log.raw.write("\n");
  } else if (result.text.trim()) {
    log.raw.log(`${result.text}\n`);
  }
}
