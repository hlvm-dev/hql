/**
 * AssistantMessage Component
 *
 * Displays an assistant response with markdown rendering and optional sources.
 */

import React, { useMemo, useRef } from "react";
import { Box, Text } from "ink";
import { truncate } from "../../../../../common/utils.ts";
import { useSemanticColors } from "../../../theme/index.ts";
import { MarkdownDisplay } from "../markdown/index.ts";
import type { AssistantCitation } from "../../types.ts";
import { OPEN_LATEST_SOURCE_HINT } from "../../ui-constants.ts";
import { STATUS_GLYPHS } from "../../ui-constants.ts";

import { createIncrementalSanitizer } from "../../utils/sanitize-ansi.ts";
import { buildConversationSectionText } from "./conversation-chrome.ts";
import { getLiveConversationSpacing } from "./message-spacing.ts";

/** Shown while waiting for the first token from the model.
 *  Uses static marker — no spinner avoids terminal redraws that break text selection.
 */
function WorkingIndicator(
  { compactSpacing, width: _width }: { width: number; compactSpacing: boolean },
): React.ReactElement {
  const sc = useSemanticColors();
  const spacing = getLiveConversationSpacing(compactSpacing);
  return (
    <Box paddingLeft={2} marginBottom={spacing.waitingIndicatorMarginBottom}>
      <Text color={sc.text.muted}>
        {STATUS_GLYPHS.running} Waiting for response...
      </Text>
    </Box>
  );
}

const MAX_DISPLAY_CHARS = 50_000;

interface AssistantMessageProps {
  text: string;
  citations?: AssistantCitation[];
  isPending: boolean;
  width: number;
  compactSpacing?: boolean;
}

interface CitationSourceView {
  index: number;
  url: string;
  title: string;
  confidence?: number;
  spans: Array<{ startIndex: number; endIndex: number }>;
}

interface CitationRenderView {
  text: string;
  sources: CitationSourceView[];
}

function resolveSourcesLabel(citations: AssistantCitation[]): string {
  return citations.some((citation) =>
      citation?.provenance && citation.provenance !== "inferred"
    )
    ? "Sources"
    : "Inferred Sources";
}

function toValidRange(
  startIndex: unknown,
  endIndex: unknown,
  maxLen: number,
): { startIndex: number; endIndex: number } | undefined {
  if (typeof startIndex !== "number" || typeof endIndex !== "number") {
    return undefined;
  }
  if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex)) {
    return undefined;
  }
  if (startIndex < 0 || endIndex <= startIndex || endIndex > maxLen) {
    return undefined;
  }
  return { startIndex, endIndex };
}

export function buildCitationRenderView(
  text: string,
  citations: AssistantCitation[] = [],
): CitationRenderView {
  if (!citations.length) return { text, sources: [] };

  const urlToIndex = new Map<string, number>();
  const sourceMap = new Map<string, CitationSourceView>();
  const insertions: Array<{ pos: number; marker: string }> = [];
  const seenInsertionKeys = new Set<string>();

  for (const citation of citations) {
    if (!citation?.url || typeof citation.url !== "string") continue;
    const sourceIndex = urlToIndex.get(citation.url) ?? (urlToIndex.size + 1);
    if (!urlToIndex.has(citation.url)) {
      urlToIndex.set(citation.url, sourceIndex);
    }

    const key = `${citation.url}|${sourceIndex}`;
    const existing = sourceMap.get(key);
    const title =
      typeof citation.title === "string" && citation.title.trim().length > 0
        ? citation.title
        : citation.url;
    const confidence = typeof citation.confidence === "number" &&
        Number.isFinite(citation.confidence)
      ? citation.confidence
      : undefined;
    if (!existing) {
      sourceMap.set(key, {
        index: sourceIndex,
        url: citation.url,
        title,
        confidence,
        spans: [],
      });
    } else if (confidence !== undefined) {
      existing.confidence = existing.confidence === undefined
        ? confidence
        : Math.max(existing.confidence, confidence);
    }

    const range = text.length > 0
      ? toValidRange(citation.startIndex, citation.endIndex, text.length)
      : undefined;
    if (!range) continue;
    sourceMap.get(key)?.spans.push(range);

    const insertionKey = `${range.endIndex}|${sourceIndex}`;
    if (seenInsertionKeys.has(insertionKey)) continue;
    seenInsertionKeys.add(insertionKey);
    insertions.push({ pos: range.endIndex, marker: `[${sourceIndex}]` });
  }

  let annotated = text;
  if (insertions.length > 0) {
    for (const insertion of insertions.sort((a, b) => b.pos - a.pos)) {
      annotated = `${annotated.slice(0, insertion.pos)}${insertion.marker}${
        annotated.slice(insertion.pos)
      }`;
    }
  }

  const sources = [...sourceMap.values()]
    .sort((a, b) => a.index - b.index)
    .map((source) => ({
      ...source,
      spans: source.spans.sort((a, b) => a.startIndex - b.startIndex),
    }));
  return { text: annotated, sources };
}

