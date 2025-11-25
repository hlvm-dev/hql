// utils/dirty_publish_prompt.ts
import { promptUser } from "./utils.ts";

/**
 * Prompts the user to confirm force-publishing with --allow-dirty when uncommitted changes are detected.
 * Returns true if the user agrees to force publish, false otherwise.
 */
export async function confirmAllowDirtyPublish(
  details: string = "",
): Promise<boolean> {
  const message = `\n⚠️  Uncommitted changes detected${
    details ? `: ${details}` : "."
  }\nWould you like to force publish using --allow-dirty? (y/N): `;
  const input = await promptUser(message, "n");
  return input.trim().toLowerCase().startsWith("y");
}
