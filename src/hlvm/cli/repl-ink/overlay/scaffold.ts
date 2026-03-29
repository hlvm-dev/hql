import {
  buildBalancedTextRow,
  buildSectionLabelText,
  type TwoColumnTextLayout,
} from "../utils/display-chrome.ts";
import {
  ansi,
  drawOverlayFrame,
  fg,
  type OverlayFrame,
  type OverlayColors,
  type RGB,
} from "./renderer.ts";

const ANSI_DIM = "\x1b[2m";

export interface OverlayTextStyle {
  color?: RGB;
  bold?: boolean;
  dim?: boolean;
  inverse?: boolean;
}

export interface OverlayRowContext {
  readonly length: number;
  write: (text: string, style?: OverlayTextStyle) => void;
  pad: (count: number) => void;
  remaining: () => number;
}

interface OverlayScaffoldOptions {
  frame: OverlayFrame;
  colors: OverlayColors;
  title?: string;
  rightText?: string;
  borderColor?: RGB;
  backgroundColor?: RGB;
}

interface OverlayRowOptions {
  selected?: boolean;
}

interface OverlayBalancedRowOptions extends OverlayRowOptions {
  paddingLeft?: number;
  paddingRight?: number;
  leftColor?: RGB;
  rightColor?: RGB;
  leftBold?: boolean;
  rightBold?: boolean;
  leftDim?: boolean;
  rightDim?: boolean;
  minGap?: number;
  maxRightWidth?: number;
}

interface OverlayTextRowOptions extends OverlayRowOptions {
  paddingLeft?: number;
  paddingRight?: number;
  color?: RGB;
  bold?: boolean;
  dim?: boolean;
}

interface OverlaySectionRowOptions extends OverlayRowOptions {
  paddingLeft?: number;
  color?: RGB;
}

export interface ModalOverlayScaffold {
  readonly frame: OverlayFrame;
  readonly colors: OverlayColors;
  blankRow: (y: number, options?: OverlayRowOptions) => void;
  blankRows: (startY: number, count: number, options?: OverlayRowOptions) => void;
  row: (
    y: number,
    render: (ctx: OverlayRowContext) => void,
    options?: OverlayRowOptions,
  ) => void;
  textRow: (
    y: number,
    text: string,
    options?: OverlayTextRowOptions,
  ) => void;
  balancedRow: (
    y: number,
    leftText: string,
    rightText: string,
    contentWidth: number,
    options?: OverlayBalancedRowOptions,
  ) => TwoColumnTextLayout;
  sectionRow: (
    y: number,
    label: string,
    contentWidth: number,
    options?: OverlaySectionRowOptions,
  ) => string;
  appendRaw: (value: string) => void;
  finish: () => string;
}

function styleText(
  text: string,
  rowBgStyle: string,
  style?: OverlayTextStyle,
): string {
  if (!style) return text;

  let prefix = "";
  if (style.color) prefix += fg(style.color);
  if (style.bold) prefix += ansi.bold;
  if (style.dim) prefix += ANSI_DIM;
  if (style.inverse) prefix += ansi.inverse;
  if (!prefix) return text;

  return `${prefix}${text}${ansi.reset}${rowBgStyle}`;
}

function getRowBackgroundStyle(
  colors: OverlayColors,
  selected = false,
): string {
  return selected ? colors.selectedBgStyle : colors.bgStyle;
}

export function createModalOverlayScaffold(
  options: OverlayScaffoldOptions,
): ModalOverlayScaffold {
  const {
    frame,
    colors,
    title,
    rightText,
    borderColor = colors.primary,
    backgroundColor = colors.background,
  } = options;
  let output = ansi.cursorSave + ansi.cursorHide;

  const row = (
    y: number,
    render: (ctx: OverlayRowContext) => void,
    rowOptions: OverlayRowOptions = {},
  ): void => {
    const rowBgStyle = getRowBackgroundStyle(colors, rowOptions.selected);
    let rowOutput = ansi.cursorTo(frame.x, y) + rowBgStyle;
    let visibleLen = 0;

    const ctx: OverlayRowContext = {
      get length(): number {
        return visibleLen;
      },
      write(text: string, style?: OverlayTextStyle): void {
        rowOutput += styleText(text, rowBgStyle, style);
        visibleLen += Array.from(text).length;
      },
      pad(count: number): void {
        if (count <= 0) return;
        rowOutput += " ".repeat(count);
        visibleLen += count;
      },
      remaining(): number {
        return Math.max(0, frame.width - visibleLen);
      },
    };

    render(ctx);

    const remaining = frame.width - visibleLen;
    if (remaining > 0) {
      rowOutput += " ".repeat(remaining);
    }
    output += rowOutput;
  };

  const blankRow = (y: number, rowOptions: OverlayRowOptions = {}): void => {
    row(y, () => {}, rowOptions);
  };

  const blankRows = (
    startY: number,
    count: number,
    rowOptions: OverlayRowOptions = {},
  ): void => {
    for (let offset = 0; offset < count; offset++) {
      blankRow(startY + offset, rowOptions);
    }
  };

  const textRow = (
    y: number,
    text: string,
    textOptions: OverlayTextRowOptions = {},
  ): void => {
    row(y, (ctx) => {
      ctx.pad(textOptions.paddingLeft ?? 0);
      ctx.write(text, {
        color: textOptions.color,
        bold: textOptions.bold,
        dim: textOptions.dim,
      });
      ctx.pad(textOptions.paddingRight ?? 0);
    }, textOptions);
  };

  const balancedRow = (
    y: number,
    leftText: string,
    rightText: string,
    contentWidth: number,
    balancedOptions: OverlayBalancedRowOptions = {},
  ): TwoColumnTextLayout => {
    const layout = buildBalancedTextRow(
      contentWidth,
      leftText,
      rightText,
      {
        minGap: balancedOptions.minGap,
        maxRightWidth: balancedOptions.maxRightWidth,
      },
    );

    row(y, (ctx) => {
      ctx.pad(balancedOptions.paddingLeft ?? 0);
      if (layout.leftText) {
        ctx.write(layout.leftText, {
          color: balancedOptions.leftColor,
          bold: balancedOptions.leftBold,
          dim: balancedOptions.leftDim,
        });
      }
      ctx.pad(layout.gapWidth);
      if (layout.rightText) {
        ctx.write(layout.rightText, {
          color: balancedOptions.rightColor,
          bold: balancedOptions.rightBold,
          dim: balancedOptions.rightDim,
        });
      }
      ctx.pad(balancedOptions.paddingRight ?? 0);
    }, balancedOptions);

    return layout;
  };

  const sectionRow = (
    y: number,
    label: string,
    contentWidth: number,
    sectionOptions: OverlaySectionRowOptions = {},
  ): string => {
    const text = buildSectionLabelText(label, contentWidth);
    textRow(y, text, {
      paddingLeft: sectionOptions.paddingLeft,
      color: sectionOptions.color ?? colors.section,
      selected: sectionOptions.selected,
    });
    return text;
  };

  return {
    frame,
    colors,
    blankRow,
    blankRows,
    row,
    textRow,
    balancedRow,
    sectionRow,
    appendRaw(value: string): void {
      output += value;
    },
    finish(): string {
      output += drawOverlayFrame(frame, {
        borderColor,
        backgroundColor,
        title,
        rightText,
      });
      output += ansi.reset + ansi.cursorRestore + ansi.cursorShow;
      return output;
    },
  };
}
