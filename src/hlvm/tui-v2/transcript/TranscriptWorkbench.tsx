import React from "react";
import {
  AUTO_MODEL_ID,
  DEFAULT_MODEL_ID,
} from "../../../common/config/types.ts";
import { ensureError } from "../../../common/utils.ts";
import { getPlatform } from "../../../platform/platform.ts";
import {
  expandTextAttachmentReferences,
  filterReferencedAttachments,
  type AnyAttachment,
  type Attachment,
} from "../../cli/repl/attachment.ts";
import { resolveAtMentions } from "../../cli/repl/mention-resolver.ts";
import type {
  InteractionOption,
  InteractionResponse,
} from "../../agent/registry.ts";
import { REPL_MAIN_THREAD_QUERY_SOURCE } from "../../agent/query-tool-routing.ts";
import { createRuntimeConfigManager } from "../../runtime/model-config.ts";
import {
  ensureRuntimeHostAvailable,
  runAgentQueryViaHost,
} from "../../runtime/host-client.ts";
import { useConversation } from "../../cli/repl-ink/hooks/useConversation.ts";
import { createConversationAttachmentRef } from "../../cli/repl-ink/types.ts";
import { useTerminalSize } from "../hooks/useTerminalSize.ts";
import Box from "../ink/components/Box.tsx";
import type { ScrollBoxHandle } from "../ink/components/ScrollBox.tsx";
import Text from "../ink/components/Text.tsx";
import type { Key } from "../ink/events/input-event.ts";
import useInput from "../ink/hooks/use-input.ts";
import { useSearchHighlight } from "../ink/hooks/use-search-highlight.ts";
import { stringWidth } from "../ink/stringWidth.ts";
import { BaseTextInput } from "../input/BaseTextInput.tsx";
import {
  PromptInput,
  type PromptShellState,
  type PromptSubmission,
} from "../prompt/PromptInput.tsx";
import {
  type PendingInteractionRequest,
  PermissionRequest,
} from "../permissions/PermissionRequest.tsx";
import type { BaseInputState } from "../types/textInputTypes.ts";
import { adaptConversationItems } from "./adaptConversationItems.ts";
import {
  type MessageActionsNav,
  type MessageActionsState,
} from "./compat/messageActions.ts";
import {
  ScrollChromeContext,
  type StickyPrompt,
} from "./compat/ScrollChromeContext.tsx";
import { type JumpHandle } from "./VirtualMessageList.tsx";
import { Messages } from "./Messages.tsx";
import { HorizontalRule } from "../components/HorizontalRule.tsx";
import { FullscreenLayout } from "../components/FullscreenLayout.tsx";
import { LiveTurnStatus } from "../components/LiveTurnStatus.tsx";
import { ScrollKeybindingHandler } from "../components/ScrollKeybindingHandler.tsx";
import {
  isFullscreenActive,
  maybeGetTmuxMouseHint,
} from "../utils/fullscreen.ts";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function lineMetrics(value: string, cursorOffset: number) {
  const beforeCursor = value.slice(0, cursorOffset);
  const lines = beforeCursor.split("\n");
  const cursorLine = lines.length - 1;
  const cursorColumn = stringWidth(lines.at(-1) ?? "");
  return { cursorLine, cursorColumn };
}

function formatUsageLabel(
  estimatedTokens: number | undefined,
): string | undefined {
  if (
    typeof estimatedTokens !== "number" || !Number.isFinite(estimatedTokens)
  ) {
    return undefined;
  }
  return `${estimatedTokens} tokens`;
}

