export type TranscriptToolCall = {
  name: string;
  input: Record<string, unknown>;
};

export type TranscriptMemory = {
  content: string;
};

export type RenderableTranscriptMessage =
  | {
      uuid: string;
      type: "user";
      title: string;
      lines: string[];
      searchText?: string;
      stickyText?: string | null;
      isMeta?: boolean;
      isCompactSummary?: boolean;
      isVisibleInTranscriptOnly?: boolean;
    }
  | {
      uuid: string;
      type: "assistant";
      title: string;
      lines: string[];
      searchText?: string;
      stickyText?: string | null;
      toolCall?: TranscriptToolCall;
    }
  | {
      uuid: string;
      type: "grouped_tool_use";
      title: string;
      lines: string[];
      searchText?: string;
      stickyText?: string | null;
      toolName: string;
      toolCall?: TranscriptToolCall;
    }
  | {
      uuid: string;
      type: "collapsed_read_search";
      title: string;
      lines: string[];
      searchText?: string;
      stickyText?: string | null;
      relevantMemories?: TranscriptMemory[];
    }
  | {
      uuid: string;
      type: "system";
      title: string;
      lines: string[];
      searchText?: string;
      stickyText?: string | null;
      subtype?: string;
    }
  | {
      uuid: string;
      type: "attachment";
      title: string;
      lines: string[];
      searchText?: string;
      stickyText?: string | null;
      attachmentType:
        | "queued_command"
        | "diagnostics"
        | "hook_blocking_error"
        | "hook_error_during_execution"
        | "other";
      attachmentPrompt?: string;
      commandMode?: string;
      isMeta?: boolean;
    };
