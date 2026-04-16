import React from "react";
import Box from "../ink/components/Box.tsx";
import Text from "../ink/components/Text.tsx";

interface ErrorItemType {
  type: "error";
  id: string;
  text: string;
}

export default function ErrorItem({ item }: { item: ErrorItemType }) {
  return (
    <Box>
      <Text color="red" bold>{"✗ "}</Text>
      <Text color="red">{item.text}</Text>
    </Box>
  );
}