function prepareConversationAttachmentPayload(
  attachments?: readonly AnyAttachment[],
  text = "",
): {
  attachmentIds?: string[];
  attachments?: ReturnType<typeof createConversationAttachmentRef>[];
} {
  const referencedAttachments = text.trim().length > 0
    ? filterReferencedAttachments(text, attachments ?? [])
    : attachments ?? [];
  const runtimeAttachments = referencedAttachments.filter(
    (attachment): attachment is Attachment =>
      "attachmentId" in attachment && !("content" in attachment),
  );

  return {
    attachmentIds: runtimeAttachments.length > 0
      ? runtimeAttachments.map((attachment) => attachment.attachmentId)
      : undefined,
    attachments: runtimeAttachments.length > 0
      ? runtimeAttachments.map((attachment) =>
        createConversationAttachmentRef(
          attachment.displayName,
          attachment.attachmentId,
        )
      )
      : undefined,
  };
}

function expandConversationDraftText(
  text: string,
  attachments?: readonly AnyAttachment[],
): string {
  return expandTextAttachmentReferences(text, attachments ?? []);
}

type RuntimeInteractionState = {
  request: PendingInteractionRequest;
  requestId?: string;
};

type HostInteractionEvent = {
  requestId: string;
  mode: "permission" | "question";
  toolName?: string;
  toolArgs?: string;
  question?: string;
  options?: InteractionOption[];
  sourceLabel?: string;
  sourceThreadId?: string;
};

function mapInteractionRequest(
  event: HostInteractionEvent,
): RuntimeInteractionState {
  if (event.mode === "question") {
    return {
      requestId: event.requestId,
      request: {
        kind: "question",
        title: "Clarification needed",
        question: event.question,
        options: event.options,
        selectedIndex: 0,
        sourceLabel: event.sourceLabel,
      },
    };
  }

  return {
    requestId: event.requestId,
    request: {
      kind: "permission",
      title: "Permission request",
      description: event.toolName
        ? `HLVM needs permission to use ${event.toolName}.`
        : "HLVM needs permission to continue.",
      inputSummary: event.toolArgs,
      sourceLabel: event.sourceLabel,
    },
  };
}

