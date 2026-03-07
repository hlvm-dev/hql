/**
 * Chat Command - One-shot plain LLM chat (non-agent).
 *
 * CLI shell over the shared /api/chat runtime host path.
 */

import {
  ValidationError,
} from "../../../common/error.ts";
import { generateUUID } from "../../../common/utils.ts";
import { log } from "../../api/log.ts";
import {
  isPaidProvider,
} from "../../providers/approval.ts";
import { confirmPaidProviderConsent } from "../utils/provider-consent.ts";
import { hasHelpFlag } from "../utils/common-helpers.ts";
import {
  parseSessionFlags,
  type SessionInitOptions,
} from "../repl/session/types.ts";
import {
  getRuntimeSession,
  listRuntimeSessions,
  runDirectChatViaHost,
} from "../../runtime/host-client.ts";
import { createRuntimeModelConfigManager } from "../../runtime/model-config.ts";

interface ParsedChatArgs {
  modelOverride?: string;
  query: string;
  session: SessionInitOptions;
}

export function showChatHelp(): void {
  log.raw.log(`
HLVM Chat - Plain non-agent chat

USAGE:
  hlvm chat "<query>"          Send a plain chat message
  hlvm chat --help             Show this help message

OPTIONS:
  --help, -h                   Show this help message
  --model <provider/model>     Use a specific AI model
  --continue, -c               Resume the latest chat session
  --resume, -r <id>            Resume a specific session by id
  --new                        Force a fresh chat session

EXAMPLES:
  hlvm chat "hello"
  hlvm chat --model openai/gpt-4o "summarize this repo"
  hlvm chat --continue "what did we just discuss?"
  hlvm chat --resume 123e4567-e89b-12d3-a456-426614174000 "continue"
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
    if (arg === "--continue" || arg === "-c" || arg === "--new") {
      continue;
    }
    if (arg === "--resume" || arg === "-r") {
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("-")) {
        i++;
      }
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

  const session = parseSessionFlags(args);
  if (session.openPicker) {
    throw new ValidationError(
      "--resume requires a session id for `hlvm chat`",
      "chat",
    );
  }

  return {
    modelOverride,
    query,
    session,
  };
}

export async function resolveChatSessionId(
  session: SessionInitOptions,
): Promise<string> {
  if (session.forceNew) {
    return generateUUID();
  }
  if (session.resumeId) {
    const existing = await getRuntimeSession(session.resumeId);
    if (!existing) {
      throw new ValidationError(
        `Session not found: ${session.resumeId}`,
        "chat",
      );
    }
    return session.resumeId;
  }
  if (session.continue) {
    return (await listRuntimeSessions())[0]?.id ?? generateUUID();
  }
  return generateUUID();
}

export async function chatCommand(args: string[]): Promise<void> {
  if (hasHelpFlag(args)) {
    showChatHelp();
    return;
  }

  const parsedArgs = parseChatArgs(args);
  const runtimeModelConfig = await createRuntimeModelConfigManager();

  if (!parsedArgs.modelOverride && !runtimeModelConfig.getConfig().modelConfigured) {
    await runtimeModelConfig.autoConfigureInitialClaudeCodeModel();
  }
  if (!parsedArgs.modelOverride) {
    await runtimeModelConfig.reconcileConfiguredClaudeCodeModel();
  }

  let resolvedModel = parsedArgs.modelOverride ??
    runtimeModelConfig.getConfiguredModel();
  resolvedModel = await runtimeModelConfig.resolveCompatibleClaudeCodeModel(
    resolvedModel,
  );

  if (
    isPaidProvider(resolvedModel) &&
    !runtimeModelConfig.isProviderApproved(resolvedModel)
  ) {
    const consented = await confirmPaidProviderConsent(resolvedModel);
    if (!consented) {
      log.raw.log("Aborted.");
      return;
    }
  }

  const sessionId = await resolveChatSessionId(parsedArgs.session);

  let wroteOutput = false;
  const result = await runDirectChatViaHost({
    query: parsedArgs.query,
    model: resolvedModel,
    sessionId,
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
