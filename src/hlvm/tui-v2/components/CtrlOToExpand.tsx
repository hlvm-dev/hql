import chalk from "chalk";
import React from "react";
import Text from "../ink/components/Text.tsx";
import { InVirtualListContext } from "../transcript/compat/messageActions.ts";

const SubAgentContext = React.createContext(false);

export function SubAgentProvider(
  { children }: { children: React.ReactNode },
): React.ReactNode {
  return (
    <SubAgentContext.Provider value={true}>{children}</SubAgentContext.Provider>
  );
}

export function CtrlOToExpand(): React.ReactNode {
  const isInSubAgent = React.useContext(SubAgentContext);
  const inVirtualList = React.useContext(InVirtualListContext);
  if (isInSubAgent || inVirtualList) return null;

  return <Text dimColor>(ctrl+o to expand)</Text>;
}

export function ctrlOToExpand(): string {
  return chalk.dim("(ctrl+o to expand)");
}
