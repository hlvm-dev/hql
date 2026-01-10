/**
 * Clickable Terminal Link Component
 *
 * Uses OSC 8 hyperlink escape sequences to make text clickable.
 * Supported by: iTerm2, Terminal.app, Windows Terminal, GNOME Terminal, etc.
 *
 * Format: \x1b]8;;URL\x07TEXT\x1b]8;;\x07
 */

import React from "npm:react@18";
import { Text } from "npm:ink@5";

interface LinkProps {
  /** The URL to link to */
  url: string;
  /** Optional display text (defaults to URL) */
  children?: React.ReactNode;
  /** Text color */
  color?: string;
  /** Whether to show as dimmed */
  dimColor?: boolean;
}

/**
 * Clickable hyperlink for terminal.
 *
 * @example
 * <Link url="https://ollama.com/library/llama">ollama.com/library/llama</Link>
 */
export function Link({ url, children, color, dimColor }: LinkProps): React.ReactElement {
  // Ensure URL has protocol for clickability
  const fullUrl = url.startsWith("http") ? url : `https://${url}`;

  // OSC 8 hyperlink: \x1b]8;;URL\x07 TEXT \x1b]8;;\x07
  const linkStart = `\x1b]8;;${fullUrl}\x07`;
  const linkEnd = "\x1b]8;;\x07";

  return (
    <Text color={color} dimColor={dimColor}>
      {linkStart}{children ?? url}{linkEnd}
    </Text>
  );
}
