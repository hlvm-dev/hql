import React from "react";
import Box from "../ink/components/Box.tsx";
import Text from "../ink/components/Text.tsx";
import type { InteractionOption } from "../../agent/registry.ts";

export type PendingInteractionRequest =
  | {
    kind: "permission" | "provider_approval";
    title: string;
    description: string;
    inputSummary?: string;
    sourceLabel?: string;
  }
  | {
    kind: "question";
    title: string;
    question?: string;
    options?: InteractionOption[];
    selectedIndex: number;
    sourceLabel?: string;
  };

type Props = {
  request: PendingInteractionRequest;
};

export function PermissionRequest({ request }: Props): React.ReactNode {
  if (request.kind === "question") {
    return (
      <Box borderStyle="round" flexDirection="column" paddingX={1}>
        <Text bold>{request.title}</Text>
        {request.sourceLabel && (
          <Text dimColor wrap="wrap">
            source: {request.sourceLabel}
          </Text>
        )}
        {request.question && <Text wrap="wrap">{request.question}</Text>}
        {request.options && request.options.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            {request.options.map((option, index) => {
              const selected = index === request.selectedIndex;
              return (
                <Text
                  key={`${option.value ?? option.label}-${index}`}
                  color={selected ? "cyan" : undefined}
                  wrap="wrap"
                >
                  {selected ? ">" : " "} {index + 1}. {option.label}
                  {option.recommended ? " (Recommended)" : ""}
                  {option.detail ? ` — ${option.detail}` : ""}
                </Text>
              );
            })}
          </Box>
        )}
        <Text dimColor wrap="wrap">
          {request.options && request.options.length > 0
            ? "keys: arrows or 1-9 choose · Enter submit · Esc cancel"
            : "type reply below · Enter submit · Esc cancel"}
        </Text>
      </Box>
    );
  }

  return (
    <Box borderStyle="round" flexDirection="column" paddingX={1}>
      <Text bold>{request.title}</Text>
      {request.sourceLabel && (
        <Text dimColor wrap="wrap">
          source: {request.sourceLabel}
        </Text>
      )}
      <Text wrap="wrap">{request.description}</Text>
      {request.inputSummary && (
        <Text dimColor wrap="wrap">
          {request.inputSummary}
        </Text>
      )}
      <Text dimColor>keys: y allow · n reject · Esc dismiss</Text>
    </Box>
  );
}
