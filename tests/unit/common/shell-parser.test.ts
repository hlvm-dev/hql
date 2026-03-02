/**
 * Tests for shell-parser.ts
 *
 * Coverage:
 * - Basic command parsing
 * - Single/double quote handling
 * - Escape sequences
 * - Dangerous operator detection (|, &&, ||, ;)
 * - Error cases (unclosed quotes, trailing backslash)
 * - Edge cases (empty strings, whitespace)
 */

import { assertEquals, assertThrows } from "jsr:@std/assert";
import {
  parseShellCommand,
  isSafeCommand,
  getUnsafeReason,
  ShellParseError,
} from "../../../src/common/shell-parser.ts";

// ============================================================
// Basic Parsing Tests
// ============================================================

Deno.test("parseShellCommand - simple command", () => {
  const result = parseShellCommand("ls -la");

  assertEquals(result.program, "ls");
  assertEquals(result.args, ["-la"]);
  assertEquals(result.hasPipes, false);
  assertEquals(result.hasChaining, false);
  assertEquals(result.raw, "ls -la");
});

Deno.test("parseShellCommand - multiple arguments", () => {
  const result = parseShellCommand("git commit -m fix bug");

  assertEquals(result.program, "git");
  assertEquals(result.args, ["commit", "-m", "fix", "bug"]);
});

Deno.test("parseShellCommand - command with path", () => {
  const result = parseShellCommand("./script.sh --flag value");

  assertEquals(result.program, "./script.sh");
  assertEquals(result.args, ["--flag", "value"]);
});

Deno.test("parseShellCommand - handles tabs and multiple spaces", () => {
  const result = parseShellCommand("echo   hello\t\tworld");

  assertEquals(result.program, "echo");
  assertEquals(result.args, ["hello", "world"]);
});

// ============================================================
// Quote Handling Tests
// ============================================================

Deno.test("parseShellCommand - double quoted argument", () => {
  const result = parseShellCommand('git commit -m "fix: bug #123"');

  assertEquals(result.program, "git");
  assertEquals(result.args, ["commit", "-m", "fix: bug #123"]);
});

Deno.test("parseShellCommand - single quoted argument", () => {
  const result = parseShellCommand("echo 'hello world'");

  assertEquals(result.program, "echo");
  assertEquals(result.args, ["hello world"]);
});

Deno.test("parseShellCommand - mixed quotes", () => {
  const result = parseShellCommand(`echo "He said 'hello'" world`);

  assertEquals(result.program, "echo");
  assertEquals(result.args, ["He said 'hello'", "world"]);
});

Deno.test("parseShellCommand - single quote inside double quotes", () => {
  const result = parseShellCommand(`echo "It's working"`);

  assertEquals(result.program, "echo");
  assertEquals(result.args, ["It's working"]);
});

Deno.test("parseShellCommand - double quote inside single quotes", () => {
  const result = parseShellCommand(`echo 'She said "hi"'`);

  assertEquals(result.program, "echo");
  assertEquals(result.args, ['She said "hi"']);
});

Deno.test("parseShellCommand - empty quoted string", () => {
  const result = parseShellCommand('echo "" test');

  assertEquals(result.program, "echo");
  assertEquals(result.args, ["test"]);
});

// ============================================================
// Escape Sequence Tests
// ============================================================

Deno.test("parseShellCommand - escaped double quote", () => {
  const result = parseShellCommand('echo "She said \\"hello\\""');

  assertEquals(result.program, "echo");
  assertEquals(result.args, ['She said "hello"']);
});

Deno.test("parseShellCommand - escaped backslash", () => {
  const result = parseShellCommand("echo path\\\\to\\\\file");

  assertEquals(result.program, "echo");
  assertEquals(result.args, ["path\\to\\file"]);
});

Deno.test("parseShellCommand - escaped newline", () => {
  const result = parseShellCommand("echo hello\\nworld");

  assertEquals(result.program, "echo");
  assertEquals(result.args, ["hello\nworld"]);
});

