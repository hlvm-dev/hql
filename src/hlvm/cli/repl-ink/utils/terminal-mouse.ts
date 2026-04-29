const SGR_MOUSE_RE = /^(?:\x1b)?\[<(\d+);(\d+);(\d+)([mM])$/;
const SGR_MOUSE_GLOBAL_RE = /\x1b?\[<(\d+);(\d+);(\d+)([mM])/g;

export type TerminalScrollAction =
  | "page-up"
  | "page-down"
  | "home"
  | "end";

export type TerminalMouseWheelDirection = "up" | "down" | "left" | "right";

export interface TerminalMouseWheelEvent {
  direction: TerminalMouseWheelDirection;
  x: number;
  y: number;
}

export function parseTerminalMouseWheel(
  input: string,
): TerminalMouseWheelEvent | null {
  const match = SGR_MOUSE_RE.exec(input);
  if (!match) return null;
  if (match[4] !== "M") return null;

  const buttonCode = Number.parseInt(match[1]!, 10);
  const x = Number.parseInt(match[2]!, 10);
  const y = Number.parseInt(match[3]!, 10);
  if (!Number.isFinite(buttonCode) || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  const wheelCode = buttonCode & 0b11;
  if ((buttonCode & 64) !== 64) return null;

  switch (wheelCode) {
    case 0:
      return { direction: "up", x, y };
    case 1:
      return { direction: "down", x, y };
    case 2:
      return { direction: "left", x, y };
    case 3:
      return { direction: "right", x, y };
    default:
      return null;
  }
}

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
  return isTerminalMouseInput(input) || parseTerminalScrollAction(input) !== null;
}

export function getWheelScrollRows(
  input: string,
  rowsPerNotch: number,
): number {
  const event = parseTerminalMouseWheel(input);
  if (!event) return 0;
  if (event.direction === "up") return -rowsPerNotch;
  if (event.direction === "down") return rowsPerNotch;
  return 0;
}

export function getWheelScrollRowsFromInput(
  input: string,
  rowsPerNotch: number,
): number {
  let rows = 0;
  for (const match of input.matchAll(SGR_MOUSE_GLOBAL_RE)) {
    const packet = `${match[0]}`;
    rows += getWheelScrollRows(packet, rowsPerNotch);
  }
  return rows;
}
