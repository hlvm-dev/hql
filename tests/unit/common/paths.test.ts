import { assertEquals, assertThrows } from "jsr:@std/assert";
import {
  getHlvmDir,
  resetHlvmDirCacheForTests,
} from "../../../src/common/paths.ts";
import { getPlatform, setPlatform } from "../../../src/platform/platform.ts";

function withMockedPlatform(
  overrides: {
    hlvmDir: string;
    cwd: string;
    writableDirs: Set<string>;
  },
  fn: () => void,
): void {
  const original = getPlatform();
  const { hlvmDir, cwd, writableDirs } = overrides;

  const mocked = {
    ...original,
    env: {
      ...original.env,
      get: (key: string) => {
        if (key === "HLVM_DIR") return hlvmDir;
        return original.env.get(key);
      },
    },
    process: {
      ...original.process,
      cwd: () => cwd,
    },
    fs: {
      ...original.fs,
      statSync: (...args: Parameters<typeof original.fs.statSync>) => {
        const value = String(args[0]);
        if (!writableDirs.has(value)) {
          throw new Error(`ENOENT: ${value}`);
        }
        return {
          isFile: false,
          isDirectory: true,
          isSymlink: false,
          size: 0,
          mtime: null,
        } as ReturnType<typeof original.fs.statSync>;
      },
      mkdirSync: (...args: Parameters<typeof original.fs.mkdirSync>) => {
        const value = String(args[0]);
        if (!writableDirs.has(value)) {
          throw new Error(`EACCES: ${value}`);
        }
      },
      writeTextFileSync: (
        ...args: Parameters<typeof original.fs.writeTextFileSync>
      ) => {
        const value = String(args[0]);
        const parentDir = value.replace(/\/[^/]+$/, "");
        if (!writableDirs.has(parentDir)) {
          throw new Error(`EACCES: ${value}`);
        }
      },
      removeSync: (..._args: Parameters<typeof original.fs.removeSync>) => {
        // noop for write-probe cleanup in tests
      },
    },
  };

  setPlatform(mocked as unknown as ReturnType<typeof getPlatform>);
  resetHlvmDirCacheForTests();
  try {
    fn();
  } finally {
    setPlatform(original);
    resetHlvmDirCacheForTests();
  }
}

Deno.test("getHlvmDir - falls back to cwd/.hlvm when override is not writable", () => {
  const hlvmDir = "/blocked/.hlvm";
  const cwd = "/tmp/hlvm-paths-test";
  const fallback = `${cwd}/.hlvm`;

  withMockedPlatform(
    {
      hlvmDir,
      cwd,
      writableDirs: new Set([fallback]),
    },
    () => {
      const actual = getHlvmDir();
      assertEquals(actual, fallback);
    },
  );
});

Deno.test("getHlvmDir - throws when both override and fallback are not writable", () => {
  const hlvmDir = "/blocked/.hlvm";
  const cwd = "/tmp/hlvm-paths-test";

  withMockedPlatform(
    {
      hlvmDir,
      cwd,
      writableDirs: new Set<string>(),
    },
    () => {
      assertThrows(
        () => getHlvmDir(),
        Error,
        "Unable to find writable HLVM directory",
      );
    },
  );
});
