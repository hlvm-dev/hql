# Platform Abstraction Layer

This document describes the platform abstraction layer that enables HLVM to run on different JavaScript runtimes (Deno, Node.js, Bun) in the future.

## Overview

All platform-specific operations (file system, environment, terminal, process) are abstracted behind a `Platform` interface. The only code that makes `Deno.*` runtime API calls is in `src/platform/deno-platform.ts`.

> **Note**: String literals like `Symbol.for("Deno.customInspect")` and comments mentioning Deno are allowed throughout the codebase as they don't create runtime dependencies.

## Architecture

```
src/platform/
├── types.ts           # Platform interfaces (PlatformFs, PlatformEnv, etc.)
├── platform.ts        # Singleton getter/setter (getPlatform, setPlatform)
├── deno-platform.ts   # Deno implementation (only file with Deno.* runtime calls)
└── errors.ts          # Platform-agnostic error handling
```

## Usage

### In TypeScript/JavaScript Code

```typescript
import { getPlatform } from "./platform/platform.ts";

// File system operations
const content = await getPlatform().fs.readTextFile("/path/to/file");
await getPlatform().fs.writeTextFile("/path/to/file", content);

// Environment variables
const value = getPlatform().env.get("MY_VAR");
getPlatform().env.set("MY_VAR", "value");

// Process operations
const cwd = getPlatform().process.cwd();
getPlatform().process.exit(0);

// Terminal operations
const isInteractive = getPlatform().terminal.stdin.isTerminal();
const size = getPlatform().terminal.consoleSize();

// Command execution
const output = await getPlatform().command.output({
  cmd: ["git", "status"],
  cwd: "/path/to/repo",
});
```

### In HQL Code

HQL code uses the `hlvm` global API, which is initialized from the platform. The naming follows industry standards (Deno, Bun, etc.) - no underscores for public APIs:

```lisp
;; File operations
(js-call hlvm.fs "readTextFile" path)
(js-call hlvm.fs "writeTextFile" path content)
(js-call hlvm.fs "readFile" path)  ; binary read
(js-call hlvm.fs "cwd")

;; Environment
(js-call hlvm.env "get" "HOME")
(js-call hlvm.env "set" "MY_VAR" "value")

;; Debug logging
(js-call hlvm.log "debug" "category" "message" data)
```

## Platform Interface

### PlatformFs

```typescript
interface PlatformFs {
  readTextFile(path: string): Promise<string>;
  readTextFileSync(path: string): string;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  writeTextFile(path: string, content: string, options?: { append?: boolean; create?: boolean; mode?: number }): Promise<void>;
  writeTextFileSync(path: string, content: string, options?: { append?: boolean; create?: boolean; mode?: number }): void;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  mkdirSync(path: string, options?: { recursive?: boolean }): void;
  ensureDir(path: string): Promise<void>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  removeSync(path: string, options?: { recursive?: boolean }): void;
  stat(path: string): Promise<{ isFile: boolean; isDirectory: boolean; isSymlink: boolean; size: number }>;
  statSync(path: string): { isFile: boolean; isDirectory: boolean; isSymlink: boolean; size: number };
  readDir(path: string): AsyncIterable<{ name: string; isFile: boolean; isDirectory: boolean; isSymlink: boolean }>;
  makeTempDir(options?: { prefix?: string; suffix?: string }): Promise<string>;
  exists(path: string): Promise<boolean>;
  existsSync(path: string): boolean;
  copyFile(src: string, dest: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  realPathSync(path: string): string;
}
```

### PlatformEnv

```typescript
interface PlatformEnv {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}
```

### PlatformProcess

```typescript
interface PlatformProcess {
  cwd(): string;
  execPath(): string;
  args(): string[];
  exit(code: number): never;
  addSignalListener(signal: "SIGINT" | "SIGTERM" | "SIGHUP" | "SIGQUIT", handler: () => void): void;
}
```

### PlatformTerminal

```typescript
interface PlatformTerminal {
  stdin: {
    read(buffer: Uint8Array): Promise<number | null>;
    isTerminal(): boolean;
    setRaw(raw: boolean): void;
  };
  stdout: {
    writeSync(data: Uint8Array): number;
    write(data: Uint8Array): Promise<number>;
  };
  consoleSize(): { columns: number; rows: number };
}
```

### PlatformCommand

```typescript
interface PlatformCommand {
  run(options: PlatformCommandOptions): PlatformCommandProcess;
  output(options: PlatformCommandOptions): Promise<PlatformCommandOutput>;
}
```

## Error Handling

Instead of checking `error instanceof Deno.errors.NotFound`, use the platform error wrapper:

```typescript
import { PlatformError } from "./platform/platform.ts";

try {
  // ...
} catch (error) {
  const platformError = PlatformError.wrap(error);
  if (PlatformError.isNotFound(platformError)) {
  // Handle not found error
  }
}
```

## Enforcement

The platform abstraction is enforced in CI via `deno task check:platform`. This script ensures:

1. No `Deno.*` runtime calls outside `src/platform/deno-platform.ts` (errors.ts is allowed for comments/strings only)
2. No `js/Deno.*` usage in HQL packages (use `hlvm` global instead)
3. Test files and scripts are excluded from enforcement
4. `vendor/repl/src/` is included in enforcement (project code, not third-party)

**Allowed exceptions** (not runtime dependencies):
- `Symbol.for("Deno.customInspect")` - symbol name strings for custom inspect
- Comments mentioning Deno
- String literals containing "Deno."

## Future Runtime Support

To add support for a new runtime (e.g., Node.js):

1. Create `src/platform/node-platform.ts` implementing the `Platform` interface
2. Call `setPlatform(NodePlatform)` during initialization to swap the runtime
3. Run all tests to ensure compatibility

The platform abstraction is designed to be minimal but complete - it covers all the runtime-specific operations needed by HLVM without exposing unnecessary APIs.
