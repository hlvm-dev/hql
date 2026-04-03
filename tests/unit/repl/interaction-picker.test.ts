import { assertEquals } from "jsr:@std/assert@1";
import { resolvePickerDigitSelection } from "../../../src/hlvm/cli/repl-ink/components/conversation/InteractionPicker.tsx";

Deno.test("resolvePickerDigitSelection maps number keys to option indices", () => {
  assertEquals(resolvePickerDigitSelection("1", 3), 0);
  assertEquals(resolvePickerDigitSelection("2", 3), 1);
  assertEquals(resolvePickerDigitSelection("3", 3), 2);
});

Deno.test("resolvePickerDigitSelection maps keypad digits to option indices", () => {
  assertEquals(resolvePickerDigitSelection("Oq", 3), 0);
  assertEquals(resolvePickerDigitSelection("Or", 3), 1);
  assertEquals(resolvePickerDigitSelection("\x1bOq", 3), 0);
});

Deno.test("resolvePickerDigitSelection ignores out-of-range and non-digit input", () => {
  assertEquals(resolvePickerDigitSelection("4", 3), undefined);
  assertEquals(resolvePickerDigitSelection("0", 3), undefined);
  assertEquals(resolvePickerDigitSelection("Op", 3), undefined);
  assertEquals(resolvePickerDigitSelection("a", 3), undefined);
  assertEquals(resolvePickerDigitSelection("", 3), undefined);
});
