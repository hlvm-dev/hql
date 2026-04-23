import { useContext } from "react";
import { RuntimeError } from "../../../common/error.ts";
import {
  TerminalSizeContext,
  type TerminalSize,
} from "../ink/components/TerminalSizeContext.tsx";

export function useTerminalSize(): TerminalSize {
  const size = useContext(TerminalSizeContext);

  if (!size) {
    throw new RuntimeError("useTerminalSize must be used within an Ink App component");
  }

  return size;
}
