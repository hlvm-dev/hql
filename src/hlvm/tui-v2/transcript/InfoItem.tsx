import React from "react";
import Box from "../ink/components/Box.tsx";
import Text from "../ink/components/Text.tsx";

interface InfoItemType {
  type: "info";
  id: string;
  text: string;
  isTransient?: boolean;
}

export default function InfoItem({ item }: { item: InfoItemType }) {
  return (
    <Box>
      <Text dimColor={true} color={item.isTransient ? "gray" : undefined}>
        {item.text}
      </Text>
    </Box>
  );
}
