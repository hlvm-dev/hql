import React from "react";
import Box from "../ink/components/Box.tsx";
import { NoSelect } from "../ink/components/NoSelect.tsx";
import Text from "../ink/components/Text.tsx";
import { Ratchet } from "./design-system/Ratchet.tsx";

type Props = React.PropsWithChildren<{
  height?: number;
}>;

const MessageResponseContext = React.createContext(false);

function MessageResponseProvider(
  { children }: React.PropsWithChildren,
): React.JSX.Element {
  return (
    <MessageResponseContext.Provider value={true}>
      {children}
    </MessageResponseContext.Provider>
  );
}

export function MessageResponse(
  { children, height }: Props,
): React.JSX.Element | null {
  const isNested = React.useContext(MessageResponseContext);
  if (isNested) return <>{children}</>;

  const content = (
    <MessageResponseProvider>
      <Box flexDirection="row" height={height} overflowY="hidden">
        <NoSelect fromLeftEdge flexShrink={0}>
          <Text dimColor>{"  "}⎿</Text>
        </NoSelect>
        <Box flexShrink={1} flexGrow={1}>
          {children}
        </Box>
      </Box>
    </MessageResponseProvider>
  );

  if (height !== undefined) return content;
  return <Ratchet lock="offscreen">{content}</Ratchet>;
}
