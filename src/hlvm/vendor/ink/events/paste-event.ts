import { TerminalEvent } from "./terminal-event.ts";

export class PasteEvent extends TerminalEvent {
  readonly text: string;

  constructor(text: string) {
    super("paste");
    this.text = text;
  }
}
