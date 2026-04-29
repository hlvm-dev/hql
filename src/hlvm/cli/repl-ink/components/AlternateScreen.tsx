import React, { type PropsWithChildren } from "react";

export function AlternateScreen(
  { children }: PropsWithChildren,
): React.ReactElement {
  return <>{children}</>;
}
