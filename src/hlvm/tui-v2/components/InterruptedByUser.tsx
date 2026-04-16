import React from "react";
import Text from "../ink/components/Text.tsx";

export function InterruptedByUser(): React.ReactNode {
  return (
    <>
      <Text dimColor>Interrupted</Text>
      <Text dimColor>· What should HLVM do instead?</Text>
    </>
  );
}
