import { truncate, truncateMiddle } from "../../common/utils.ts";
import type { Message } from "./context.ts";

const ASSISTANT_EXCERPT_CHARS = 2_000;
const TOOL_EXCERPT_CHARS = 1_000;
const USER_EXCERPT_CHARS = 6_000;
const PATH_REGEX =
  /(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+(?:\.[A-Za-z0-9_.-]+)?/g;
const SYMBOL_REGEX = /\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g;

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

function collectFiles(messages: Message[]): string[] {
  const matches: string[] = [];
  for (const message of messages) {
    for (const match of message.content.match(PATH_REGEX) ?? []) {
      matches.push(match);
    }
  }
  return uniq(matches).slice(0, 20);
}

function collectSymbols(messages: Message[]): string[] {
  const matches: string[] = [];
  for (const message of messages) {
    if (message.role === "user") continue;
    for (const match of message.content.match(SYMBOL_REGEX) ?? []) {
      if (match.length > 48) continue;
      matches.push(match);
    }
  }
  return uniq(matches).slice(0, 20);
}

function excerptMessage(message: Message): string {
  if (message.role === "user") {
    return message.content.trim();
  }
  if (message.role === "assistant") {
    return truncateMiddle(message.content.trim(), ASSISTANT_EXCERPT_CHARS);
  }
  return truncateMiddle(message.content.trim(), TOOL_EXCERPT_CHARS);
}

function formatSection(title: string, body: string[]): string {
  const content = body.length > 0 ? body.join("\n") : "- none";
  return `## ${title}\n${content}`;
}

export function buildCompactionPrompt(messages: Message[]): string {
  const userMessages = messages
    .filter((message) => message.role === "user")
    .map((message) => `- ${message.content.trim()}`);
  const primaryRequestMessages = messages
    .filter((message) => message.role === "user")
    .map((message) => `- ${truncate(message.content.trim(), USER_EXCERPT_CHARS)}`);
  const assistantMessages = messages
    .filter((message) => message.role === "assistant")
    .map((message) => `- ${excerptMessage(message)}`);
  const toolMessages = messages
    .filter((message) => message.role === "tool")
    .map((message) =>
      `- ${message.toolName ?? "tool"}: ${excerptMessage(message)}`
    );
  const files = collectFiles(messages).map((path) => `- ${path}`);
  const symbols = collectSymbols(messages).map((symbol) => `- ${symbol}`);
  const errors = messages
    .filter((message) =>
      /\b(error|failed|exception|timeout|diagnostic|warning)\b/i.test(
        message.content,
      )
    )
    .map((message) => `- ${excerptMessage(message)}`)
    .slice(0, 20);

  const sections = [
    formatSection("Primary Request and Intent", primaryRequestMessages.slice(-3)),
    formatSection("Key Technical Concepts", symbols),
    formatSection("Files and Symbols Referenced", [...files, ...symbols]),
    formatSection("Errors and Debugging", errors),
    formatSection("Actions and Problem Solving", [
      ...assistantMessages.slice(-8),
      ...toolMessages.slice(-12),
    ]),
    formatSection(
      "User Messages That Must Be Preserved Verbatim",
      userMessages,
    ),
    formatSection("Pending Tasks / Open Questions", [
      "- Capture unresolved asks, blockers, and explicit follow-ups.",
    ]),
    formatSection("Current Work State", assistantMessages.slice(-4)),
    formatSection("Optional Next Step", [
      "- Describe the next concrete step if one is already implied.",
    ]),
  ];

  return [
    "Summarize the conversation into the structured sections below.",
    "Preserve user intent, files, active tasks, debugging state, and next-step context.",
    "Do not invent facts. Keep it dense and implementation-focused.",
    "",
    ...sections,
  ].join("\n\n");
}
