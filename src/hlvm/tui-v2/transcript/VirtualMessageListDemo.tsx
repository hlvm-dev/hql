import React from "react";
import { useTerminalSize } from "../hooks/useTerminalSize.ts";
import Box from "../ink/components/Box.tsx";
import ScrollBox, { type ScrollBoxHandle } from "../ink/components/ScrollBox.tsx";
import Text from "../ink/components/Text.tsx";
import {
  ScrollChromeContext,
  type StickyPrompt,
} from "./compat/ScrollChromeContext.tsx";
import { VirtualMessageList } from "./VirtualMessageList.tsx";
import type { RenderableTranscriptMessage } from "./types.ts";

function buildDemoMessages(): RenderableTranscriptMessage[] {
  return Array.from({ length: 220 }, (_, index) => {
    const block = index % 11;

    if (block === 0) {
      const prompt = `inspect repl donor prompt ${index.toString().padStart(3, "0")}`;
      return {
        uuid: `user-${index}`,
        type: "user",
        title: `User prompt ${index.toString().padStart(3, "0")}`,
        lines: [
          prompt,
          "This message should be eligible for sticky prompt tracking.",
        ],
        stickyText: prompt,
      };
    }

    if (block === 2) {
      return {
        uuid: `tool-${index}`,
        type: "grouped_tool_use",
        title: `Tool group ${index.toString().padStart(3, "0")}`,
        lines: [
          "Bash(command: rg --files src/hlvm/tui-v2)",
          "Read(path: src/hlvm/tui-v2/transcript/VirtualMessageList.tsx)",
        ],
        toolName: "Bash",
        toolCall: {
          name: "Bash",
          input: { command: "rg --files src/hlvm/tui-v2" },
        },
      };
    }

    if (block === 5) {
      return {
        uuid: `attachment-${index}`,
        type: "attachment",
        title: `Queued command ${index.toString().padStart(3, "0")}`,
        lines: [
          "A queued command attachment should behave like a synthetic user prompt.",
        ],
        attachmentType: "queued_command",
        attachmentPrompt: `queued command ${index} while transcript kept streaming`,
      };
    }

    if (block === 8) {
      return {
        uuid: `system-${index}`,
        type: "system",
        title: `System note ${index.toString().padStart(3, "0")}`,
        lines: [
          "This stays in the virtualized transcript but is not the main sticky source.",
        ],
        subtype: "note",
      };
    }

    const extraLines = 1 + (index % 4);
    return {
      uuid: `assistant-${index}`,
      type: "assistant",
      title: `Assistant block ${index.toString().padStart(3, "0")}`,
      lines: Array.from({ length: extraLines }, (_, lineIndex) =>
        `assistant body ${index.toString().padStart(3, "0")} · line ${lineIndex + 1} · donor VirtualMessageList render path`,
      ),
    };
  });
}

function renderStickyPrompt(prompt: StickyPrompt | null): string {
  if (prompt === "clicked") return "sticky prompt clicked";
  if (!prompt) return "none";
  return prompt.text;
}

export function VirtualMessageListDemo(): React.ReactNode {
  const messages = React.useMemo(() => buildDemoMessages(), []);
  const scrollRef = React.useRef<ScrollBoxHandle | null>(null);
  const { columns } = useTerminalSize();
  const effectiveColumns = Math.max(24, columns - 8);
  const [stickyPrompt, setStickyPrompt] = React.useState<StickyPrompt | null>(
    null,
  );
  const [expandedKeys, setExpandedKeys] = React.useState<Set<string>>(
    () => new Set(),
  );
  const bootstrappedRef = React.useRef(false);

  React.useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    const timer = setTimeout(() => scrollRef.current?.scrollTo(180), 60);
    return () => clearTimeout(timer);
  }, []);

  return (
    <ScrollChromeContext.Provider value={{ setStickyPrompt }}>
      <Box flexDirection="column">
        <Text bold>VirtualMessageList donor layer</Text>
        <Text dimColor>
          This is the first donor-shaped transcript list running on top of the
          copied virtualization core.
        </Text>
        <Text dimColor wrap="wrap">
          sticky prompt: {renderStickyPrompt(stickyPrompt)}
        </Text>
        <Box borderStyle="round" marginTop={1} paddingX={1} height={14}>
          <ScrollBox
            ref={scrollRef}
            flexDirection="column"
            height={12}
            stickyScroll
          >
            <VirtualMessageList
              messages={messages}
              scrollRef={scrollRef}
              columns={effectiveColumns}
              itemKey={(msg) => msg.uuid}
              onItemClick={(msg) => {
                if (msg.type !== "grouped_tool_use") return;
                setExpandedKeys((previous) => {
                  const next = new Set(previous);
                  if (next.has(msg.uuid)) next.delete(msg.uuid);
                  else next.add(msg.uuid);
                  return next;
                });
              }}
              isItemClickable={(msg) => msg.type === "grouped_tool_use"}
              isItemExpanded={(msg) => expandedKeys.has(msg.uuid)}
              trackStickyPrompt
              renderItem={(msg, index) => {
                const isExpanded = expandedKeys.has(msg.uuid);

                return (
                  <Box
                    flexDirection="column"
                    borderStyle="single"
                    marginBottom={1}
                    paddingX={1}
                    flexShrink={0}
                  >
                    <Text bold>
                      {index.toString().padStart(3, "0")} · {msg.title}
                    </Text>
                    {msg.lines.map((line, lineIndex) => (
                      <Text key={`${msg.uuid}-${lineIndex}`} wrap="wrap">
                        {line}
                      </Text>
                    ))}
                    {isExpanded && msg.type === "grouped_tool_use" && (
                      <Text color="cyan" wrap="wrap">
                        expanded donor row · tool input summary surfaced from the
                        click handler
                      </Text>
                    )}
                  </Box>
                );
              }}
            />
          </ScrollBox>
        </Box>
      </Box>
    </ScrollChromeContext.Provider>
  );
}
