import React from "react";
import { Box, Text, useStdout } from "ink";
import { useSemanticColors, useTheme } from "../../theme/index.ts";
import { ChromeChip, type ChromeChipTone } from "./ChromeChip.tsx";
import { DEFAULT_TERMINAL_HEIGHT } from "../ui-constants.ts";
import { buildBalancedTextRow } from "../utils/display-chrome.ts";

interface OverlayModalProps {
  title: string;
  rightText?: string;
  width: number;
  minHeight?: number;
  tone?: ChromeChipTone;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}

interface OverlayBalancedRowProps {
  leftText: string;
  rightText?: string;
  width: number;
  leftColor?: string;
  rightColor?: string;
  leftBold?: boolean;
  rightBold?: boolean;
  leftDim?: boolean;
  rightDim?: boolean;
  maxRightWidth?: number;
}

export function OverlayModal(
  {
    title,
    rightText,
    width,
    minHeight,
    tone = "active",
    children,
    footer,
  }: OverlayModalProps,
): React.ReactElement {
  const { color } = useTheme();
  const sc = useSemanticColors();
  const { stdout } = useStdout();
  const terminalRows = stdout?.rows ?? DEFAULT_TERMINAL_HEIGHT;

  return (
    <Box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height={terminalRows}
      justifyContent="center"
      alignItems="center"
    >
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={color("primary")}
        paddingX={1}
        paddingY={1}
        width={width}
        minHeight={minHeight}
        backgroundColor={sc.surface.modal.background}
        opaque
        overflow="hidden"
      >
        <Box justifyContent="space-between">
          <ChromeChip text={title} tone={tone} />
          {rightText
            ? <Text dimColor wrap="truncate-end">{rightText}</Text>
            : <Text />}
        </Box>
        <Box marginTop={1} flexDirection="column">
          {children}
        </Box>
        {footer && (
          <Box marginTop={1} flexDirection="column">
            {footer}
          </Box>
        )}
      </Box>
    </Box>
  );
}

export function OverlayBalancedRow(
  {
    leftText,
    rightText = "",
    width,
    leftColor,
    rightColor,
    leftBold = false,
    rightBold = false,
    leftDim = false,
    rightDim = false,
    maxRightWidth,
  }: OverlayBalancedRowProps,
): React.ReactElement {
  const layout = buildBalancedTextRow(
    width,
    leftText,
    rightText,
    { maxRightWidth },
  );

  return (
    <Box>
      <Text color={leftColor} bold={leftBold} dimColor={leftDim}>
        {layout.leftText}
      </Text>
      {layout.gapWidth > 0 && <Text>{" ".repeat(layout.gapWidth)}</Text>}
      <Text color={rightColor} bold={rightBold} dimColor={rightDim}>
        {layout.rightText}
      </Text>
    </Box>
  );
}
