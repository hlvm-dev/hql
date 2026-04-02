function splitBudget(
  maxChars: number,
  markerChars: number,
): { headChars: number; tailChars: number } {
  const contentBudget = Math.max(8, maxChars - markerChars);
  const headChars = Math.max(4, Math.ceil(contentBudget * 0.65));
  const tailChars = Math.max(4, contentBudget - headChars);
  return { headChars, tailChars };
}

export function truncateTranscriptInline(
  text: string,
  maxChars: number,
): string {
  if (text.length <= maxChars) return text;
  const { headChars, tailChars } = splitBudget(maxChars, 5);
  return `${text.slice(0, headChars)} ... ${text.slice(-tailChars)}`;
}

export function truncateTranscriptBlock(
  text: string,
  maxChars: number,
): string {
  if (text.length <= maxChars) return text;
  const omittedChars = text.length - maxChars;
  const marker = `\n... (${omittedChars} chars omitted) ...\n`;
  const { headChars, tailChars } = splitBudget(maxChars, marker.length);
  return `${text.slice(0, headChars)}${marker}${text.slice(-tailChars)}`;
}
