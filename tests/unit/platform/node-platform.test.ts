import { assertEquals, assertNotEquals } from "jsr:@std/assert";
import * as nodePath from "node:path";
import { NodePlatform } from "../../../src/platform/node-platform.ts";

async function withTempDir(fn: (tmpDir: string) => Promise<void>): Promise<void> {
  const tmpDir = await NodePlatform.fs.makeTempDir({ prefix: "np-test" });
  try {
    await fn(tmpDir);
  } finally {
    await NodePlatform.fs.remove(tmpDir, { recursive: true });
  }
}

Deno.test("NodePlatform: file APIs round-trip text, sync text, binary, append, existence, and stat", async () => {
  await withTempDir(async (tmpDir) => {
    const textPath = NodePlatform.path.join(tmpDir, "test.txt");
    const syncPath = NodePlatform.path.join(tmpDir, "sync.txt");
    const binaryPath = NodePlatform.path.join(tmpDir, "binary.dat");

    await NodePlatform.fs.writeTextFile(textPath, "hello");
    await NodePlatform.fs.writeTextFile(textPath, "-world", { append: true });
    NodePlatform.fs.writeTextFileSync(syncPath, "sync content");
    await NodePlatform.fs.writeFile(binaryPath, new Uint8Array([0, 1, 2, 255]));

    assertEquals(await NodePlatform.fs.readTextFile(textPath), "hello-world");
    assertEquals(NodePlatform.fs.readTextFileSync(syncPath), "sync content");
    assertEquals(await NodePlatform.fs.exists(textPath), true);
    assertEquals(new Uint8Array(await NodePlatform.fs.readFile(binaryPath)), new Uint8Array([0, 1, 2, 255]));

    const fileStat = await NodePlatform.fs.stat(textPath);
    const dirStat = await NodePlatform.fs.stat(tmpDir);
    assertEquals(fileStat.isFile, true);
    assertEquals(fileStat.size, "hello-world".length);
    assertEquals(dirStat.isDirectory, true);
  });
});

Deno.test("NodePlatform: directory helpers create, ensure, list, and copy files", async () => {
  await withTempDir(async (tmpDir) => {
    const nestedDir = NodePlatform.path.join(tmpDir, "a", "b", "c");
    const sourcePath = NodePlatform.path.join(nestedDir, "src.txt");
    const destPath = NodePlatform.path.join(nestedDir, "dest.txt");

    await NodePlatform.fs.ensureDir(nestedDir);
    await NodePlatform.fs.mkdir(NodePlatform.path.join(tmpDir, "listed"), { recursive: true });
    await NodePlatform.fs.writeTextFile(sourcePath, "copy me");
    await NodePlatform.fs.copyFile(sourcePath, destPath);

    const entries: string[] = [];
    for await (const entry of NodePlatform.fs.readDir(nestedDir)) {
      entries.push(entry.name);
    }
    entries.sort();

    assertEquals(entries, ["dest.txt", "src.txt"]);
    assertEquals(await NodePlatform.fs.readTextFile(destPath), "copy me");
    assertEquals((await NodePlatform.fs.stat(nestedDir)).isDirectory, true);
  });
});

Deno.test("NodePlatform: env and process helpers expose the active runtime", () => {
  const key = `NP_TEST_${Date.now()}`;
  const cwd = NodePlatform.process.cwd();
  const execPath = NodePlatform.process.execPath();

  assertNotEquals(NodePlatform.env.get("PATH"), undefined);
  NodePlatform.env.set(key, "test-value");
  assertEquals(NodePlatform.env.get(key), "test-value");
  assertEquals(typeof cwd, "string");
  assertEquals(NodePlatform.path.isAbsolute(cwd), true);
  assertNotEquals(execPath, "");
});

Deno.test("NodePlatform: path helpers match Node path behavior", () => {
  const filePath = "/foo/bar/baz.ts";
  const fileUrl = NodePlatform.path.toFileUrl("/tmp/test-file.txt");

  assertEquals(NodePlatform.path.join("a", "b", "c"), nodePath.join("a", "b", "c"));
  assertEquals(NodePlatform.path.dirname(filePath), "/foo/bar");
  assertEquals(NodePlatform.path.basename(filePath), "baz.ts");
  assertEquals(NodePlatform.path.basename(filePath, ".ts"), "baz");
  assertEquals(NodePlatform.path.extname(filePath), ".ts");
  assertEquals(NodePlatform.path.isAbsolute("/foo"), true);
  assertEquals(NodePlatform.path.isAbsolute("foo"), false);
  assertEquals(fileUrl.protocol, "file:");
  assertEquals(NodePlatform.path.fromFileUrl(fileUrl), "/tmp/test-file.txt");
});

Deno.test("NodePlatform: build info reports a supported OS", () => {
  assertEquals(["darwin", "linux", "windows"].includes(NodePlatform.build.os), true);
});

Deno.test("NodePlatform: command.output captures stdout, stderr, and failure codes", async () => {
  const success = await NodePlatform.command.output({ cmd: ["echo", "hello"] });
  const stderr = await NodePlatform.command.output({ cmd: ["sh", "-c", "echo error >&2"] });
  const failure = await NodePlatform.command.output({ cmd: ["sh", "-c", "exit 42"] });

  assertEquals(success.success, true);
  assertEquals(new TextDecoder().decode(success.stdout).trim(), "hello");
  assertEquals(new TextDecoder().decode(stderr.stderr).trim(), "error");
  assertEquals(failure.success, false);
  assertEquals(failure.code, 42);
});

Deno.test("NodePlatform: command.run exposes streamed stdout", async () => {
  const proc = NodePlatform.command.run({
    cmd: ["echo", "streamed"],
    stdout: "piped",
    stderr: "null",
  });

  const status = await proc.status;
  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  assertEquals(status.success, true);
  assertEquals(new TextDecoder().decode(combined).trim(), "streamed");
});

Deno.test("NodePlatform: terminal helpers return sane defaults and writable stdout", () => {
  const size = NodePlatform.terminal.consoleSize();
  const written = NodePlatform.terminal.stdout.writeSync(new TextEncoder().encode(""));

  assertEquals(typeof size.columns, "number");
  assertEquals(typeof size.rows, "number");
  assertEquals(size.columns > 0, true);
  assertEquals(size.rows > 0, true);
  assertEquals(written, 0);
});
