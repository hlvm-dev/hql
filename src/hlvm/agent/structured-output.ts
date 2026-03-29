export function formatStructuredResultText(result: unknown): string {
  if (typeof result === "string") return result;
  const formatted = JSON.stringify(result, null, 2);
  return formatted ?? String(result);
}
