import { isBalanced } from "../../cli/repl/syntax.ts";

export type InputMode = "chat" | "code";

export type InputClassification =
  | { kind: "conversation" }
  | { kind: "hql_eval" }
  | { kind: "js_eval" }
  | { kind: "command"; name: string; args: string }
  | { kind: "shell"; command: string }
  | { kind: "noop" };

export function classifyInput(raw: string, mode: InputMode): InputClassification {
  const input = raw.trim();
  if (input.length === 0) return { kind: "noop" };
  if (input.startsWith("/")) {
    const spaceIdx = input.indexOf(" ");
    if (spaceIdx === -1) return { kind: "command", name: input.slice(1), args: "" };
    return { kind: "command", name: input.slice(1, spaceIdx), args: input.slice(spaceIdx + 1) };
  }
  if (input.startsWith("!")) return { kind: "shell", command: input.slice(1) };
  if (input.startsWith("(") && isBalanced(input)) return { kind: "hql_eval" };
  if (mode === "code") return { kind: "js_eval" };
  return { kind: "conversation" };
}
