import React from "react";
import type { ScrollBoxHandle } from "../ink/components/ScrollBox.tsx";
import {
  InVirtualListContext,
  isNavigableMessage,
  type MessageActionsNav,
  MessageActionsSelectedContext,
  type MessageActionsState,
  toolCallOf,
} from "./compat/messageActions.ts";
import { type JumpHandle, VirtualMessageList } from "./VirtualMessageList.tsx";
import { MessageRow } from "./MessageRow.tsx";
import type { RenderableTranscriptMessage } from "./types.ts";

type Props = {
  messages: RenderableTranscriptMessage[];
  scrollRef: React.RefObject<ScrollBoxHandle | null>;
  columns: number;
  selectedIndex: number;
  cursor: MessageActionsState | null;
  setCursor: React.Dispatch<React.SetStateAction<MessageActionsState | null>>;
  cursorNavRef: React.Ref<MessageActionsNav | null>;
  jumpRef: React.RefObject<JumpHandle | null>;
  trackStickyPrompt?: boolean;
  onSearchMatchesChange?: (count: number, current: number) => void;
  scanElement?: Parameters<typeof VirtualMessageList>[0]["scanElement"];
  setPositions?: Parameters<typeof VirtualMessageList>[0]["setPositions"];
};

export function Messages({
  messages,
  scrollRef,
  columns,
  selectedIndex,
  cursor,
  setCursor,
  cursorNavRef,
  jumpRef,
  trackStickyPrompt,
  onSearchMatchesChange,
  scanElement,
  setPositions,
}: Props): React.ReactNode {
  return (
    <InVirtualListContext.Provider value={true}>
      <VirtualMessageList
        messages={messages}
        scrollRef={scrollRef}
        columns={columns}
        itemKey={(msg) => msg.uuid}
        onItemClick={(msg) => {
          setCursor((current: MessageActionsState | null) => {
            const nextExpanded = current?.uuid === msg.uuid
              ? !current.expanded
              : false;
            return {
              uuid: msg.uuid,
              msgType: msg.type,
              expanded: nextExpanded,
              toolName: toolCallOf(msg)?.name,
            };
          });
        }}
        isItemClickable={isNavigableMessage}
        isItemExpanded={(msg) => cursor?.uuid === msg.uuid && cursor.expanded}
        trackStickyPrompt={trackStickyPrompt}
        selectedIndex={selectedIndex >= 0 ? selectedIndex : undefined}
        cursorNavRef={cursorNavRef}
        setCursor={setCursor}
        jumpRef={jumpRef}
        onSearchMatchesChange={onSearchMatchesChange}
        scanElement={scanElement}
        setPositions={setPositions}
        renderItem={(msg, index) => {
          const selected = index === selectedIndex;
          const expanded = cursor?.uuid === msg.uuid && cursor.expanded;

          return (
            <MessageActionsSelectedContext.Provider value={selected}>
              <MessageRow message={msg} index={index} expanded={expanded} />
            </MessageActionsSelectedContext.Provider>
          );
        }}
      />
    </InVirtualListContext.Provider>
  );
}
