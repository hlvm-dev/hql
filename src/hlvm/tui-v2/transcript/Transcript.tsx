import React from "react";
import Box from "../ink/components/Box.tsx";
import UserMessage from "./UserMessage.tsx";
import AssistantMessage from "./AssistantMessage.tsx";
import ToolGroupItem from "./ToolGroupItem.tsx";
import ThinkingItem from "./ThinkingItem.tsx";
import TurnStatsItem from "./TurnStatsItem.tsx";
import ErrorItem from "./ErrorItem.tsx";
import InfoItem from "./InfoItem.tsx";
import EvalResultItem from "./EvalResultItem.tsx";

// deno-lint-ignore no-explicit-any
type ConversationItem = { type: string; id: string; [key: string]: any };

function renderItem(item: ConversationItem) {
  switch (item.type) {
    case "user":
      return <UserMessage key={item.id} item={item as any} />;
    case "assistant":
      return <AssistantMessage key={item.id} item={item as any} />;
    case "tool_group":
      return <ToolGroupItem key={item.id} item={item as any} />;
    case "thinking":
      return <ThinkingItem key={item.id} item={item as any} />;
    case "turn_stats":
      return <TurnStatsItem key={item.id} item={item as any} />;
    case "error":
      return <ErrorItem key={item.id} item={item as any} />;
    case "info":
      return <InfoItem key={item.id} item={item as any} />;
    case "hql_eval":
      return <EvalResultItem key={item.id} item={item as any} />;
    default:
      return null;
  }
}

interface TranscriptProps {
  items: ConversationItem[];
}

export default function Transcript({ items }: TranscriptProps) {
  return (
    <Box flexDirection="column" flexGrow={1}>
      {items.map(renderItem)}
    </Box>
  );
}
