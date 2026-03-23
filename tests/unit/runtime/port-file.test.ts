import {
  assertEquals,
  assertNotEquals,
} from "jsr:@std/assert";
import { getPlatform } from "../../../src/platform/platform.ts";
import {
  getServerInfoPath,
  getRuntimeDir,
  type ServerInfo,
} from "../../../src/common/paths.ts";
import {
  HLVM_RUNTIME_DEFAULT_PORT,
  readPortFromServerInfo,
  resolveHlvmRuntimePort,
} from "../../../src/hlvm/runtime/host-config.ts";
import { withRuntimePortOverrideForTests } from "../../../src/hlvm/runtime/host-config.ts";
import { getHlvmDir, resetHlvmDirCacheForTests } from "../../../src/common/paths.ts";

// Use a temp directory for all tests to avoid touching the real ~/.hlvm
async function withTempHlvmDir<T>(fn: () => Promise<T>): Promise<T> {
  const platform = getPlatform();
  const originalHlvmDir = platform.env.get("HLVM_DIR");
  const tmpDir = await platform.fs.makeTempDir({ prefix: "hlvm-port-test-" });
  platform.env.set("HLVM_DIR", tmpDir);
  resetHlvmDirCacheForTests();
  try {
    return await fn();
  } finally {
    if (originalHlvmDir) {
      platform.env.set("HLVM_DIR", originalHlvmDir);
    } else {
      platform.env.delete("HLVM_DIR");
    }
    resetHlvmDirCacheForTests();
    try {
      await platform.fs.remove(tmpDir, { recursive: true });
    } catch { /* cleanup best-effort */ }
  }
}

Deno.test("readPortFromServerInfo returns undefined when no file exists", async () => {
  await withTempHlvmDir(async () => {
    const result = readPortFromServerInfo();
    assertEquals(result, undefined);
  });
});

Deno.test("readPortFromServerInfo reads valid server.json", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const runtimeDir = getRuntimeDir();
    await platform.fs.mkdir(runtimeDir, { recursive: true });

    const info: ServerInfo = {
      port: 54321,
      pid: 12345,
      authToken: "test-token",
      startedAt: new Date().toISOString(),
    };
    await platform.fs.writeTextFile(
      getServerInfoPath(),
      JSON.stringify(info),
    );

    const result = readPortFromServerInfo();
    assertEquals(result, 54321);
  });
});

Deno.test("readPortFromServerInfo returns undefined for invalid JSON", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const runtimeDir = getRuntimeDir();
    await platform.fs.mkdir(runtimeDir, { recursive: true });

    await platform.fs.writeTextFile(getServerInfoPath(), "not json");

    const result = readPortFromServerInfo();
    assertEquals(result, undefined);
  });
});

Deno.test("readPortFromServerInfo returns undefined for out-of-range port", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const runtimeDir = getRuntimeDir();
    await platform.fs.mkdir(runtimeDir, { recursive: true });

    await platform.fs.writeTextFile(
      getServerInfoPath(),
      JSON.stringify({ port: 99999, pid: 1, authToken: "", startedAt: "" }),
    );

    const result = readPortFromServerInfo();
    assertEquals(result, undefined);
  });
});

Deno.test("resolveHlvmRuntimePort reads from server.json when no env override", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const runtimeDir = getRuntimeDir();
    await platform.fs.mkdir(runtimeDir, { recursive: true });

    const info: ServerInfo = {
      port: 54321,
      pid: 12345,
      authToken: "test-token",
      startedAt: new Date().toISOString(),
    };
    await platform.fs.writeTextFile(
      getServerInfoPath(),
      JSON.stringify(info),
    );

    // Clear any env override
    const prev = platform.env.get("HLVM_REPL_PORT");
    platform.env.delete("HLVM_REPL_PORT");
    try {
      const port = resolveHlvmRuntimePort();
      assertEquals(port, 54321);
    } finally {
      if (prev) platform.env.set("HLVM_REPL_PORT", prev);
    }
  });
});

Deno.test("resolveHlvmRuntimePort prefers env over server.json", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const runtimeDir = getRuntimeDir();
    await platform.fs.mkdir(runtimeDir, { recursive: true });

    await platform.fs.writeTextFile(
      getServerInfoPath(),
      JSON.stringify({ port: 54321, pid: 1, authToken: "", startedAt: "" }),
    );

    const prev = platform.env.get("HLVM_REPL_PORT");
    platform.env.set("HLVM_REPL_PORT", "9999");
    try {
      const port = resolveHlvmRuntimePort();
      assertEquals(port, 9999);
    } finally {
      if (prev) {
        platform.env.set("HLVM_REPL_PORT", prev);
      } else {
        platform.env.delete("HLVM_REPL_PORT");
      }
    }
  });
});

Deno.test("resolveHlvmRuntimePort falls back to default when no file and no env", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const prev = platform.env.get("HLVM_REPL_PORT");
    platform.env.delete("HLVM_REPL_PORT");
    try {
      const port = resolveHlvmRuntimePort();
      assertEquals(port, HLVM_RUNTIME_DEFAULT_PORT);
    } finally {
      if (prev) platform.env.set("HLVM_REPL_PORT", prev);
    }
  });
});

Deno.test("getServerInfoPath points to .runtime/server.json", async () => {
  await withTempHlvmDir(async () => {
    const path = getServerInfoPath();
    const hlvmDir = getHlvmDir();
    assertEquals(path, `${hlvmDir}/.runtime/server.json`);
  });
});

Deno.test("test override port takes priority over server.json", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const runtimeDir = getRuntimeDir();
    await platform.fs.mkdir(runtimeDir, { recursive: true });

    await platform.fs.writeTextFile(
      getServerInfoPath(),
      JSON.stringify({ port: 54321, pid: 1, authToken: "", startedAt: "" }),
    );

    const prev = platform.env.get("HLVM_REPL_PORT");
    platform.env.delete("HLVM_REPL_PORT");
    try {
      const port = await withRuntimePortOverrideForTests(19999, async () => {
        return resolveHlvmRuntimePort();
      });
      assertEquals(port, 19999);
    } finally {
      if (prev) platform.env.set("HLVM_REPL_PORT", prev);
    }
  });
});
