/**
 * NodePlatform tests — run under Deno via node: compat layer.
 *
 * These tests verify that NodePlatform implements the Platform interface
 * correctly by exercising each sub-interface against real Node.js APIs.
 */

import { assertEquals, assertNotEquals } from "jsr:@std/assert";
import { NodePlatform } from "../../../src/platform/node-platform.ts";
import * as nodePath from "node:path";

// =============================================================================
// File System Tests
// =============================================================================

Deno.test("NodePlatform.fs.readTextFile + writeTextFile round-trip", async () => {
  const tmpDir = await NodePlatform.fs.makeTempDir({ prefix: "np-test" });
  const filePath = NodePlatform.path.join(tmpDir, "test.txt");
  const content = "hello from NodePlatform";

  await NodePlatform.fs.writeTextFile(filePath, content);
  const read = await NodePlatform.fs.readTextFile(filePath);
  assertEquals(read, content);

  // Cleanup
  await NodePlatform.fs.remove(tmpDir, { recursive: true });
});

Deno.test("NodePlatform.fs.readTextFileSync + writeTextFileSync round-trip", async () => {
  const tmpDir = await NodePlatform.fs.makeTempDir({ prefix: "np-test" });
  const filePath = NodePlatform.path.join(tmpDir, "sync-test.txt");
  const content = "sync content";

  NodePlatform.fs.writeTextFileSync(filePath, content);
  const read = NodePlatform.fs.readTextFileSync(filePath);
  assertEquals(read, content);

  await NodePlatform.fs.remove(tmpDir, { recursive: true });
});

Deno.test("NodePlatform.fs.readFile + writeFile binary round-trip", async () => {
  const tmpDir = await NodePlatform.fs.makeTempDir({ prefix: "np-test" });
  const filePath = NodePlatform.path.join(tmpDir, "binary.dat");
  const data = new Uint8Array([0, 1, 2, 255, 128, 64]);

  await NodePlatform.fs.writeFile(filePath, data);
  const read = await NodePlatform.fs.readFile(filePath);
  assertEquals(new Uint8Array(read), data);

  await NodePlatform.fs.remove(tmpDir, { recursive: true });
});

Deno.test("NodePlatform.fs.exists returns true for existing, false for missing", async () => {
  const tmpDir = await NodePlatform.fs.makeTempDir({ prefix: "np-test" });
  const filePath = NodePlatform.path.join(tmpDir, "exists-test.txt");

  assertEquals(await NodePlatform.fs.exists(filePath), false);

  await NodePlatform.fs.writeTextFile(filePath, "x");
  assertEquals(await NodePlatform.fs.exists(filePath), true);

  await NodePlatform.fs.remove(tmpDir, { recursive: true });
});

Deno.test("NodePlatform.fs.stat returns correct file info", async () => {
  const tmpDir = await NodePlatform.fs.makeTempDir({ prefix: "np-test" });
  const filePath = NodePlatform.path.join(tmpDir, "stat-test.txt");
  await NodePlatform.fs.writeTextFile(filePath, "hello");

  const fileStat = await NodePlatform.fs.stat(filePath);
  assertEquals(fileStat.isFile, true);
  assertEquals(fileStat.isDirectory, false);
  assertEquals(fileStat.size, 5);

  const dirStat = await NodePlatform.fs.stat(tmpDir);
  assertEquals(dirStat.isFile, false);
  assertEquals(dirStat.isDirectory, true);

  await NodePlatform.fs.remove(tmpDir, { recursive: true });
});

Deno.test("NodePlatform.fs.mkdir + readDir works", async () => {
  const tmpDir = await NodePlatform.fs.makeTempDir({ prefix: "np-test" });
  const subDir = NodePlatform.path.join(tmpDir, "sub");

  await NodePlatform.fs.mkdir(subDir, { recursive: true });
  await NodePlatform.fs.writeTextFile(
    NodePlatform.path.join(subDir, "a.txt"),
    "a",
  );
  await NodePlatform.fs.writeTextFile(
    NodePlatform.path.join(subDir, "b.txt"),
    "b",
  );

  const entries: string[] = [];
  for await (const entry of NodePlatform.fs.readDir(subDir)) {
    entries.push(entry.name);
  }
  entries.sort();
  assertEquals(entries, ["a.txt", "b.txt"]);

  await NodePlatform.fs.remove(tmpDir, { recursive: true });
});

Deno.test("NodePlatform.fs.ensureDir creates nested dirs", async () => {
  const tmpDir = await NodePlatform.fs.makeTempDir({ prefix: "np-test" });
  const deep = NodePlatform.path.join(tmpDir, "a", "b", "c");

  await NodePlatform.fs.ensureDir(deep);
  const stat = await NodePlatform.fs.stat(deep);
  assertEquals(stat.isDirectory, true);

  // Second call should not throw
  await NodePlatform.fs.ensureDir(deep);

  await NodePlatform.fs.remove(tmpDir, { recursive: true });
});

Deno.test("NodePlatform.fs.copyFile works", async () => {
  const tmpDir = await NodePlatform.fs.makeTempDir({ prefix: "np-test" });
  const src = NodePlatform.path.join(tmpDir, "src.txt");
  const dest = NodePlatform.path.join(tmpDir, "dest.txt");

  await NodePlatform.fs.writeTextFile(src, "copy me");
  await NodePlatform.fs.copyFile(src, dest);
  const content = await NodePlatform.fs.readTextFile(dest);
  assertEquals(content, "copy me");

  await NodePlatform.fs.remove(tmpDir, { recursive: true });
});

