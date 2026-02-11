/**
 * Async Stream Helpers
 *
 * SSOT for collecting AsyncGenerator<string> streams into a single string.
 */

/**
 * Collect an async generator stream into a single string.
 */
export async function collectStream(
  stream: AsyncGenerator<string, void, unknown>,
): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks.join("");
}
