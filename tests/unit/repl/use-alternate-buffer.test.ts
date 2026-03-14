import { assertEquals } from "jsr:@std/assert@1";
import { resolveWritableStdout } from "../../../src/hlvm/cli/repl-ink/hooks/useAlternateBuffer.ts";

Deno.test("resolveWritableStdout preserves the original stream receiver for write()", () => {
  let receiver: unknown;
  const stdout = {
    isTTY: true,
    write(this: unknown, chunk: string) {
      receiver = this;
      return chunk === "\x1b[?1049h";
    },
  };

  const stream = resolveWritableStdout(stdout);

  assertEquals(stream, stdout);
  assertEquals(stream?.write("\x1b[?1049h"), true);
  assertEquals(receiver, stdout);
});

Deno.test("resolveWritableStdout rejects values without a writable stream interface", () => {
  assertEquals(resolveWritableStdout(undefined), null);
  assertEquals(resolveWritableStdout({}), null);
  assertEquals(resolveWritableStdout({ write: "not-a-function" }), null);
});
