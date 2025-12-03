# HQL CLI Architecture

## Status: Approved
## Date: 2025-12-03

---

## Executive Summary

The HQL CLI is a **self-contained binary** that wraps Deno transparently. Users interact only with `hql` commands — they never need to know Deno exists.

**Key Principle**: HQL owns the user experience. Deno is an implementation detail.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           HQL CLI ARCHITECTURE                                   │
│                         "Transparent Deno Integration"                           │
└─────────────────────────────────────────────────────────────────────────────────┘

                              ┌─────────────────┐
                              │   User Types    │
                              │                 │
                              │  hql run app    │
                              │  hql compile    │
                              └────────┬────────┘
                                       │
                                       ▼
                              ┌─────────────────┐
                              │    HQL CLI      │
                              │   (binary)      │
                              │                 │
                              │ Built with      │
                              │ deno compile    │
                              └────────┬────────┘
                                       │
                    ┌────────────────────┴────────────────────┐
                    │                                         │
                    ▼                                         ▼
            ┌─────────────┐                           ┌─────────────┐
            │  hql run    │                           │ hql compile │
            │             │                           │             │
            │ Execute HQL │                           │ HQL → JS or │
            │ directly    │                           │ Binary      │
            └─────────────┘                           └──────┬──────┘
                                                         │
                                              ┌──────────┴──────────┐
                                              │                     │
                                              ▼                     ▼
                                        ┌───────────┐        ┌───────────┐
                                        │ --target  │        │ --target  │
                                        │   js      │        │  native   │
                                        │           │        │  linux    │
                                        │ (default) │        │  macos    │
                                        │ JavaScript│        │  windows  │
                                        └───────────┘        └─────┬─────┘
                                                                   │
                                                                   ▼
                                                          ┌───────────────┐
                                                          │ Deno.execPath │
                                                          │    compile    │
                                                          │               │
                                                          │ (internal)    │
                                                          └───────────────┘
```

---

## The Key Insight: We ARE Deno

Since HQL runs on Deno, and the HQL binary is built with `deno compile`:

```typescript
// When HQL is running, we can get the Deno binary that's executing us
const denoBinary = Deno.execPath();  // Returns path to current Deno/HQL binary

// This means:
// 1. No need to download Deno separately
// 2. The embedded Deno CAN compile other code
// 3. We spawn ourselves to do the compilation
```

**Critical realization**: A `deno compile`d binary can still invoke `deno compile` on other code by spawning a new process using `Deno.execPath()`.

---

## CLI Commands

### Available Commands

```bash
hql repl                    # Interactive REPL
hql init                    # Initialize new HQL project
hql run app.hql             # Execute HQL file directly
hql compile app.hql         # Compile to JavaScript or binary
hql publish                 # Publish package
```

### `hql compile`

```bash
# Compile to JavaScript (default)
hql compile app.hql                    # → app.js

# Compile to native binary (wraps deno compile)
hql compile app.hql --target native    # → app (binary for current platform)
hql compile app.hql --target native -o myapp  # → myapp (custom name)

# Cross-compilation (friendly names)
hql compile app.hql --target linux       # → Linux x86_64 binary
hql compile app.hql --target macos       # → macOS ARM64 binary (Apple Silicon)
hql compile app.hql --target macos-intel # → macOS x86_64 binary (Intel)
hql compile app.hql --target windows     # → Windows x86_64 .exe

# Compile for all platforms at once
hql compile app.hql --target all         # → 4 binaries (linux, macos, macos-intel, windows)

# Deno target pass-through (for advanced users)
hql compile app.hql --target x86_64-unknown-linux-gnu
hql compile app.hql --target x86_64-pc-windows-msvc
hql compile app.hql --target x86_64-apple-darwin
hql compile app.hql --target aarch64-apple-darwin
```

---

## Target Mapping

| Friendly Name | Deno Target | Output |
|---------------|-------------|--------|
| `js` (default) | N/A | JavaScript file |
| `native` | (current platform) | Binary for current OS |
| `all` | (all platforms) | 4 binaries for all platforms |
| `linux` | `x86_64-unknown-linux-gnu` | Linux x86_64 binary |
| `macos` | `aarch64-apple-darwin` | macOS ARM64 binary (Apple Silicon) |
| `macos-intel` | `x86_64-apple-darwin` | macOS x86_64 binary (Intel) |
| `windows` | `x86_64-pc-windows-msvc` | Windows x86_64 .exe |

Unknown targets are passed through to Deno directly.

---

## Implementation Design

### File Structure

```
src/cli/
├── cli.ts                    # Main CLI entry, command dispatch
├── commands/
│   ├── compile.ts            # Compile command (JS or binary)
│   ├── init.ts               # Init command
│   ├── publish.ts            # Publish command
│   └── shared.ts             # Shared utilities
├── repl.ts                   # REPL command
├── run.ts                    # Run command
└── utils/
    ├── cli-options.ts        # Option parsing
    ├── common-helpers.ts     # Common CLI helpers
    └── toolchain.ts          # Deno binary management
