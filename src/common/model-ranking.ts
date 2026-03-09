export function parseModelParameterSize(size: string | undefined): number {
  if (!size) return -1;
  const match = size.match(/^(\d+(?:\.\d+)?)\s*([TBMK])/i);
  if (!match) return -1;
  const value = parseFloat(match[1]);
  switch (match[2]?.toUpperCase()) {
    case "T":
      return value * 1_000_000_000_000;
    case "B":
      return value * 1_000_000_000;
    case "M":
      return value * 1_000_000;
    case "K":
      return value * 1_000;
    default:
      return value;
  }
}
