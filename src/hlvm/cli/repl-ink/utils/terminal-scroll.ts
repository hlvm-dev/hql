const SGR_MOUSE_RE = /^(?:\x1b)?\[<(\d+);(\d+);(\d+)([mM])$/;

export type TerminalScrollAction =
  | "page-up"
  | "page-down"
  | "home"
  | "end";

export function isTerminalMouseInput(input: string): boolean {
  return SGR_MOUSE_RE.test(input);
}

function normalizeEscapeInput(input: string): string {
  return input.startsWith("\x1b") ? input.slice(1) : input;
}

export function parseTerminalScrollAction(
  input: string,
): TerminalScrollAction | null {
  switch (normalizeEscapeInput(input)) {
    case "[5~":
      return "page-up";
    case "[6~":
      return "page-down";
    case "[H":
    case "[1~":
    case "[7~":
    case "OH":
      return "home";
    case "[F":
    case "[4~":
    case "[8~":
    case "OF":
      return "end";
    default:
      return null;
  }
}

export function isTerminalScrollInput(input: string): boolean {
  return isTerminalMouseInput(input) ||
    parseTerminalScrollAction(input) !== null;
}