Deno.test("NodePlatform.fs.writeTextFile with append option", async () => {
  const tmpDir = await NodePlatform.fs.makeTempDir({ prefix: "np-test" });
  const filePath = NodePlatform.path.join(tmpDir, "append.txt");

  await NodePlatform.fs.writeTextFile(filePath, "first");
  await NodePlatform.fs.writeTextFile(filePath, "-second", { append: true });
  const content = await NodePlatform.fs.readTextFile(filePath);
  assertEquals(content, "first-second");

  await NodePlatform.fs.remove(tmpDir, { recursive: true });
});

// =============================================================================
// Environment Tests
// =============================================================================

Deno.test("NodePlatform.env.get returns PATH (non-empty)", () => {
  const path = NodePlatform.env.get("PATH");
  assertNotEquals(path, undefined);
  assertNotEquals(path, "");
});

Deno.test("NodePlatform.env.set + get round-trip", () => {
  const key = `NP_TEST_${Date.now()}`;
  assertEquals(NodePlatform.env.get(key), undefined);

  NodePlatform.env.set(key, "test-value");
  assertEquals(NodePlatform.env.get(key), "test-value");
});

// =============================================================================
// Process Tests
// =============================================================================

Deno.test("NodePlatform.process.cwd returns valid path", () => {
  const cwd = NodePlatform.process.cwd();
  assertEquals(typeof cwd, "string");
  assertEquals(NodePlatform.path.isAbsolute(cwd), true);
});

Deno.test("NodePlatform.process.execPath returns non-empty string", () => {
  const execPath = NodePlatform.process.execPath();
  assertEquals(typeof execPath, "string");
  assertNotEquals(execPath, "");
});

// =============================================================================
// Path Tests
// =============================================================================

Deno.test("NodePlatform.path.join works", () => {
  const result = NodePlatform.path.join("a", "b", "c");
  assertEquals(result, nodePath.join("a", "b", "c"));
});

Deno.test("NodePlatform.path.dirname + basename + extname", () => {
  const p = "/foo/bar/baz.ts";
  assertEquals(NodePlatform.path.dirname(p), "/foo/bar");
  assertEquals(NodePlatform.path.basename(p), "baz.ts");
  assertEquals(NodePlatform.path.basename(p, ".ts"), "baz");
  assertEquals(NodePlatform.path.extname(p), ".ts");
});

Deno.test("NodePlatform.path.isAbsolute", () => {
  assertEquals(NodePlatform.path.isAbsolute("/foo"), true);
  assertEquals(NodePlatform.path.isAbsolute("foo"), false);
});

Deno.test("NodePlatform.path.fromFileUrl + toFileUrl round-trip", () => {
  const path = "/tmp/test-file.txt";
  const url = NodePlatform.path.toFileUrl(path);
  assertEquals(url.protocol, "file:");
  const back = NodePlatform.path.fromFileUrl(url);
  assertEquals(back, path);
});

// =============================================================================
// Build Info Tests
// =============================================================================

Deno.test("NodePlatform.build.os is valid", () => {
  const validOs = ["darwin", "linux", "windows"];
  assertEquals(validOs.includes(NodePlatform.build.os), true);
});

// =============================================================================
// Command Tests
// =============================================================================

Deno.test("NodePlatform.command.output runs echo", async () => {
  const result = await NodePlatform.command.output({
    cmd: ["echo", "hello"],
  });
  assertEquals(result.success, true);
  assertEquals(result.code, 0);
  const stdout = new TextDecoder().decode(result.stdout).trim();
  assertEquals(stdout, "hello");
});

Deno.test("NodePlatform.command.output captures stderr", async () => {
  // Use a command that writes to stderr
  const result = await NodePlatform.command.output({
    cmd: ["sh", "-c", "echo error >&2"],
  });
  const stderr = new TextDecoder().decode(result.stderr).trim();
  assertEquals(stderr, "error");
});

Deno.test("NodePlatform.command.output reports failure", async () => {
  const result = await NodePlatform.command.output({
    cmd: ["sh", "-c", "exit 42"],
  });
  assertEquals(result.success, false);
  assertEquals(result.code, 42);
});

Deno.test("NodePlatform.command.run with piped stdout", async () => {
  const proc = NodePlatform.command.run({
    cmd: ["echo", "streamed"],
    stdout: "piped",
    stderr: "null",
  });

  const status = await proc.status;
  assertEquals(status.success, true);

  // Read from the Web ReadableStream
  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  const output = new TextDecoder().decode(combined).trim();
  assertEquals(output, "streamed");
});

// =============================================================================
// Terminal Tests
// =============================================================================

Deno.test("NodePlatform.terminal.consoleSize returns valid dimensions", () => {
  const size = NodePlatform.terminal.consoleSize();
  assertEquals(typeof size.columns, "number");
  assertEquals(typeof size.rows, "number");
  assertEquals(size.columns > 0, true);
  assertEquals(size.rows > 0, true);
});

Deno.test("NodePlatform.terminal.stdout.writeSync writes bytes", () => {
  const data = new TextEncoder().encode("");
  const written = NodePlatform.terminal.stdout.writeSync(data);
  assertEquals(written, 0);
});
