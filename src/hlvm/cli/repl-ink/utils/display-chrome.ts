import { truncate } from "../../../../common/utils.ts";
import { stringWidth } from "../utils/ansi/string-width.ts";

export interface TwoColumnTextLayout {
  leftText: string;
  rightText: string;
  gapWidth: number;
}

export function buildSectionLabelText(label: string, width: number): string {
  const safeWidth = Math.max(0, width);
  if (safeWidth === 0) return "";

  const trimmed = label.trim();
  if (stringWidth(trimmed) >= safeWidth) {
    return truncate(trimmed, safeWidth, "…");
  }

  const fillWidth = Math.max(0, safeWidth - stringWidth(trimmed) - 1);
  if (fillWidth === 0) return trimmed;
  return `${trimmed} ${"─".repeat(fillWidth)}`;
}

export function buildBalancedTextRow(
  width: number,
  left: string,
  right: string,
  {
    minGap = 2,
    maxRightWidth = Math.max(8, Math.floor(width * 0.4)),
  }: {
    minGap?: number;
    maxRightWidth?: number;
  } = {},
): TwoColumnTextLayout {
  const safeWidth = Math.max(0, width);
  if (safeWidth === 0) {
    return { leftText: "", rightText: "", gapWidth: 0 };
  }
  if (!right.trim()) {
    const fittedLeft = truncate(left, safeWidth, "…");
    return {
      leftText: fittedLeft,
      rightText: "",
      gapWidth: Math.max(0, safeWidth - stringWidth(fittedLeft)),
    };
  }

  let fittedRight = truncate(
    right,
    Math.max(1, Math.min(maxRightWidth, safeWidth)),
    "…",
  );
  const fittedRightWidth = stringWidth(fittedRight);
  if (fittedRightWidth >= safeWidth) {
    fittedRight = truncate(fittedRight, safeWidth, "…");
    return { leftText: "", rightText: fittedRight, gapWidth: 0 };
  }

  const preferredGap = safeWidth - fittedRightWidth > minGap ? minGap : 1;
  const availableLeft = Math.max(
    0,
    safeWidth - fittedRightWidth - preferredGap,
  );
  const fittedLeft = truncate(left, availableLeft, "…");
  const fittedLeftWidth = stringWidth(fittedLeft);
  const gapWidth = Math.max(
    fittedLeftWidth > 0 ? 1 : 0,
    safeWidth - fittedLeftWidth - fittedRightWidth,
  );

  return {
    leftText: fittedLeft,
    rightText: fittedRight,
    gapWidth,
  };
}
