# 📘 HQL Complete Usage and Build Guide

**Version:** 0.1.0
**Last Updated:** 2025-11-13
**Status:** Production Ready (with noted limitations)

---

## 📋 Table of Contents

1. [Quick Start](#quick-start)
2. [All Ways to Use HQL](#all-ways-to-use-hql)
3. [Running HQL Code](#running-hql-code)
4. [Transpiling HQL to JavaScript](#transpiling-hql-to-javascript)
5. [Programmatic API Usage](#programmatic-api-usage)
6. [Building HQL Binary](#building-hql-binary)
7. [Distribution](#distribution)
8. [Troubleshooting](#troubleshooting)
9. [Architecture Overview](#architecture-overview)

---

## 🚀 Quick Start

### Option 1: Run Directly with Deno (Recommended for Development)

```bash
# Run an HQL file
deno run -A https://raw.githubusercontent.com/hlvm/hlvm/main/src/hql/core/cli/run.ts hello.hql

# Or clone and run locally
git clone https://github.com/hlvm/hlvm.git
cd hlvm/src/hql
deno run -A core/cli/run.ts hello.hql
```

### Option 2: Install CLI Globally

```bash
# Install via Deno
deno install -A -n hql https://raw.githubusercontent.com/hlvm/hlvm/main/src/hql/core/cli/cli.ts

# Use anywhere
hql run hello.hql
```

### Option 3: Build and Install Binary (Local)

```bash
cd hlvm/src/hql
make build
make install  # Copies to /usr/local/bin
hql run hello.hql
```

---

## 🎯 All Ways to Use HQL

### 1. Command Line Interface (CLI)

```bash
# Run HQL file
hql run program.hql
hql run program.hql --verbose
hql run program.hql --time
hql run program.hql --debug

# Transpile to JavaScript
hql transpile program.hql
hql transpile program.hql --verbose

# Initialize new project
hql init
hql init --help

# Publish to JSR/NPM
hql publish
hql publish --dry-run

# Get help
hql --help
hql --version
hql run --help
```

### 2. Direct Deno Execution (Development)

```bash
# Run HQL file
deno run -A core/cli/run.ts program.hql
deno run -A core/cli/run.ts program.hql --verbose

# Transpile
deno run -A core/cli/cli.ts transpile program.hql

# Use from anywhere (absolute path)
deno run -A /path/to/hlvm/src/hql/core/cli/run.ts program.hql
```

### 3. Programmatic API (TypeScript/JavaScript)

```typescript
import { run, transpile, isHQL, runFile } from "jsr:@yourname/hql";
// Or: from "https://deno.land/x/hql/mod.ts"
// Or: from "./mod.ts" (local)

// Run inline HQL code
const result = await run("(+ 1 2 3)");
console.log(result); // Output: 6

// Run HQL file
const fileResult = await runFile("./program.hql");

// Transpile to JavaScript
const jsCode = await transpile('(print "Hello")');
console.log(jsCode); // Output: console.log('Hello');

// Check if string is HQL
if (isHQL("(+ 1 2)")) {
  console.log("This is HQL code!");
}

// Transpile with options
const result = await transpile(source, {
  baseDir: "./src",
  generateSourceMap: true,
});
console.log(result.code);
console.log(result.sourceMap);
```

### 4. As a Library in Web Projects

```html
<!-- Browser (via CDN) -->
<script type="module">
  import hql from 'https://esm.sh/@yourname/hql';

  const result = await hql.run('(+ 1 2)');
  console.log(result); // 3
</script>
```

```typescript
// Node.js (via NPM)
import hql from 'hql';

const code = await hql.transpile('(print "Hello")');
console.log(code);
```

---

## 🏃 Running HQL Code

### File Execution

#### Basic Run

```bash
# Create HQL file
echo '(print "Hello, World!")' > hello.hql

# Run it
hql run hello.hql
# Output: Hello, World!
```

#### With Options

```bash
# Verbose output (shows transpilation steps)
hql run program.hql --verbose

# Show performance timing
hql run program.hql --time

# Debug mode (detailed errors and stack traces)
hql run program.hql --debug

# Filter logs to specific namespaces
hql run program.hql --log "transpiler,runtime"
```

### Inline Code Execution (Via API)

```typescript
// Method 1: Using run() API
import { run } from "./mod.ts";

const result = await run("(+ 1 2 3)");
console.log(result); // 6

// Method 2: Complex expressions
const complexResult = await run(`
  (let x 10)
  (let y 20)
  (+ x y)
`);
console.log(complexResult); // 30

// Method 3: With imports
const withImports = await run(`
  (import "./math.hql")
  (add 5 10)
`);
```

### Running HQL with Different Input Sources

```bash
# 1. From file
hql run program.hql

# 2. From URL (future)
hql run https://example.com/program.hql

# 3. Via programmatic API
deno run -A <<EOF
import { run } from "./mod.ts";
await run('(print "Hello")');
EOF
```

---

## 🔄 Transpiling HQL to JavaScript

### CLI Transpilation

```bash
# Basic transpile
hql transpile program.hql
# Creates: program.js

# With verbose output
hql transpile program.hql --verbose

# Custom output location
hql transpile program.hql -o output.js
```

### Output Format

**Input:** `program.hql`
```lisp
(let x 10)
(let y 20)
(print (+ x y))
```

**Output:** `program.js`
```javascript
// .hql-cache/1/__external__/program.ts
const x = 10;
const y = 20;
console.log(x + y);
//# sourceMappingURL=data:application/json;base64,...
```

### API Transpilation

```typescript
import { transpile } from "./mod.ts";

// Simple transpile
const code = await transpile('(+ 1 2)');
console.log(code); // "1 + 2"

// With source maps
const result = await transpile(source, {
  generateSourceMap: true,
  currentFile: "myfile.hql",
});
console.log(result.code);
console.log(result.sourceMap);

// With base directory (for imports)
const withImports = await transpile(source, {
  baseDir: "./src",
  currentFile: "./src/main.hql",
});
```

### Transpile Options

```typescript
interface TranspileOptions {
  baseDir?: string;              // Base directory for resolving imports
  currentFile?: string;          // Current file path (for source maps)
  generateSourceMap?: boolean;   // Generate source maps
  sourceContent?: string;        // Original source (embedded in source map)
}
```

---

## 💻 Programmatic API Usage

### Complete API Reference

#### Core Functions

```typescript
import {
  // Main functions
  run,              // Run HQL code
  runFile,          // Run HQL file
  transpile,        // Transpile to JavaScript
  isHQL,           // Check if string is HQL

  // Macro system
  macroexpand,     // Expand all macros
  macroexpand1,    // Expand one level

  // Runtime functions (from runtime/index.ts)
  defineMacro,     // Define runtime macro
  hqlEval,         // Evaluate HQL at runtime
  gensym,          // Generate unique symbol
  hasMacro,        // Check if macro exists
  getMacros,       // Get all macros
  resetRuntime,    // Reset runtime state

  // Platform abstraction
  getPlatform,     // Get current platform
  setPlatform,     // Set platform (Node.js vs Deno)
  useNodePlatform, // Switch to Node.js mode

  // Version
  version,         // HQL version string
} from "./mod.ts";
```

#### Usage Examples

**1. Run HQL Code**

```typescript
import { run } from "./mod.ts";

// Simple expression
const sum = await run("(+ 1 2 3)");
console.log(sum); // 6

// Multiple statements
const result = await run(`
  (let x 10)
  (let y 20)
  (+ x y)
`);
console.log(result); // 30

// With options
const withOptions = await run(source, {
  baseDir: "./src",
  currentFile: "main.hql",
  adapter: customEvalFunction, // Custom execution context
});
```

**2. Run HQL File**

```typescript
import { runFile } from "./mod.ts";

// Basic file execution
const result = await runFile("./program.hql");
console.log(result);

// With options
const resultWithOpts = await runFile("./program.hql", {
  baseDir: "./src",
  verbose: true,
});
```

**3. Transpile HQL**

```typescript
import { transpile } from "./mod.ts";

// Basic transpile (returns string)
const jsCode = await transpile('(print "Hello")');
console.log(jsCode); // 'use strict';\nconsole.log('Hello');

// With source maps (returns object)
const result = await transpile(source, {
  generateSourceMap: true,
  currentFile: "program.hql",
  sourceContent: source,
});
console.log(result.code);       // JavaScript code
console.log(result.sourceMap);  // Source map JSON
```

**4. Macro Expansion**

```typescript
import { macroexpand, macroexpand1 } from "./mod.ts";

// Expand all macros
const expanded = await macroexpand(`
  (when (> x 10)
    (print x))
`);
console.log(expanded); // Fully expanded forms

// Expand one level only
const oneLevelExpanded = await macroexpand1(`
  (when (> x 10)
    (print x))
`);
console.log(oneLevelExpanded); // One expansion step
```

**5. Platform Abstraction**

```typescript
import { useNodePlatform, getPlatform } from "./mod.ts";

// Switch to Node.js mode (auto-detected usually)
await useNodePlatform();

// Check current platform
const platform = getPlatform();
console.log(platform.name); // "deno" or "node"
```

**6. Runtime Macros**

```typescript
import { defineMacro, hqlEval, getMacros } from "./mod.ts";

// Define runtime macro
defineMacro("myMacro", (args) => {
  // Transform args
  return transformedForm;
});

// Evaluate HQL at runtime
const result = await hqlEval('(+ 1 2)');

// Get all defined macros
const macros = getMacros();
console.log(Object.keys(macros));
```

### Integration Examples

**Express.js Server**

```typescript
import express from 'npm:express';
import { run } from "./mod.ts";

const app = express();

app.post('/eval', async (req, res) => {
  try {
    const result = await run(req.body.code);
    res.json({ result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.listen(3000);
```

**REPL Implementation**

```typescript
import { run } from "./mod.ts";

async function repl() {
  while (true) {
    const input = prompt("hql> ");
    if (!input) continue;
    if (input === "exit") break;

    try {
      const result = await run(input);
      console.log("=>", result);
    } catch (error) {
      console.error("Error:", error.message);
    }
  }
}

await repl();
```

**Build Tool Integration**

```typescript
import { transpile } from "./mod.ts";
import { walk } from "https://deno.land/std/fs/walk.ts";

// Transpile all .hql files in directory
for await (const entry of walk("./src")) {
  if (entry.path.endsWith(".hql")) {
    const source = await Deno.readTextFile(entry.path);
    const result = await transpile(source, {
      generateSourceMap: true,
      currentFile: entry.path,
    });

    const outPath = entry.path.replace(".hql", ".js");
    await Deno.writeTextFile(outPath, result.code);
    await Deno.writeTextFile(outPath + ".map", result.sourceMap);
  }
}
```

---

## 🔨 Building HQL Binary

### Prerequisites

```bash
# 1. Deno installed
deno --version
# deno 1.40.0 or higher

# 2. Make installed
make --version

# 3. Clone repository
git clone https://github.com/hlvm/hlvm.git
cd hlvm/src/hql
```

### Build Process Overview

```
Source Code (TypeScript)
         ↓
    make build
         ↓
┌─────────────────────────────┐
│ 1. deno compile             │
│    - Bundles TypeScript     │
│    - Embeds Deno runtime    │
│    - Includes dependencies  │
└─────────────────────────────┘
         ↓
    hql binary (80MB)
    - Self-contained
    - Cross-platform capable
    - No external dependencies
```

### Build Commands

#### Basic Build (Current Platform)

```bash
# Build for your computer
make build

# Output:
# 🔨 Building HQL binary...
# ✅ Done! Binary: ./hql
# -rwxr-xr-x 80M hql
```

**What happens:**
1. Runs `deno compile --allow-all --no-check core/cli/cli.ts`
2. Creates `hql` binary in current directory
3. Binary size: ~80MB (includes Deno runtime + V8)

#### Test Build

```bash
# Build and run tests
make test

# What it does:
# 1. Builds binary
# 2. Runs: ./hql --version
# 3. Creates test.hql and runs it
# 4. Verifies output
```

#### Install System-Wide

```bash
# Copy to /usr/local/bin
make install

# Now available everywhere:
cd ~
hql --version
```

#### Build for All Platforms

```bash
# Build for Mac Intel, Mac ARM, Linux, Windows
make all

# Output files:
# hql-mac-intel
# hql-mac-arm
# hql-linux
# hql-windows.exe
```

#### Clean Build Artifacts

```bash
# Remove all built binaries
make clean
```

### Cross-Platform Build Targets

```bash
# Mac Intel (x86_64)
make build-mac-intel
# → hql-mac-intel

# Mac Apple Silicon (ARM64)
make build-mac-arm
# → hql-mac-arm

# Linux (x86_64)
make build-linux
# → hql-linux

# Windows (x86_64)
make build-windows
# → hql-windows.exe
```

### Manual Build (Without Make)

```bash
# Current platform
deno compile \
  --allow-all \
  --no-check \
  --output hql \
  core/cli/cli.ts

# Specific platform
deno compile \
  --allow-all \
  --no-check \
  --target x86_64-apple-darwin \
  --output hql-mac-intel \
  core/cli/cli.ts
```

### Build Configuration

**Makefile Variables:**

```makefile
VERSION := 0.1.0          # HQL version
BINARY := hql             # Binary name
TARGETS := ...            # Cross-platform targets
```

**Deno Compile Flags:**

- `--allow-all`: Grant all permissions (file, network, env)
- `--no-check`: Skip TypeScript type checking (faster)
- `--output`: Output binary name
- `--target`: Target platform for cross-compilation

### Binary Structure

```
hql (80MB total)
├── Deno Runtime (~50MB)
│   └── V8 JavaScript Engine
├── Your TypeScript Code (~2MB)
│   ├── core/cli/
│   ├── core/src/
│   └── runtime/
├── NPM Dependencies (~13MB)
│   ├── acorn (parser)
│   ├── escodegen (code generator)
│   ├── source-map
│   └── esbuild
└── Metadata (~15MB)
    └── Binary format overhead
```

### Current Limitations

⚠️ **Known Issues:**

1. **Missing Package Embedding**
   - HQL stdlib packages (@hql/string, @hql/math, etc.) not embedded
   - Binary can't resolve `(import "@hql/string")`
   - **Workaround:** Use local file imports
   - **Fix:** Need to implement `scripts/embed-packages.ts`

2. **Inline Expression Support**
   - `hql run '(+ 1 2)'` treats expression as filename
   - **Workaround:** Use API: `await run("(+ 1 2)")`
   - **Fix:** Add expression detection in cli.ts

3. **esbuild Bundler Issues**
   - Some complex import graphs fail
   - **Workaround:** Use simpler import structures
   - **Fix:** Improve bundler resolution

### Fixing Package Embedding

**The Solution (15 minutes):**

```bash
# 1. Create embedding script
cat > scripts/embed-packages.ts << 'EOF'
#!/usr/bin/env -S deno run --allow-read --allow-write
// Read packages/*.hql files
// Generate core/src/embedded-packages.ts
// Export as TypeScript constants
EOF

# 2. Update Makefile
# Add: ./scripts/embed-packages.ts before deno compile

# 3. Update mod.ts
# Check EMBEDDED_PACKAGES before file system

# 4. Rebuild
make build
```

See `DISTRIBUTION_GUIDE.md` for complete fix instructions.

---

## 📦 Distribution

### Distribution Methods

#### 1. GitHub Releases (Recommended)

```bash
# Build all platforms
make all

# Creates:
# hql-mac-intel, hql-mac-arm, hql-linux, hql-windows.exe

# Upload to GitHub Releases
# Users download and install
```

**User Installation:**

```bash
# Mac Intel
curl -L https://github.com/user/repo/releases/download/v0.1.0/hql-mac-intel -o hql
chmod +x hql
sudo mv hql /usr/local/bin/

# Mac ARM
curl -L https://github.com/user/repo/releases/download/v0.1.0/hql-mac-arm -o hql
chmod +x hql
sudo mv hql /usr/local/bin/
```

#### 2. Deno Install (Current)

```bash
deno install -A -n hql https://raw.githubusercontent.com/.../core/cli/cli.ts
```

**Pros:**
- Works immediately
- Auto-updates with `deno upgrade`
- No build required

**Cons:**
- Requires Deno installed
- Slower startup than binary

#### 3. Homebrew (Future)

```bash
# Create homebrew-hql repository
# Add formula:

class Hql < Formula
  desc "High-Level Query Language compiler"
  homepage "https://github.com/user/hql"
  url "https://github.com/user/hql/releases/download/v0.1.0/hql-mac-arm"
  sha256 "..."

  def install
    bin.install "hql-mac-arm" => "hql"
  end
end
```

**Users install:**
```bash
brew tap user/hql
brew install hql
```

#### 4. NPM Package (Future)

```bash
# Build with dnt (Deno to Node.js transpiler)
deno run -A scripts/build-npm.ts

# Publish
cd npm
npm publish

# Users install
npm install -g hql
```

### Installation Verification

```bash
# Check installation
which hql
# /usr/local/bin/hql

# Check version
hql --version
# HQL CLI version 0.1.0

# Test run
echo '(print "Success!")' > test.hql
hql run test.hql
# Success!
```

---

## 🐛 Troubleshooting

### Common Issues

#### 1. "Could not find stdlib.hql"

**Problem:** Binary can't find embedded packages

**Solutions:**

```bash
# Option A: Use Deno directly (works)
deno run -A core/cli/run.ts program.hql

# Option B: Use local imports instead of @hql/*
# Instead of: (import "@hql/string")
# Use: (import "./packages/string/mod.hql")

# Option C: Fix embedding (see DISTRIBUTION_GUIDE.md)
```

#### 2. "Unsupported file type" for Expression

**Problem:** CLI treats expression as filename

**Solution:**

```typescript
// Use API instead
import { run } from "./mod.ts";
const result = await run("(+ 1 2)");
```

#### 3. Binary Too Large (80MB)

**Problem:** Binary seems large

**Answer:** This is normal!
- Deno runtime: ~50MB (V8 engine)
- Your code: ~2MB
- Dependencies: ~13MB
- Overhead: ~15MB

**Comparison:**
- Node.js pkg binaries: 50-70MB
- Go binaries with runtime: 40-60MB
- HQL binary: 80MB (includes full runtime)

#### 4. Permission Denied

**Problem:** Can't execute binary

**Solution:**

```bash
chmod +x hql
# Or
sudo chmod +x /usr/local/bin/hql
```

#### 5. Slow Startup

**Problem:** Binary takes time to start

**Causes:**
- First run: OS security check
- Deno extracts to /tmp
- Runtime initialization

**Solutions:**

```bash
# After first run, subsequent runs are faster

# For development, use Deno directly (faster)
deno run -A core/cli/run.ts program.hql
```

#### 6. Type Errors During Build

**Problem:** `deno compile` shows TS errors

**Solution:**

```bash
# Use --no-check flag (already in Makefile)
deno compile --no-check --allow-all core/cli/cli.ts
```

### Debug Mode

```bash
# Enable detailed error output
hql run program.hql --debug

# Enable verbose logging
hql run program.hql --verbose

# Both
hql run program.hql --debug --verbose
```

### Performance Profiling

```bash
# Show timing information
hql run program.hql --time

# Output:
# ⏱️ Total Processing: 145ms
```

---

## 🏗️ Architecture Overview

### Execution Flow

```
┌─────────────────────────────────────────────┐
│ 1. INPUT                                     │
│    User runs: hql run program.hql           │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│ 2. CLI PARSING (core/cli/cli.ts)           │
│    - Parse arguments                         │
│    - Detect command (run/transpile/etc)     │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│ 3. FILE READING                              │
│    - Read program.hql from disk             │
│    - Load as string                          │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│ 4. PARSING (core/src/transpiler/parser.ts) │
│    Input:  (print "Hello")                  │
│    Output: AST (S-expression tree)          │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│ 5. MACRO EXPANSION                           │
│    - Expand macros recursively              │
│    - Resolve macro definitions              │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│ 6. SEMANTIC VALIDATION                       │
│    - Check variable bindings                │
│    - Validate function calls                │
│    - Type checking (basic)                  │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│ 7. HQL AST → HQL IR                         │
│    - Convert to intermediate representation │
│    - Normalize forms                         │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│ 8. IR → ESTree AST                          │
│    - Convert to JavaScript AST              │
│    - Generate source maps                   │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│ 9. CODE GENERATION (escodegen)              │
│    Input:  ESTree AST                       │
│    Output: JavaScript code                  │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│ 10. RUNTIME HELPERS INJECTION               │
│     - Add __hql_get helper                  │
│     - Add __hql_range helper                │
│     - Add other runtime functions           │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│ 11. EXECUTION                                │
│     - Write to temp file                    │
│     - Dynamic import                         │
│     - Run in Deno/V8                        │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│ 12. OUTPUT                                   │
│     Result: Hello                           │
└─────────────────────────────────────────────┘
```

### Component Architecture

```
core/
├── cli/                    # Command-line interface
│   ├── cli.ts             # Main CLI entry point
│   ├── run.ts             # Run command
│   ├── transpile.ts       # Transpile command
│   └── commands/          # init, publish commands
│
├── src/
│   ├── transpiler/        # Core compiler
│   │   ├── parser.ts      # HQL → AST
│   │   ├── pipeline/      # Compilation pipeline
│   │   │   ├── hql-ast-to-hql-ir.ts
│   │   │   ├── ir-to-estree.ts
│   │   │   └── js-code-generator.ts
│   │   └── syntax/        # Syntax handlers
│   │       ├── function.ts
│   │       ├── class.ts
│   │       └── ...
│   │
│   ├── common/            # Shared utilities
│   │   ├── error-system.ts
│   │   ├── runtime-helpers.ts
│   │   └── utils.ts
│   │
│   ├── platform/          # Platform abstraction
│   │   └── platform.ts    # Deno/Node.js compatibility
│   │
│   └── s-exp/            # S-expression handling
│       └── types.ts
│
├── runtime/              # Runtime API
│   └── index.ts         # Runtime functions
│
└── packages/            # Standard library
    ├── string/
    ├── math/
    ├── date/
    └── ...
```

### Tech Stack

```
┌─────────────────────────────────────┐
│ LANGUAGE                             │
│ • TypeScript (source code)          │
│ • HQL (target language)             │
└────────────────┬────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────┐
│ RUNTIME                              │
│ • Deno (TypeScript runtime)         │
│ • V8 (JavaScript engine)            │
└────────────────┬────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────┐
│ PARSER & CODE GENERATION            │
│ • acorn (JavaScript parser)         │
│ • escodegen (code generator)        │
│ • source-map (source maps)          │
└────────────────┬────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────┐
│ BUILD TOOLS                          │
│ • deno compile (binary compilation) │
│ • Make (build automation)           │
│ • esbuild (bundling)                │
└─────────────────────────────────────┘
```

---

## 📚 Quick Reference

### Essential Commands

```bash
# Development
deno run -A core/cli/run.ts program.hql

# Production
hql run program.hql

# Build
make build

# Install
make install

# Test
make test

# Clean
make clean
```

### File Extensions

- `.hql` - HQL source files
- `.js` - Transpiled JavaScript output
- `.ts` - TypeScript source (compiler itself)

### Environment Variables

```bash
# Force rebuild of transpiled files
export HQL_FORCE_REBUILD=true

# Disable cache
export HQL_NO_CACHE=true

# Debug mode
export HQL_DEBUG=true
```

### Important Paths

```bash
# Source
hlvm/src/hql/

# CLI entry point
core/cli/cli.ts

# API entry point
mod.ts

# Build output
./hql (binary)

# Cache directory
.hql-cache/

# Runtime directory
.hql-cache/rt/
```

---

## 🎓 Next Steps

### For Users

1. **Install HQL**: Choose installation method above
2. **Learn Syntax**: See `doc/` directory
3. **Write Code**: Create `.hql` files
4. **Run Programs**: `hql run program.hql`

### For Developers

1. **Clone Repo**: `git clone ...`
2. **Read Code**: Start with `mod.ts`, `core/cli/cli.ts`
3. **Run Tests**: `deno test --allow-all`
4. **Build Binary**: `make build`
5. **Contribute**: See `CONTRIBUTING.md`

### For Contributors

1. **Fix Package Embedding**: See `DISTRIBUTION_GUIDE.md`
2. **Add Features**: Extend `core/src/transpiler/`
3. **Improve CLI**: Enhance `core/cli/`
4. **Write Docs**: Update this guide!

---

## 📖 Related Documentation

- **README.md** - Project overview
- **CLAUDE.md** - AI assistant guidelines
- **PROJECT_STATUS.md** - Current status and features
- **DISTRIBUTION_GUIDE.md** - Distribution details
- **HOW_IT_WORKS_VISUAL.md** - Visual explanations
- **doc/** - Language feature documentation

---

**Questions?** Open an issue on GitHub or see the documentation directory.

**License:** MIT

**Version:** 0.1.0

**Last Updated:** 2025-11-13
