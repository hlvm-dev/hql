/**
 * Ansi shim — vendored CC fork used a custom ANSI tokenizer + nested Text
 * renderers. Upstream Ink's Text passes ANSI escape sequences through to
 * stdout where the terminal interprets them. For most chalk-styled output
 * this works as-is.
 */
import React, { type PropsWithChildren } from "react";
import { Text } from "ink";

type Props = PropsWithChildren<{ dimColor?: boolean }>;

export function Ansi({ children, dimColor }: Props): React.ReactElement {
  return <Text dimColor={dimColor}>{children as string}</Text>;
}
