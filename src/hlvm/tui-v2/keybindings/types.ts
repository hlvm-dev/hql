export type KeyContext = "global" | "chat" | "code" | "confirmation" | "overlay";

export interface Keystroke {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

export interface KeyBinding {
  context: KeyContext;
  keystroke: Keystroke;
  action: string;
}
