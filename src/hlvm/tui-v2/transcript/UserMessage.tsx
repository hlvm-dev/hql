import React from "react";
import Box from "../ink/components/Box.tsx";
import Text from "../ink/components/Text.tsx";

interface UserItem {
  type: "user";
  id: string;
  text: string;
  ts: number;
}

export default function UserMessage({ item }: { item: UserItem }) {
  return (
    <Box>
      <Text color="blue" bold>{"❯ "}</Text>
      <Text>{item.text}</Text>
    </Box>
  );
}
