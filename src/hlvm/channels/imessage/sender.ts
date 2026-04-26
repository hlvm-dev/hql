import { RuntimeError } from "../../../common/error.ts";
import { getPlatform } from "../../../platform/platform.ts";

export interface IMessageSender {
  send(recipientId: string, text: string): Promise<void>;
  sendToChat?(chatIdentifier: string, text: string): Promise<void>;
}

const DEFAULT_ATTRIBUTION_MARKER = "🤖";
const textDecoder = new TextDecoder();

export function createAppleScriptIMessageSender(): IMessageSender {
  return {
    async send(recipientId: string, text: string): Promise<void> {
      await runAppleScriptSend(buildSendScript(recipientId, text));
    },
    async sendToChat(chatIdentifier: string, text: string): Promise<void> {
      await runAppleScriptSend(buildSendToChatScript(chatIdentifier, text));
    },
  };
}

export function formatIMessageReply(
  text: string,
  marker = DEFAULT_ATTRIBUTION_MARKER,
): string {
  const trimmedMarker = marker.trim();
  if (!trimmedMarker) return text;
  return `${trimmedMarker} ${text}`;
}

export function buildSendScript(recipientId: string, text: string): string {
  return [
    'tell application "Messages"',
    "set targetService to first service whose service type = iMessage",
    `set targetBuddy to buddy ${
      toAppleScriptString(recipientId)
    } of targetService`,
    `send ${toAppleScriptString(text)} to targetBuddy`,
    "end tell",
  ].join("\n");
}

export function buildSendToChatScript(
  chatIdentifier: string,
  text: string,
): string {
  return [
    'tell application "Messages"',
    `set targetChat to chat id ${
      toAppleScriptString(
        `any;-;${chatIdentifier}`,
      )
    }`,
    `send ${toAppleScriptString(text)} to targetChat`,
    "end tell",
  ].join("\n");
}

async function runAppleScriptSend(script: string): Promise<void> {
  const result = await getPlatform().command.output({
    cmd: ["osascript", "-e", script],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    timeout: 30_000,
  });
  if (result.success) return;
  const detail = textDecoder.decode(result.stderr).trim() ||
    `osascript exited with code ${result.code}`;
  throw new RuntimeError(`iMessage send failed: ${detail}`);
}

function toAppleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