export const AssistantMessage = React.memo(function AssistantMessage(
  { text, citations, isPending, width, compactSpacing = false }:
    AssistantMessageProps,
): React.ReactElement {
  const sc = useSemanticColors();

  const contentWidth = Math.max(10, width - 3);
  const sanitizeRef = useRef(createIncrementalSanitizer());

  const citationMemo = useMemo<{
    citationView: CitationRenderView;
    sources: CitationSourceView[];
    sourceOverflow: number;
    sourcesLabel: string;
  }>(() => {
    const sanitizedText = sanitizeRef.current(text);
    const displayText = sanitizedText.length > MAX_DISPLAY_CHARS
      ? "..." + sanitizedText.slice(-MAX_DISPLAY_CHARS)
      : sanitizedText;
    const citationView = buildCitationRenderView(displayText, citations ?? []);
    const sources = citationView.sources.slice(0, 6);
    const sourceOverflow = Math.max(
      0,
      citationView.sources.length - sources.length,
    );
    const sourcesLabel = resolveSourcesLabel(citations ?? []);
    return { citationView, sources, sourceOverflow, sourcesLabel };
  }, [text, citations]);

  if (isPending && !text) {
    return <WorkingIndicator width={width} compactSpacing={compactSpacing} />;
  }

  return (
    <Box flexDirection="row" width={width} marginBottom={1} marginTop={0}>
      <Box
        flexDirection="column"
        flexGrow={1}
        borderStyle="single"
        borderLeft
        borderRight={false}
        borderTop={false}
        borderBottom={false}
        borderColor={sc.border.default}
        paddingLeft={1}
      >
        <MarkdownDisplay
          text={citationMemo.citationView.text}
          width={contentWidth}
          isPending={isPending}
        />
        {!isPending && citationMemo.sources.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text color={sc.chrome.sectionLabel}>
              {buildConversationSectionText(
                citationMemo.sourcesLabel,
                contentWidth,
              )}
            </Text>
            {citationMemo.sources.map((source: CitationSourceView) => {
              const indexLabel = `[${source.index}]`;
              const titleText = ` ${source.title}`;
              return (
                <Box
                  key={`${source.index}:${source.url}`}
                  flexDirection="column"
                  marginTop={0}
                >
                  <Box>
                    <Text color={sc.border.active} bold>{indexLabel}</Text>
                    <Text color={sc.text.secondary}>
                      {truncate(
                        titleText,
                        contentWidth - indexLabel.length,
                        "…",
                      )}
                    </Text>
                  </Box>
                  <Text color={sc.text.muted}>
                    {truncate(source.url, contentWidth, "…")}
                  </Text>
                </Box>
              );
            })}
            {citationMemo.sourceOverflow > 0 && (
              <Text color={sc.text.muted}>
                +{citationMemo.sourceOverflow} more sources
              </Text>
            )}
            <Text color={sc.text.muted}>{OPEN_LATEST_SOURCE_HINT}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
});
