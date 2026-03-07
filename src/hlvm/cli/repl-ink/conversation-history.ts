import type { SessionMessage } from "../repl/session/types.ts";
import type { ConversationItem } from "./types.ts";

export function buildConversationItemsFromSessionMessages(
  messages: readonly SessionMessage[],
): ConversationItem[] {
  return messages.map((message, index) => {
    if (message.role === "user") {
      return {
        type: "user",
        id: `session-user-${index}`,
        text: message.content,
        ts: message.ts,
      };
    }

    return {
      type: "assistant",
      id: `session-assistant-${index}`,
      text: message.content,
      isPending: false,
      ts: message.ts,
    };
  });
}
