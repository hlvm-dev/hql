import { getHlvmInstructionsPath } from "../../common/paths.ts";
import { truncate } from "../../common/utils.ts";
import { getPlatform } from "../../platform/platform.ts";
import type { Message } from "./context.ts";

const HLVM_INSTRUCTIONS_HEADER = "# Global HLVM Instructions";
const MAX_HLVM_INSTRUCTIONS_CHARS = 100_000;

export function isHlvmInstructionsSystemMessage(content: string): boolean {
  return content.startsWith(HLVM_INSTRUCTIONS_HEADER);
}

export async function loadHlvmInstructionsSystemMessage(): Promise<
  Message | null
> {
  const path = getHlvmInstructionsPath();
  let content: string;
  try {
    content = await getPlatform().fs.readTextFile(path);
  } catch {
    return null;
  }

  const instructions = content.trim();
  if (instructions.length === 0) {
    return null;
  }

  const body = instructions.length > MAX_HLVM_INSTRUCTIONS_CHARS
    ? truncate(instructions, MAX_HLVM_INSTRUCTIONS_CHARS)
    : instructions;

  return {
    role: "system",
    content:
      `${HLVM_INSTRUCTIONS_HEADER}\nSource: ${path}\nScope: global. Runtime directories are targets for tools, not instruction sources.\n\n${body}`,
  };
}
