import { assertEquals, assertThrows } from "jsr:@std/assert";
import {
  getUnsafeReason,
  isSafeCommand,
  parseShellCommand,
  ShellParseError,
} from "../../../src/common/shell-parser.ts";

Deno.test("shell-parser: parses basic commands with whitespace normalization", () => {
  const input = "  \t  echo   hello\tworld  ";
  const result = parseShellCommand(input);

  assertEquals(result, {
    program: "echo",
    args: ["hello", "world"],
    hasPipes: false,
    hasChaining: false,
    hasRedirects: false,
    raw: input,
  });
});

Deno.test("shell-parser: preserves quoted and escaped argument content", () => {
  const cases = [
    ['git commit -m "fix: bug #123"', ["commit", "-m", "fix: bug #123"]],
    ["echo 'hello\\nworld'", ["hello\\nworld"]],
    ['echo "She said \\\"hello\\\""', ['She said "hello"']],
    ["echo hello\\ world", ["hello world"]],
    [`sqlite3 db.sqlite "SELECT * FROM users WHERE name='John'"`, ["db.sqlite", "SELECT * FROM users WHERE name='John'"]],
  ] as const;

  for (const [command, args] of cases) {
    const parsed = parseShellCommand(command);
    assertEquals(parsed.args, Array.from(args), command);
  }
});

Deno.test("shell-parser: detects pipes, chaining, and redirects without leaking operator tokens into args", () => {
  const pipe = parseShellCommand("ls | grep test");
  const chain = parseShellCommand("mkdir test && cd test");
  const redirect = parseShellCommand("cat foo > out.txt");

  assertEquals(pipe.hasPipes, true);
  assertEquals(pipe.hasChaining, false);
  assertEquals(pipe.args, ["grep", "test"]);

  assertEquals(chain.hasPipes, false);
  assertEquals(chain.hasChaining, true);
  assertEquals(chain.args, ["test", "cd", "test"]);

  assertEquals(redirect.hasRedirects, true);
  assertEquals(redirect.args, ["foo", "out.txt"]);
});

Deno.test("shell-parser: quoted operators remain inert and safe", () => {
  const quotedPipe = parseShellCommand('echo "ls | grep"');
  const quotedSemicolon = parseShellCommand('echo "cmd1; cmd2"');

  assertEquals(quotedPipe.hasPipes, false);
  assertEquals(quotedPipe.hasChaining, false);
  assertEquals(quotedPipe.args, ["ls | grep"]);

  assertEquals(quotedSemicolon.hasPipes, false);
  assertEquals(quotedSemicolon.hasChaining, false);
  assertEquals(quotedSemicolon.args, ["cmd1; cmd2"]);
});

Deno.test("shell-parser: malformed or empty input throws ShellParseError", () => {
  const cases = [
    ['echo "hello', "Unclosed double quote"],
    ["echo 'hello", "Unclosed single quote"],
    ["echo hello\\", "Trailing backslash"],
    ["", "Empty command"],
    ["   \t  ", "Empty command"],
  ] as const;

  for (const [command, message] of cases) {
    assertThrows(
      () => parseShellCommand(command),
      ShellParseError,
      message,
    );
  }
});

Deno.test("shell-parser: safety helpers summarize parsed risk accurately", () => {
  const safe = parseShellCommand("git commit -m \"feat: add new feature\"");
  const dangerous = parseShellCommand("ls | grep test && echo done");

  assertEquals(isSafeCommand(safe), true);
  assertEquals(getUnsafeReason(safe), "Command is safe");

  assertEquals(isSafeCommand(dangerous), false);
  const reason = getUnsafeReason(dangerous);
  assertEquals(reason.includes("pipe"), true);
  assertEquals(reason.includes("chaining"), true);
});
