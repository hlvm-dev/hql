/**
 * HqlEvalDisplay — renders a single HQL evaluation (input + result)
 * in the unified conversation timeline.
 */

import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { Output } from "../Output.tsx";
import {
  getHighlightSegments,
  getUnclosedDepth,
  type TokenType,
} from "../../../repl/syntax.ts";
import { useTheme } from "../../../theme/index.ts";
import type { EvalResult } from "../../types.ts";

interface HqlEvalDisplayProps {
  input: string;
  result: EvalResult;
}

export const HqlEvalDisplay = React.memo(function HqlEvalDisplay({
  input,
  result,
}: HqlEvalDisplayProps): React.ReactElement {
  const { color } = useTheme();

  const tokenColor = useMemo(() => {
    const a = color("accent");
    const s = color("secondary");
    const su = color("success");
    const w = color("warning");
    const m = color("muted");
    const t = color("text");
    const map: Record<string, string | undefined> = {
      keyword: a,
      macro: s,
      string: su,
      number: w,
      operator: t,
      boolean: w,
      nil: m,
      comment: m,
      whitespace: undefined,
      "open-paren": t,
      "close-paren": t,
      "open-bracket": t,
      "close-bracket": t,
      "open-brace": t,
      "close-brace": t,
      functionCall: t,
    };
    return (type: TokenType): string | undefined => map[type];
  }, [color]);

  const lines = input.split("\n");
  const unclosedDepth = lines.length > 1 ? getUnclosedDepth(input) : 0;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {lines.map((line: string, lineIndex: number) => (
        <Box key={lineIndex}>
          <Text bold>
            {lineIndex === 0
              ? ">"
              : (unclosedDepth > 0 ? `..${unclosedDepth}>` : "...>")}
          </Text>
          <Text>{" "}</Text>
          <Box>
            {getHighlightSegments(line).map((seg, segIdx) => (
              <React.Fragment key={`${lineIndex}-${segIdx}`}>
                <Text
                  color={seg.colorKey
                    ? tokenColor(seg.colorKey as TokenType)
                    : undefined}
                  bold={seg.bold}
                >
                  {seg.value}
                </Text>
              </React.Fragment>
            ))}
          </Box>
        </Box>
      ))}
      <Output result={result} />
    </Box>
  );
});