Deno.test("parseShellCommand - escaped tab", () => {
  const result = parseShellCommand("echo hello\\tworld");

  assertEquals(result.program, "echo");
  assertEquals(result.args, ["hello\tworld"]);
});

Deno.test("parseShellCommand - backslash in single quotes is literal", () => {
  const result = parseShellCommand("echo 'hello\\nworld'");

  assertEquals(result.program, "echo");
  assertEquals(result.args, ["hello\\nworld"]);
});

Deno.test("parseShellCommand - escaped space preserves space", () => {
  const result = parseShellCommand("echo hello\\ world");

  assertEquals(result.program, "echo");
  assertEquals(result.args, ["hello world"]);
});

// ============================================================
// Dangerous Operator Detection Tests
// ============================================================

Deno.test("parseShellCommand - detects pipe operator", () => {
  const result = parseShellCommand("ls | grep test");

  assertEquals(result.hasPipes, true);
  assertEquals(result.hasChaining, false);
  assertEquals(result.args, ["grep", "test"]);
});

Deno.test("parseShellCommand - detects semicolon chaining", () => {
  const result = parseShellCommand("echo hello; echo world");

  assertEquals(result.hasPipes, false);
  assertEquals(result.hasChaining, true);
  assertEquals(result.args, ["hello", "echo", "world"]);
});

Deno.test("parseShellCommand - detects AND operator", () => {
  const result = parseShellCommand("mkdir test && cd test");

  assertEquals(result.hasPipes, false);
  assertEquals(result.hasChaining, true);
  assertEquals(result.args, ["test", "cd", "test"]);
});

Deno.test("parseShellCommand - detects OR operator", () => {
  const result = parseShellCommand("test -f file || echo missing");

  assertEquals(result.hasPipes, false);
  assertEquals(result.hasChaining, true);
  assertEquals(result.args, ["-f", "file", "echo", "missing"]);
});

Deno.test("parseShellCommand - detects chaining without surrounding spaces", () => {
  const result = parseShellCommand("echo a&&echo b");

  assertEquals(result.hasPipes, false);
  assertEquals(result.hasChaining, true);
  assertEquals(result.args, ["a", "echo", "b"]);
});

Deno.test("parseShellCommand - detects redirect operator without leaking tokens", () => {
  const result = parseShellCommand("cat foo > out.txt");

  assertEquals(result.hasRedirects, true);
  assertEquals(result.args, ["foo", "out.txt"]);
});

Deno.test("parseShellCommand - pipe in quotes is safe", () => {
  const result = parseShellCommand('echo "ls | grep"');

  assertEquals(result.hasPipes, false);
  assertEquals(result.hasChaining, false);
  assertEquals(result.args, ["ls | grep"]);
});

Deno.test("parseShellCommand - semicolon in quotes is safe", () => {
  const result = parseShellCommand('echo "cmd1; cmd2"');

  assertEquals(result.hasPipes, false);
  assertEquals(result.hasChaining, false);
  assertEquals(result.args, ["cmd1; cmd2"]);
});

// ============================================================
// Error Cases
// ============================================================

Deno.test("parseShellCommand - unclosed double quote", () => {
  assertThrows(
    () => parseShellCommand('echo "hello'),
    ShellParseError,
    "Unclosed double quote",
  );
});

Deno.test("parseShellCommand - unclosed single quote", () => {
  assertThrows(
    () => parseShellCommand("echo 'hello"),
    ShellParseError,
    "Unclosed single quote",
  );
});

Deno.test("parseShellCommand - trailing backslash", () => {
  assertThrows(
    () => parseShellCommand("echo hello\\"),
    ShellParseError,
    "Trailing backslash",
  );
});

Deno.test("parseShellCommand - empty string", () => {
  assertThrows(
    () => parseShellCommand(""),
    ShellParseError,
    "Empty command",
  );
});

Deno.test("parseShellCommand - whitespace only", () => {
  assertThrows(
    () => parseShellCommand("   \t  "),
    ShellParseError,
    "Empty command",
  );
});