export function TranscriptWorkbench(): React.ReactNode {
  const fixturePath = React.useMemo(
    () => getPlatform().env.get("HLVM_ASK_FIXTURE_PATH")?.trim() || undefined,
    [],
  );
  const conversation = useConversation();
  const messages = React.useMemo(
    () => adaptConversationItems(conversation.items),
    [conversation.items],
  );
  const scrollRef = React.useRef<ScrollBoxHandle | null>(null);
  const jumpRef = React.useRef<JumpHandle | null>(null);
  const cursorNavRef = React.useRef<MessageActionsNav | null>(null);
  const interactionResolverRef = React.useRef<
    ((response: InteractionResponse) => void) | null
  >(null);
  const pendingStreamTimerRef = React.useRef<
    ReturnType<typeof setTimeout> | null
  >(
    null,
  );
  const abortControllerRef = React.useRef<AbortController | null>(null);
  const { columns } = useTerminalSize();
  const effectiveColumns = Math.max(24, columns - 8);
  const [stickyPrompt, setStickyPrompt] = React.useState<StickyPrompt | null>(
    null,
  );
  const [cursor, setCursor] = React.useState<MessageActionsState | null>(null);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [searchValue, setSearchValue] = React.useState("");
  const [searchCursorOffset, setSearchCursorOffset] = React.useState(0);
  const [searchCount, setSearchCount] = React.useState(0);
  const [searchCurrent, setSearchCurrent] = React.useState(0);
  const [indexingMs, setIndexingMs] = React.useState<number | null>(null);
  const [promptState, setPromptState] = React.useState<PromptShellState>({
    mode: "prompt",
    queuedCount: 0,
    hasStash: false,
    historyCount: 0,
    inputValue: "",
  });
  const [runtimeBusy, setRuntimeBusy] = React.useState(false);
  const [runtimeModelLabel, setRuntimeModelLabel] = React.useState<string>();
  const [footerLabel, setFooterLabel] = React.useState<string>();
  const [pendingInteraction, setPendingInteraction] = React.useState<
    RuntimeInteractionState | null
  >(null);
  const [interactionSelectedIndex, setInteractionSelectedIndex] = React
    .useState(0);
  const [interactionInputValue, setInteractionInputValue] = React.useState("");
  const [interactionCursorOffset, setInteractionCursorOffset] = React.useState(
    0,
  );
  const { setQuery, scanElement, setPositions } = useSearchHighlight();

  const selectedIndex = React.useMemo(
    () =>
      cursor
        ? messages.findIndex((message: (typeof messages)[number]) =>
          message.uuid === cursor.uuid
        )
        : -1,
    [cursor, messages],
  );

  React.useEffect(() => {
    setQuery(searchValue);
    jumpRef.current?.setSearchQuery(searchValue);
  }, [searchValue, setQuery]);

  React.useEffect(() => {
    return () => {
      setQuery("");
      setPositions(null);
    };
  }, [setPositions, setQuery]);

  React.useEffect(() => {
    return () => {
      if (pendingStreamTimerRef.current) {
        clearTimeout(pendingStreamTimerRef.current);
      }
      if (interactionResolverRef.current) {
        interactionResolverRef.current({ approved: false });
        interactionResolverRef.current = null;
      }
      abortControllerRef.current?.abort();
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void ensureRuntimeHostAvailable().catch((error) => {
      if (cancelled) return;
      const message = ensureError(error).message;
      setFooterLabel((current) =>
        current ?? `runtime host warmup failed: ${message}`
      );
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // CC parity: default footer stays `? for shortcuts`. The tmux-mouse-off
  // hint previously permanently stomped the footer text which CC never does.
  // PgUp/PgDn still works in tmux-mouse-off, so degrading to a notification-
  // style hint (future: transient toast) rather than a persistent footer
  // label better matches the donor shell.
  React.useEffect(() => {
    if (!isFullscreenActive()) return;
    // Intentional no-op: the probe is still useful for future transient
    // notifications but must not set footerLabel permanently.
    void maybeGetTmuxMouseHint();
  }, []);

  const openSearch = React.useCallback(() => {
    jumpRef.current?.setAnchor();
    setSearchOpen(true);
    setIndexingMs(null);
    setTimeout(() => {
      const warmSearchIndex = jumpRef.current?.warmSearchIndex;
      if (!warmSearchIndex) return;
      void warmSearchIndex().then((ms: number) => setIndexingMs(ms));
    }, 0);
  }, []);

  const closeSearch = React.useCallback((clear = false) => {
    setSearchOpen(false);
    if (clear) {
      setSearchValue("");
      setSearchCursorOffset(0);
      setQuery("");
      jumpRef.current?.setSearchQuery("");
      setSearchCount(0);
      setSearchCurrent(0);
    }
  }, [setQuery]);

  const resolveInteraction = React.useCallback(
    (response: InteractionResponse) => {
      const resolver = interactionResolverRef.current;
      interactionResolverRef.current = null;
      setPendingInteraction(null);
      setInteractionSelectedIndex(0);
      setInteractionInputValue("");
      setInteractionCursorOffset(0);
      resolver?.(response);
    },
    [],
  );

  const requestInteraction = React.useCallback((
    request: RuntimeInteractionState,
    signal?: AbortSignal,
  ) => {
    setSearchOpen(false);
    setPendingInteraction(request);
    setInteractionSelectedIndex(0);
    setInteractionInputValue("");
    setInteractionCursorOffset(0);

    return new Promise<InteractionResponse>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        signal?.removeEventListener("abort", onAbort);
      };

      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        interactionResolverRef.current = null;
        setPendingInteraction(null);
        reject(new DOMException("Interaction aborted", "AbortError"));
      };

      interactionResolverRef.current = (response: InteractionResponse) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(response);
      };

      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }, []);

  const ensureRuntimeModel = React.useCallback(async (signal?: AbortSignal) => {
    const runtimeConfig = await createRuntimeConfigManager();
    let model = runtimeConfig.getConfiguredModel();

    if (fixturePath) {
      if (!model || model === AUTO_MODEL_ID) {
        model = DEFAULT_MODEL_ID;
      }
    } else {
      const ensured = await runtimeConfig.ensureInitialModelConfigured();
      model = await runtimeConfig.resolveCompatibleClaudeCodeModel(
        ensured.model,
      );
    }

    const approval = fixturePath
      ? { status: "approved" as const }
      : runtimeConfig.evaluateProviderApproval(model);

    if (approval.status === "approval_required") {
      const response = await requestInteraction({
        request: {
          kind: "provider_approval",
          title: "Provider approval required",
          description:
            `This model uses your ${approval.label} API key. Continue and save approval?`,
          inputSummary: model,
        },
      }, signal);
      if (!response.approved) {
        return null;
      }
      await runtimeConfig.approveProvider(approval.provider);
    }

    setRuntimeModelLabel(model);
    return {
      model,
      permissionMode: runtimeConfig.getPermissionMode(),
      contextWindow: runtimeConfig.getContextWindow(),
    };
  }, [fixturePath, requestInteraction]);

  const handleSlashCommand = React.useCallback((value: string): boolean => {
    const trimmed = value.trim();
    if (!trimmed.startsWith("/")) return false;

    // NB: the slash-command picker still surfaces commands loaded from v1's
    // shared `COMMAND_CATALOG` (so users see the full set HLVM plans to
    // support). The v2 handler wires the subset that is safe to invoke
    // in the v2 shell today. Any picker row that is NOT in this handler
    // falls through to the "not wired in v2 yet" notice instead of
    // silently doing nothing.

    if (trimmed === "/clear" || trimmed === "/flush") {
      conversation.clear();
      setCursor(null);
      setFooterLabel(undefined);
      queueMicrotask(() => scrollRef.current?.scrollToBottom());
      return true;
    }

    if (trimmed === "/help") {
      conversation.addInfo(
        "v2 commands: /clear · /flush · /help · /status · /exit",
      );
      queueMicrotask(() => scrollRef.current?.scrollToBottom());
      return true;
    }

    if (trimmed === "/status") {
      conversation.addInfo(
        `model: ${
          runtimeModelLabel ?? "resolving"
        } · stream: ${conversation.streamingState}`,
      );
      queueMicrotask(() => scrollRef.current?.scrollToBottom());
      return true;
    }

    if (trimmed === "/exit" || trimmed === "/quit") {
      // Mirror CC's `/exit`: graceful process exit. In v2 the shell is a
      // Deno subprocess spawned by `hlvm repl --new`, so exiting the
      // subprocess returns the user to the parent shell.
      conversation.addInfo("exiting…");
      queueMicrotask(() => {
        try {
          // Route through platform abstraction per SSOT (CLAUDE.md).
          getPlatform().process.exit(0);
        } catch {
          // If exit is unavailable (e.g. under a test runtime), fall
          // through silently — no infinite loop, just a no-op.
        }
      });
      return true;
    }

    // Picker-advertised commands that aren't yet wired with full behaviour
    // get a helpful info response instead of the generic "not wired yet"
    // dead-end, so users who see them in the `/` picker get trust-building
    // feedback instead of confusion.
    if (trimmed === "/mcp") {
      conversation.addInfo(
        "MCP servers: manage via `hlvm mcp` (list / add / remove) from the parent shell. In-shell controls arrive with the TUI v2 model/config overlay.",
      );
      queueMicrotask(() => scrollRef.current?.scrollToBottom());
      return true;
    }

    if (trimmed === "/init") {
      conversation.addInfo(
        "Initialize an HQL project via `hlvm hql init` from the parent shell.",
      );
      queueMicrotask(() => scrollRef.current?.scrollToBottom());
      return true;
    }

    if (trimmed === "/hooks") {
      conversation.addInfo(
        "Hooks: configured in settings.json. Active-hook listing in v2 is tracked in docs/vision/repl-v2-tui.md.",
      );
      queueMicrotask(() => scrollRef.current?.scrollToBottom());
      return true;
    }

    conversation.addInfo(`Command not wired in v2 yet: ${trimmed}`);
    queueMicrotask(() => scrollRef.current?.scrollToBottom());
    return true;
  }, [conversation, runtimeModelLabel]);

  const runPromptSubmission = React.useCallback(
    async (submission: PromptSubmission) => {
      const trimmed = submission.value.trim();
      if (trimmed.length === 0) return;

      if (submission.mode === "bash") {
        conversation.addInfo(
          "Bash mode is intentionally deferred. Phase 1 closes the shared HLVM chat path first.",
        );
        queueMicrotask(() => scrollRef.current?.scrollToBottom());
        return;
      }

      if (handleSlashCommand(trimmed)) {
        return;
      }

      const displayText = trimmed;
      const expandedText = expandConversationDraftText(
        trimmed,
        submission.attachments,
      );
      const resolvedText = await resolveAtMentions(expandedText);
      const { attachmentIds, attachments } = prepareConversationAttachmentPayload(
        submission.attachments,
        trimmed,
      );

      setRuntimeBusy(true);
      setFooterLabel(undefined);

      const controller = new AbortController();
      abortControllerRef.current = controller;
      let finalizeStatus: "completed" | "cancelled" | "failed" = "completed";
      const turnId = conversation.addUserMessage(displayText, {
        startTurn: true,
        submittedText: resolvedText !== displayText ? resolvedText : undefined,
        attachments,
      });
      conversation.addAssistantText("", true, undefined, { turnId });
      queueMicrotask(() => scrollRef.current?.scrollToBottom());

      try {
        const runtime = await ensureRuntimeModel(controller.signal);
        if (!runtime) {
          finalizeStatus = "cancelled";
          conversation.addInfo("Cancelled", { turnId });
          return;
        }

        let textBuffer = "";
        let finalCitations;
        let lastStreamRender = 0;
        const streamRenderInterval = 120;

        const flushStreamBuffer = () => {
          pendingStreamTimerRef.current = null;
          if (controller.signal.aborted) return;
          conversation.addAssistantText(textBuffer, true, undefined, {
            turnId,
          });
          lastStreamRender = Date.now();
        };

        const result = await runAgentQueryViaHost({
          query: resolvedText,
          model: runtime.model,
          fixturePath,
          attachmentIds,
          querySource: REPL_MAIN_THREAD_QUERY_SOURCE,
          contextWindow: runtime.contextWindow,
          stateless: fixturePath ? true : undefined,
          permissionMode: runtime.permissionMode,
          signal: controller.signal,
          callbacks: {
            onToken: (text: string) => {
              if (controller.signal.aborted) return;
              textBuffer += text;
              const now = Date.now();
              if (now - lastStreamRender >= streamRenderInterval) {
                if (pendingStreamTimerRef.current) {
                  clearTimeout(pendingStreamTimerRef.current);
                  pendingStreamTimerRef.current = null;
                }
                flushStreamBuffer();
              } else if (!pendingStreamTimerRef.current) {
                pendingStreamTimerRef.current = setTimeout(
                  flushStreamBuffer,
                  streamRenderInterval - (now - lastStreamRender),
                );
              }
            },
            onAgentEvent: (event) => {
              if (controller.signal.aborted) return;
              if (event.type === "tool_start" && textBuffer.trim()) {
                if (pendingStreamTimerRef.current) {
                  clearTimeout(pendingStreamTimerRef.current);
                  pendingStreamTimerRef.current = null;
                }
                conversation.addAssistantText(textBuffer, false, undefined, {
                  turnId,
                });
                textBuffer = "";
                lastStreamRender = 0;
              }
              conversation.addEvent(event);
            },
            onFinalResponseMeta: (meta) => {
              finalCitations = meta.citationSpans;
            },
            onTrace: (event) => {
              if (controller.signal.aborted) return;
              if (event.type === "context_pressure") {
                setFooterLabel(`${event.percent}% ctx`);
                return;
              }
              if (event.type === "context_overflow_retry") {
                conversation.addInfo(
                  "Context compacted and the turn retried.",
                  {
                    isTransient: true,
                    turnId,
                  },
                );
              }
            },
          },
          onInteraction: async (event) => {
            if (controller.signal.aborted) {
              throw new DOMException("Interaction aborted", "AbortError");
            }
            if (textBuffer.trim()) {
              if (pendingStreamTimerRef.current) {
                clearTimeout(pendingStreamTimerRef.current);
                pendingStreamTimerRef.current = null;
              }
              conversation.addAssistantText(textBuffer, false, undefined, {
                turnId,
              });
              textBuffer = "";
              lastStreamRender = 0;
            }
            return await requestInteraction(
              mapInteractionRequest(event),
              controller.signal,
            );
          },
        });

        if (pendingStreamTimerRef.current) {
          clearTimeout(pendingStreamTimerRef.current);
          pendingStreamTimerRef.current = null;
        }

        const finalAssistantText = textBuffer || result.text;
        if (finalAssistantText.trim().length > 0) {
          conversation.addAssistantText(
            finalAssistantText,
            false,
            finalCitations,
            {
              turnId,
            },
          );
        }
        setFooterLabel(formatUsageLabel(result.stats.estimatedTokens));
      } catch (error) {
        const wrapped = ensureError(error);
        if (controller.signal.aborted || wrapped.name === "AbortError") {
          finalizeStatus = "cancelled";
          conversation.addInfo("Cancelled", { turnId });
        } else {
          finalizeStatus = "failed";
          conversation.addError(wrapped.message, { turnId });
        }
      } finally {
        if (pendingStreamTimerRef.current) {
          clearTimeout(pendingStreamTimerRef.current);
          pendingStreamTimerRef.current = null;
        }
        abortControllerRef.current = null;
        setRuntimeBusy(false);
        if (turnId) {
          conversation.finalize(finalizeStatus, { turnId });
        }
        queueMicrotask(() => scrollRef.current?.scrollToBottom());
      }
    },
    [
      conversation,
      ensureRuntimeModel,
      fixturePath,
      handleSlashCommand,
      requestInteraction,
    ],
  );

  const handlePromptSubmit = React.useCallback((submission: PromptSubmission) => {
    if (submission.value.trim().length === 0) {
      return false;
    }

    if (runtimeBusy) {
      return false;
    }

    void runPromptSubmission(submission);
    return true;
  }, [runPromptSubmission, runtimeBusy]);

  useInput((input, key) => {
    if (key.escape && runtimeBusy && !pendingInteraction && !searchOpen) {
      abortControllerRef.current?.abort();
      return;
    }

    if (pendingInteraction) {
      const request = pendingInteraction.request;

      if (
        request.kind === "question" && request.options &&
        request.options.length > 0
      ) {
        if (key.escape) {
          resolveInteraction({ approved: false });
          return;
        }

        if (key.upArrow || key.leftArrow) {
          setInteractionSelectedIndex((current: number) =>
            (current - 1 + request.options!.length) % request.options!.length
          );
          return;
        }

        if (key.downArrow || key.rightArrow) {
          setInteractionSelectedIndex((current: number) =>
            (current + 1) % request.options!.length
          );
          return;
        }

        if (/^[1-9]$/.test(input)) {
          const index = Number(input) - 1;
          if (index < request.options.length) {
            setInteractionSelectedIndex(index);
          }
          return;
        }

        if (key.return) {
          const option = request.options[interactionSelectedIndex];
          if (!option) return;
          resolveInteraction({
            approved: true,
            userInput: option.value ?? option.label,
          });
          return;
        }

        return;
      }

      if (request.kind === "question") {
        return;
      }

      if (input.toLowerCase() === "y") {
        resolveInteraction({ approved: true });
        return;
      }

      if (input.toLowerCase() === "n" || key.escape) {
        resolveInteraction({ approved: false });
        return;
      }
    }

    if (key.ctrl && input.toLowerCase() === "n" && !key.shift) {
      jumpRef.current?.nextMatch();
      return;
    }

    if (key.ctrl && input.toLowerCase() === "n" && key.shift) {
      jumpRef.current?.prevMatch();
      return;
    }

  }, { isActive: true });

  const searchInputState = React.useMemo<BaseInputState>(() => {
    const { cursorLine, cursorColumn } = lineMetrics(
      searchValue,
      searchCursorOffset,
    );

    const onInput = (input: string, key: Key) => {
      if (key.leftArrow) {
        setSearchCursorOffset((current: number) =>
          clamp(current - 1, 0, searchValue.length)
        );
        return;
      }

      if (key.rightArrow) {
        setSearchCursorOffset((current: number) =>
          clamp(current + 1, 0, searchValue.length)
        );
        return;
      }

      if (key.home) {
        setSearchCursorOffset(0);
        return;
      }

      if (key.end) {
        setSearchCursorOffset(searchValue.length);
        return;
      }

      if (key.backspace) {
        if (searchCursorOffset === 0) return;
        const next = searchValue.slice(0, searchCursorOffset - 1) +
          searchValue.slice(searchCursorOffset);
        setSearchValue(next);
        setSearchCursorOffset(searchCursorOffset - 1);
        return;
      }

      if (key.delete) {
        if (searchCursorOffset >= searchValue.length) return;
        const next = searchValue.slice(0, searchCursorOffset) +
          searchValue.slice(searchCursorOffset + 1);
        setSearchValue(next);
        return;
      }

      if (key.return) {
        closeSearch(false);
        return;
      }

      if (key.escape) {
        closeSearch(true);
        return;
      }

      if (input.length > 0 && !key.ctrl && !key.meta && !key.super) {
        const next = searchValue.slice(0, searchCursorOffset) + input +
          searchValue.slice(searchCursorOffset);
        setSearchValue(next);
        setSearchCursorOffset(searchCursorOffset + input.length);
      }
    };

    return {
      onInput,
      renderedValue: searchValue,
      offset: searchCursorOffset,
      setOffset: setSearchCursorOffset,
      cursorLine,
      cursorColumn,
      viewportCharOffset: 0,
      viewportCharEnd: searchValue.length,
    };
  }, [closeSearch, searchCursorOffset, searchValue]);

  const interactionInputState = React.useMemo<BaseInputState>(() => {
    const { cursorLine, cursorColumn } = lineMetrics(
      interactionInputValue,
      interactionCursorOffset,
    );

    return {
      onInput: (input: string, key: Key) => {
        if (key.leftArrow) {
          setInteractionCursorOffset((current: number) =>
            clamp(current - 1, 0, interactionInputValue.length)
          );
          return;
        }

        if (key.rightArrow) {
          setInteractionCursorOffset((current: number) =>
            clamp(current + 1, 0, interactionInputValue.length)
          );
          return;
        }

        if (key.home) {
          setInteractionCursorOffset(0);
          return;
        }

        if (key.end) {
          setInteractionCursorOffset(interactionInputValue.length);
          return;
        }

        if (key.backspace) {
          if (interactionCursorOffset === 0) return;
          const next =
            interactionInputValue.slice(0, interactionCursorOffset - 1) +
            interactionInputValue.slice(interactionCursorOffset);
          setInteractionInputValue(next);
          setInteractionCursorOffset(interactionCursorOffset - 1);
          return;
        }

        if (key.delete) {
          if (interactionCursorOffset >= interactionInputValue.length) return;
          const next = interactionInputValue.slice(0, interactionCursorOffset) +
            interactionInputValue.slice(interactionCursorOffset + 1);
          setInteractionInputValue(next);
          return;
        }

        if (key.return) {
          const answer = interactionInputValue.trim();
          if (answer.length === 0) return;
          resolveInteraction({ approved: true, userInput: answer });
          return;
        }

        if (key.escape) {
          resolveInteraction({ approved: false });
          return;
        }

        if (input.length > 0 && !key.ctrl && !key.meta && !key.super) {
          const next = interactionInputValue.slice(0, interactionCursorOffset) +
            input + interactionInputValue.slice(interactionCursorOffset);
          setInteractionInputValue(next);
          setInteractionCursorOffset(interactionCursorOffset + input.length);
        }
      },
      renderedValue: interactionInputValue,
      offset: interactionCursorOffset,
      setOffset: setInteractionCursorOffset,
      cursorLine,
      cursorColumn,
      viewportCharOffset: 0,
      viewportCharEnd: interactionInputValue.length,
    };
  }, [
    interactionCursorOffset,
    interactionInputValue,
    resolveInteraction,
  ]);

  return (
    <ScrollChromeContext.Provider value={{ setStickyPrompt }}>
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        <ScrollKeybindingHandler
          scrollRef={scrollRef}
          isActive={!pendingInteraction}
          onScroll={() => {
            jumpRef.current?.disarmSearch();
          }}
        />
        <FullscreenLayout
          scrollRef={scrollRef}
          scrollable={
            <Box flexDirection="column">
              {messages.length === 0
                ? null
                : (
                  <Messages
                    messages={messages}
                    scrollRef={scrollRef}
                    columns={effectiveColumns}
                    selectedIndex={selectedIndex}
                    cursor={cursor}
                    setCursor={setCursor}
                    cursorNavRef={cursorNavRef}
                    jumpRef={jumpRef}
                    trackStickyPrompt
                    onSearchMatchesChange={(count, current) => {
                      setSearchCount(count);
                      setSearchCurrent(current);
                    }}
                    scanElement={scanElement}
                    setPositions={setPositions}
                  />
                )}
              <LiveTurnStatus active={runtimeBusy} />
              <HorizontalRule />
              <PromptInput
                focus={!searchOpen && !pendingInteraction}
                isLoading={runtimeBusy}
                isSearching={searchOpen}
                footerLabel={footerLabel}
                onOpenSearch={openSearch}
                onOpenPermission={() =>
                  conversation.addInfo("No pending permission request.")}
                onSubmit={handlePromptSubmit}
                onStateChange={setPromptState}
              />
            </Box>
          }
          bottom={
            <Box flexDirection="column">
              {pendingInteraction && (
                <Box marginBottom={1} flexDirection="column">
                  <PermissionRequest
                    request={pendingInteraction.request.kind === "question" &&
                        pendingInteraction.request.options
                      ? {
                        ...pendingInteraction.request,
                        selectedIndex: interactionSelectedIndex,
                      }
                      : pendingInteraction.request}
                  />
                  {pendingInteraction.request.kind === "question" &&
                    (!pendingInteraction.request.options ||
                      pendingInteraction.request.options.length === 0) &&
                    (
                      <Box marginTop={1}>
                        <BaseTextInput
                          inputState={interactionInputState}
                          terminalFocus={true}
                          focus={true}
                          showCursor={true}
                          value={interactionInputValue}
                          onChange={setInteractionInputValue}
                          columns={effectiveColumns}
                          cursorOffset={interactionCursorOffset}
                          onChangeCursorOffset={setInteractionCursorOffset}
                          placeholder="type the clarification reply here"
                        />
                      </Box>
                    )}
                </Box>
              )}

              {searchOpen && (
                <Box
                  flexDirection="column"
                  marginBottom={1}
                >
                  <Text dim>Transcript search</Text>
                  <Box marginTop={1}>
                    <BaseTextInput
                      inputState={searchInputState}
                      terminalFocus={searchOpen}
                      focus={searchOpen}
                      showCursor={true}
                      value={searchValue}
                      onChange={setSearchValue}
                      columns={effectiveColumns}
                      cursorOffset={searchCursorOffset}
                      onChangeCursorOffset={setSearchCursorOffset}
                      placeholder="type to filter transcript"
                    />
                  </Box>
                </Box>
              )}
            </Box>
          }
        />
      </Box>
    </ScrollChromeContext.Provider>
  );
}
