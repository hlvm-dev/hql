import { truncate } from "../../../../common/utils.ts";

export interface TwoColumnTextLayout {
  leftText: string;
  rightText: string;
  gapWidth: number;
}

export function buildSectionLabelText(label: string, width: number): string {
  const safeWidth = Math.max(0, width);
  if (safeWidth === 0) return "";

  const trimmed = label.trim();
  if (trimmed.length >= safeWidth) {
    return truncate(trimmed, safeWidth, "…");
  }

  const fillWidth = Math.max(0, safeWidth - trimmed.length - 1);
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
    return {
      leftText: truncate(left, safeWidth, "…"),
      rightText: "",
      gapWidth: 0,
    };
  }

  let fittedRight = truncate(
    right,
    Math.max(1, Math.min(maxRightWidth, safeWidth)),
    "…",
  );
  if (fittedRight.length >= safeWidth) {
    fittedRight = truncate(fittedRight, safeWidth, "…");
    return { leftText: "", rightText: fittedRight, gapWidth: 0 };
  }

  const preferredGap = safeWidth - fittedRight.length > minGap ? minGap : 1;
  const availableLeft = Math.max(
    0,
    safeWidth - fittedRight.length - preferredGap,
  );
  const fittedLeft = truncate(left, availableLeft, "…");
  const gapWidth = Math.max(
    fittedLeft.length > 0 ? 1 : 0,
    safeWidth - fittedLeft.length - fittedRight.length,
  );

  return {
    leftText: fittedLeft,
    rightText: fittedRight,
    gapWidth,
  };
}

export function buildRightSlotTextLayout(
  width: number,
  left: string,
  right: string,
  rightSlotWidth: number,
  minGap = 2,
): TwoColumnTextLayout {
  const safeWidth = Math.max(0, width);
  if (safeWidth === 0) {
    return { leftText: "", rightText: "", gapWidth: 0 };
  }

  let fittedRight = truncate(
    right,
    Math.max(1, Math.min(rightSlotWidth, safeWidth)),
    "…",
  );
  if (fittedRight.length >= safeWidth) {
    fittedRight = truncate(fittedRight, safeWidth, "…");
    return { leftText: "", rightText: fittedRight, gapWidth: 0 };
  }

  const preferredGap = safeWidth - fittedRight.length > minGap ? minGap : 1;
  const availableLeft = Math.max(
    0,
    safeWidth - fittedRight.length - preferredGap,
  );
  const fittedLeft = truncate(left, availableLeft, "…");
  const gapWidth = Math.max(
    fittedLeft.length > 0 ? 1 : 0,
    safeWidth - fittedLeft.length - fittedRight.length,
  );

  return {
    leftText: fittedLeft,
    rightText: fittedRight,
    gapWidth,
  };
}
