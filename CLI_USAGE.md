# HQL CLI Usage Guide

**Version**: 2.0.0
**Binary**: Standalone compiled binary (no Deno required at runtime)

---

## 🚀 Quick Start

### Build the Binary

```bash
make build
```

This creates `./hql` - a standalone 144MB binary with everything embedded.

### Run REPL

```bash
./hql repl
```

### Install System-Wide

```bash
make install
# Now use: hql repl
```

---

## 📋 Commands

### Interactive REPL
```bash
./hql repl
```

**Features**:
- Instant evaluation
- State persistence across lines
- Variable bindings (let, var)
- Function definitions
- Arrow lambdas
- Full v2.0 operator support
- Multiline support
- History navigation

**Example Session**:
```hql
hql> (+ 1 2 3)
=> 6

hql> (let x 42)
=> undefined

hql> x
=> 42

hql> (fn factorial [n] (if (<= n 1) 1 (* n (factorial (- n 1)))))
=> undefined

hql> (factorial 5)
=> 120

hql> (map (=> (* $0 2)) [1 2 3])
=> 2,4,6

hql> close()
Goodbye!
```

### Run File
```bash
./hql run <file.hql>
```

**Example**:
```bash
echo '(print "Hello, World!")' > hello.hql
./hql run hello.hql
# Output: Hello, World!
```

### Run Expression
```bash
./hql run -e '<expression>'
```

**Examples**:
```bash
./hql run -e '(+ 1 2 3)'        # → 6
./hql run -e '(* 5 6)'          # → 30
./hql run -e '(print "Hello")'  # → Hello
```

### Transpile to JavaScript
```bash
./hql transpile <file.hql>
```

**Example**:
```bash
echo '(+ 1 2)' > math.hql
./hql transpile math.hql
# Output: JavaScript code
```

### Initialize Project
```bash
./hql init
```

Creates `hql.json` configuration file for your project.

### Publish Module
```bash
./hql publish
```

Publishes HQL module to JSR/NPM registries.

---

## 🛠️ Build System

### Make Targets

| Command | Description |
|---------|-------------|
| `make` | Build for current platform |
| `make build` | Same as `make` |
| `make install` | Build and install to `/usr/local/bin` |
| `make test` | Build and run tests |
| `make fast` | Build and launch REPL |
| `make clean` | Remove build artifacts |
| `make all` | Build for all platforms |

### Platform-Specific Builds

```bash
make build-mac-intel    # Intel Mac
make build-mac-arm      # Apple Silicon
make build-linux        # Linux x86_64
make build-windows      # Windows x86_64
```

**Outputs**:
- `hql-mac-intel`
- `hql-mac-arm`
- `hql-linux`
- `hql-windows.exe`

---

## 🔧 Options

### Global Flags

```bash
--help, -h       Show help
--version        Show version
--time           Show timing information
--verbose        Detailed logging
--debug          Debug mode with stack traces
--log <ns>       Filter logs to namespaces
```

### Examples

```bash
./hql --version
# HQL CLI version 0.1.0

./hql repl --help
# Show REPL-specific help

./hql run --debug test.hql
# Run with debug output
```

---

## 📦 Binary Information

### Size
- **144MB** - Includes full Deno runtime + HQL compiler + external REPL library
- Standalone - no dependencies needed at runtime

### Architecture
```
hql binary
├── Deno runtime (~80MB)
├── HQL compiler
│   ├── Parser
│   ├── Transpiler
│   ├── Code generator
│   └── Runtime helpers
├── External REPL library (@hlvm/repl)
│   ├── readline implementation
│   ├── Plugin system
│   └── State management
└── Embedded packages
    ├── stdlib.hql
    └── macro/loop.hql
```

---

## 🎯 Why Not Use `deno run`?

### Before (Development Mode)
```bash
deno run -A --config deno.json core/cli/repl.ts
```
**Problems**:
- ❌ Requires Deno installed
- ❌ Verbose command
- ❌ Not portable
- ❌ Exposes implementation details

### After (Production Binary)
```bash
./hql repl
```
**Benefits**:
- ✅ No Deno required
- ✅ Simple command
- ✅ Portable binary
- ✅ Professional UX
- ✅ Can be installed system-wide

---

## 🌐 Single Source of Truth

The HQL binary uses the external REPL library from `~/Desktop/repl/`:

```
~/Desktop/repl/          ← Single source
├── mod.ts
└── src/
    ├── repl-core.ts
    ├── simple-readline.ts
    └── ...

    ↑ Compiled into binary
    ↑ Also used by HLVM

~/Desktop/hql/
├── deno.json → "@hlvm/repl": "../repl/mod.ts"
└── Makefile → deno compile --config deno.json
```

**Result**: Both HQL and HLVM share the exact same REPL implementation.

---

## 🧪 Testing

### Quick Test
```bash
./hql run -e '(+ 1 2)'
# Should output: 3
```

### REPL Test
```bash
echo "(+ 1 2)" | ./hql repl
# Should output: 3
```

### Full Test Suite
```bash
make test
```

Or:
```bash
./test-repl-comprehensive.sh
```

---

## 📝 Development Workflow

### 1. Development Mode (Fast Iteration)
```bash
deno run -A --config deno.json core/cli/repl.ts
```
- Fast startup
- No build needed
- Good for testing changes

### 2. Production Mode (Distribution)
```bash
make build
./hql repl
```
- Slower build (60 seconds)
- Fast startup
- Portable binary
- Production-ready

---

## 🔗 Integration with HLVM

Both projects share the same REPL:

**HQL**:
```bash
./hql repl           # HQL language REPL
```

**HLVM**:
```bash
hlvm                 # HLVM runtime REPL (can run HQL)
```

Same underlying REPL library, different language plugins.

---

## 📊 Comparison

| Feature | `deno run` | `./hql` binary |
|---------|-----------|----------------|
| **Requires Deno** | ✅ Yes | ❌ No |
| **Command Length** | 50+ chars | 10 chars |
| **Startup Time** | ~200ms | ~50ms |
| **Portable** | ❌ No | ✅ Yes |
| **Professional** | ❌ No | ✅ Yes |
| **Distribution** | ❌ Hard | ✅ Easy |
| **Installation** | ❌ Complex | ✅ `make install` |

---

## 🎯 Summary

**You asked**: "why should we use deno?"
**Answer**: **We don't!** The compiled binary is standalone.

**Development**: Use Deno for fast iteration
**Production**: Use `./hql` binary for distribution

**Simple workflow**:
```bash
make build      # Build once
./hql repl      # Use forever
make install    # Install system-wide
hql repl        # Use anywhere
```

**Professional CLI**: ✅
**Single source of truth**: ✅
**No Deno at runtime**: ✅
**Easy distribution**: ✅

---

**Last Updated**: 2025-11-24
**HQL Version**: 2.0.0
**CLI Ready**: ✅ Production-ready
