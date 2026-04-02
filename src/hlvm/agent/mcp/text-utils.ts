const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const COMBINING_MARK_RE = /\p{Mark}/u;
const MAX_COMBINING_MARK_RUN = 16;
const MAX_MCP_DESCRIPTION_CHARS = 2048;

export function sanitizeMcpText(value: string): string {
  const stripped = value.replace(CONTROL_CHARS_RE, "");
  let combiningRun = 0;
  return Array.from(stripped).filter((char) => {
    if (COMBINING_MARK_RE.test(char)) {
      combiningRun += 1;
      return combiningRun <= MAX_COMBINING_MARK_RUN;
    }
    combiningRun = 0;
    return true;
  }).join("");
}

export function capMcpDescription(
  description: string | undefined,
): string | undefined {
  if (!description) return description;
  const sanitized = sanitizeMcpText(description).trim();
  if (sanitized.length <= MAX_MCP_DESCRIPTION_CHARS) {
    return sanitized;
  }
  return sanitized.slice(0, MAX_MCP_DESCRIPTION_CHARS - 3) + "...";
}
