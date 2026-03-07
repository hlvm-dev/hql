/**
 * Chat Command - One-shot plain LLM chat (non-agent).
 *
 * Thin CLI wrapper over the shared /api/chat direct-chat path.
 */

import {
  autoConfigureInitialClaudeCodeModel,
  getConfiguredModel,
  reconcileConfiguredClaudeCodeModel,
  resolveCompatibleClaudeCodeModel,
} from "../../../common/ai-default-model.ts";
import { ValidationError } from "../../../common/error.ts";
import { generateUUID } from "../../../common/utils.ts";
import { log } from "../../api/log.ts";
import { config } from "../../api/config.ts";
import { ai } from "../../api/ai.ts";
import { parseModelString } from "../../providers/index.ts";
import {
  getOrCreateSession,
  getSession,
  insertMessage,
  listSessions,
  updateSession,
} from "../../store/conversation-store.ts";
import { loadRecentMessages } from "../../store/message-utils.ts";
import type { ModelInfo } from "../../providers/types.ts";
import { hasHelpFlag } from "../utils/common-helpers.ts";
import {
  parseSessionFlags,
  type SessionInitOptions,
} from "../repl/session/types.ts";
import {
  confirmPaidProviderConsent,
  isPaidProvider,
  isProviderApproved,
} from "./ask.ts";
import { handleChatMode } from "../repl/handlers/chat-direct.ts";
import {
  TITLE_SEARCH_HISTORY_LIMIT,
  type ChatRequest,
} from "../repl/handlers/chat-session.ts";

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

export function resolveChatSessionId(session: SessionInitOptions): string {
  if (session.forceNew) {
    return generateUUID();
  }
  if (session.resumeId) {
    if (!getSession(session.resumeId)) {
      throw new ValidationError(
        `Session not found: ${session.resumeId}`,
        "chat",
      );
    }
    return session.resumeId;
  }
  if (session.continue) {
    return listSessions()[0]?.id ?? generateUUID();
  }
  return generateUUID();
}

export async function chatCommand(args: string[]): Promise<void> {
  if (hasHelpFlag(args)) {
    showChatHelp();
    return;
  }

  const parsedArgs = parseChatArgs(args);

  if (!parsedArgs.modelOverride && !config.snapshot.modelConfigured) {
    await autoConfigureInitialClaudeCodeModel();
  }
  if (!parsedArgs.modelOverride) {
    await reconcileConfiguredClaudeCodeModel();
  }

  let resolvedModel = parsedArgs.modelOverride ?? getConfiguredModel();
  resolvedModel = await resolveCompatibleClaudeCodeModel(resolvedModel);

  if (isPaidProvider(resolvedModel) && !isProviderApproved(resolvedModel)) {
    const consented = await confirmPaidProviderConsent(resolvedModel);
    if (!consented) {
      log.raw.log("Aborted.");
      return;
    }
  }

  const modelInfo = await resolveModelInfo(resolvedModel);
  const sessionId = resolveChatSessionId(parsedArgs.session);
  const session = getOrCreateSession(sessionId);

  const requestBody: ChatRequest = {
    mode: "chat",
    session_id: session.id,
    messages: [{ role: "user", content: parsedArgs.query }],
    ...(parsedArgs.modelOverride ? { model: parsedArgs.modelOverride } : {}),
  };

  insertMessage({
    session_id: session.id,
    role: "user",
    content: parsedArgs.query,
    sender_type: "user",
  });
  const assistantMessage = insertMessage({
    session_id: session.id,
    role: "assistant",
    content: "",
    sender_type: "llm",
    sender_detail: resolvedModel,
  });

  let wroteOutput = false;
  await handleChatMode(
    requestBody,
    resolvedModel,
    session.id,
    assistantMessage.id,
    new AbortController().signal,
    () => {},
    (text) => {
      wroteOutput = true;
      log.raw.write(text);
    },
    modelInfo,
  );

  if (wroteOutput) {
    log.raw.write("\n");
  }

  const currentSession = getSession(session.id);
  if (currentSession && !currentSession.title) {
    const recentMessages = loadRecentMessages(
      session.id,
      TITLE_SEARCH_HISTORY_LIMIT,
    );
    const firstUserMessage = recentMessages.find((message) =>
      message.role === "user" && message.content.length > 0
    );
    if (firstUserMessage) {
      const autoTitle = firstUserMessage.content.slice(0, 60).replace(
        /\n/g,
        " ",
      ).trim();
      updateSession(session.id, { title: autoTitle });
    }
  }
}

async function resolveModelInfo(
  resolvedModel: string,
): Promise<ModelInfo | null> {
  const [provider, modelName] = parseModelString(resolvedModel);
  try {
    return await ai.models.get(modelName, provider ?? undefined);
  } catch {
    return null;
  }
}