// ============================================================
// Safety Helper Tests
// ============================================================

Deno.test("isSafeCommand - safe command returns true", () => {
  const cmd = parseShellCommand("ls -la");
  assertEquals(isSafeCommand(cmd), true);
});

Deno.test("isSafeCommand - command with pipe returns false", () => {
  const cmd = parseShellCommand("ls | grep test");
  assertEquals(isSafeCommand(cmd), false);
});

Deno.test("isSafeCommand - command with chaining returns false", () => {
  const cmd = parseShellCommand("echo a && echo b");
  assertEquals(isSafeCommand(cmd), false);
});

Deno.test("getUnsafeReason - describes pipe", () => {
  const cmd = parseShellCommand("ls | grep test");
  const reason = getUnsafeReason(cmd);
  assertEquals(reason.includes("pipe"), true);
});

Deno.test("getUnsafeReason - describes chaining", () => {
  const cmd = parseShellCommand("echo a && echo b");
  const reason = getUnsafeReason(cmd);
  assertEquals(reason.includes("chaining"), true);
});

Deno.test("getUnsafeReason - describes both", () => {
  const cmd = parseShellCommand("ls | grep test && echo done");
  const reason = getUnsafeReason(cmd);
  assertEquals(reason.includes("pipe"), true);
  assertEquals(reason.includes("chaining"), true);
});

Deno.test("getUnsafeReason - safe command", () => {
  const cmd = parseShellCommand("ls -la");
  const reason = getUnsafeReason(cmd);
  assertEquals(reason, "Command is safe");
});

// ============================================================
// Real-World Test Cases
// ============================================================

Deno.test("parseShellCommand - git commit with message", () => {
  const result = parseShellCommand('git commit -m "feat: add new feature"');

  assertEquals(result.program, "git");
  assertEquals(result.args, ["commit", "-m", "feat: add new feature"]);
  assertEquals(isSafeCommand(result), true);
});

Deno.test("parseShellCommand - curl with complex URL", () => {
  const result = parseShellCommand('curl "https://api.example.com/users?id=123"');

  assertEquals(result.program, "curl");
  assertEquals(result.args, ["https://api.example.com/users?id=123"]);
});

Deno.test("parseShellCommand - find with complex args", () => {
  const result = parseShellCommand('find . -name "*.ts" -type f');

  assertEquals(result.program, "find");
  assertEquals(result.args, [".", "-name", "*.ts", "-type", "f"]);
});

Deno.test("parseShellCommand - deno run with permissions", () => {
  const result = parseShellCommand("deno run --allow-read --allow-write script.ts");

  assertEquals(result.program, "deno");
  assertEquals(result.args, ["run", "--allow-read", "--allow-write", "script.ts"]);
});

Deno.test("parseShellCommand - complex SQL query in quotes", () => {
  const result = parseShellCommand(`sqlite3 db.sqlite "SELECT * FROM users WHERE name='John'"`);

  assertEquals(result.program, "sqlite3");
  assertEquals(result.args, ["db.sqlite", "SELECT * FROM users WHERE name='John'"]);
});

// ============================================================
// Edge Cases
// ============================================================

Deno.test("parseShellCommand - single character command", () => {
  const result = parseShellCommand("w");

  assertEquals(result.program, "w");
  assertEquals(result.args, []);
});

Deno.test("parseShellCommand - command with only flags", () => {
  const result = parseShellCommand("ls -la -h -t");

  assertEquals(result.program, "ls");
  assertEquals(result.args, ["-la", "-h", "-t"]);
});

Deno.test("parseShellCommand - preserves argument order", () => {
  const result = parseShellCommand("cmd arg1 arg2 arg3 arg4");

  assertEquals(result.args, ["arg1", "arg2", "arg3", "arg4"]);
});

Deno.test("parseShellCommand - handles leading/trailing whitespace", () => {
  const result = parseShellCommand("  \t  echo hello  \t  ");

  assertEquals(result.program, "echo");
  assertEquals(result.args, ["hello"]);
});