```

### Compile Command Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  hql compile app.hql --target native                                            │
└─────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
                    ┌─────────────────────────────────────┐
                    │ 1. Parse command options            │
                    │    - input: app.hql                 │
                    │    - target: native                 │
                    │    - output: (derived from input)   │
                    └──────────────────┬──────────────────┘
                                       │
                                       ▼
                    ┌─────────────────────────────────────┐
                    │ 2. Compile HQL → JavaScript         │
                    │    - Use HQL transpiler             │
                    │    - Output: temp .js file          │
                    └──────────────────┬──────────────────┘
                                       │
                                       ▼
                    ┌─────────────────────────────────────┐
                    │ 3. If target !== 'js':              │
                    │    Invoke deno compile              │
                    └──────────────────┬──────────────────┘
                                       │
                                       ▼
                    ┌─────────────────────────────────────┐
                    │ 4. Get Deno binary                  │
                    │    denoBinary = Deno.execPath()     │
                    └──────────────────┬──────────────────┘
                                       │
                                       ▼
                    ┌─────────────────────────────────────┐
                    │ 5. Build deno compile args          │
                    │    ['compile', '--allow-all',       │
                    │     '--target', denoTarget,         │
                    │     '--output', outputPath,         │
                    │     tempJsFile]                     │
                    └──────────────────┬──────────────────┘
                                       │
                                       ▼
                    ┌─────────────────────────────────────┐
                    │ 6. Execute: Deno.Command            │
                    │    new Deno.Command(denoBinary,     │
                    │                     { args })       │
                    └──────────────────┬──────────────────┘
                                       │
                                       ▼
                    ┌─────────────────────────────────────┐
                    │ 7. Clean up temp files              │
                    │    Report success/failure           │
                    └─────────────────────────────────────┘
```

---

## Error Handling

### User-Friendly Errors

Never expose Deno internals to users:

```typescript
// BAD: Exposing Deno error
throw new Error(`deno compile failed: ${denoStderr}`);

// GOOD: HQL-branded error
throw new Error(`Compilation failed for target '${target}'. ${friendlyMessage}`);
```

### Common Error Cases

| Scenario | User Message |
|----------|--------------|
| Invalid target | `Unknown target '${target}'. Valid targets: native, linux, macos, macos-intel, windows` |
| Input not found | `File not found: ${inputFile}` |
| Compilation fails | `Compilation failed. Check that your code runs correctly with 'hql run ${input}'` |
| Cross-compile unavailable | `Cross-compilation to ${target} requires downloading additional tools. Run 'hql setup ${target}' first.` |

---

## Permissions Model

When compiling to binary, HQL uses `--allow-all` by default (matching Deno's behavior for compiled binaries).

Future enhancement: Allow users to specify restricted permissions:

```bash
# Future: Restricted permissions
hql compile app.hql --target native --allow-read --allow-net
```

---

## Distribution

### Building the HQL Binary

```bash
# Build HQL CLI itself
deno compile --allow-all --output hql src/main.ts

# Cross-compile HQL CLI
deno compile --allow-all --target x86_64-unknown-linux-gnu --output hql-linux src/main.ts
deno compile --allow-all --target aarch64-apple-darwin --output hql-macos src/main.ts
deno compile --allow-all --target x86_64-apple-darwin --output hql-macos-intel src/main.ts
deno compile --allow-all --target x86_64-pc-windows-msvc --output hql.exe src/main.ts
```

### User Installation

Users download ONE binary:

```bash
# macOS/Linux
curl -fsSL https://hql.dev/install.sh | sh

# Or direct download
wget https://github.com/hql-lang/hql/releases/latest/download/hql-$(uname -s)-$(uname -m)
chmod +x hql
mv hql /usr/local/bin/
```

---

## Design Principles

1. **Single Binary**: Users download ONE file, not a toolchain
2. **No External Dependencies**: Everything works out of the box
3. **Deno is Hidden**: Users never type "deno", never see Deno errors
4. **Progressive Disclosure**: Simple commands by default, advanced options available
5. **Cross-Platform**: Same commands work on all platforms

---

## Future Enhancements

### Toolchain Management (Optional)

```bash
# Future: Manage compilation targets
hql setup linux     # Download Linux cross-compilation tools
hql setup all       # Download all targets
hql targets         # List available targets
```

### Bundle Optimization (Optional)

```bash
# Future: Tree-shaking and minification
hql compile app.hql --target native --optimize
```

### Workspace Support (Optional)

```bash
# Future: Compile entire workspace
hql compile --workspace
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1 | 2025-12-03 | Initial specification |
