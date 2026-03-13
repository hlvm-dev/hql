import React from "react";
import { Box, Text } from "ink";
import { truncate } from "../../../../../common/utils.ts";
import { useSemanticColors } from "../../../theme/index.ts";

interface ConversationSectionProps {
  title: string;
  titleColor: string;
  width?: number;
  accentColor?: string;
  meta?: string;
  metaColor?: string;
  marginTop?: number;
  marginBottom?: number;
  children?: React.ReactNode;
}

export function ConversationSection({
  title,
  titleColor,
  width,
  accentColor,
  meta,
  metaColor,
  marginTop = 0,
  marginBottom = 1,
  children,
}: ConversationSectionProps): React.ReactElement {
  const sc = useSemanticColors();
  const sectionWidth = width ? Math.max(12, width) : undefined;
  const headerWidth = width ? Math.max(10, width - 2) : undefined;
  const bodyWidth = width ? Math.max(10, width - 2) : undefined;
  const visibleTitle = headerWidth ? truncate(title, headerWidth, "…") : title;
  const availableMetaWidth = headerWidth
    ? Math.max(8, headerWidth - visibleTitle.length - 3)
    : undefined;
  const visibleMeta = meta
    ? availableMetaWidth ? truncate(meta, availableMetaWidth, "…") : meta
    : "";

  return (
    <Box
      width={sectionWidth}
      flexDirection="column"
      marginTop={marginTop}
      marginBottom={marginBottom}
    >
      <Box>
        <Text bold color={titleColor}>{visibleTitle}</Text>
        {visibleMeta && (
          <Text color={metaColor ?? sc.text.muted}>{` · ${visibleMeta}`}</Text>
        )}
      </Box>
      <Box
        borderStyle="single"
        borderLeft
        borderRight={false}
        borderTop={false}
        borderBottom={false}
        borderColor={accentColor ?? titleColor}
        paddingLeft={1}
        marginLeft={1}
        flexDirection="column"
        width={bodyWidth}
      >
        {children}
      </Box>
    </Box>
  );
}
