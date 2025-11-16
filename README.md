# HQL

**A modern Lisp that transpiles to JavaScript**

```bash
curl -fsSL https://raw.githubusercontent.com/hlvm-dev/hql/main/install.sh | sh
```

[![Tests](https://img.shields.io/badge/tests-1129%20passing-success)](./test)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

## Get started

```lisp
;; hello.hql
(print "Hello, World!")
```

```bash
$ hql run hello.hql
Hello, World!
```

## Features

- ✅ **Production-ready** - 1,129 tests passing
- 🚀 **Fast** - Compiles to optimized JavaScript
- 🎯 **Simple** - Clean Lisp syntax, minimal complexity
- 🔧 **Interop** - Import JavaScript/TypeScript directly
- 📦 **Complete** - Standard library for I/O, HTTP, data structures
- 🎨 **Powerful** - Compile-time macros for metaprogramming

## Quick examples

**Functions**
```lisp
(fn greet [name]
  (print "Hello," name "!"))

(greet "HQL")
```

**Named arguments**
```lisp
(fn connect {host port}
  (print "Connecting to" host ":" port))

(connect host: "localhost" port: 8080)
```

**Async/await**
```lisp
(fn fetchData []
  (await (fetch "https://api.example.com/data")))

(let data (await (fetchData)))
```

**JavaScript interop**
```lisp
(import [readFile] from "node:fs/promises")

(let content (await (readFile "./file.txt" "utf8")))
(print content)
```

## Installation

**One-line install (Mac/Linux)**
```bash
curl -fsSL https://raw.githubusercontent.com/hlvm-dev/hql/main/install.sh | sh
```

**Manual install**

Download binary from [releases](https://github.com/hlvm-dev/hql/releases):

```bash
# Mac ARM (M1/M2/M3)
curl -LO https://github.com/hlvm-dev/hql/releases/latest/download/hql-mac-arm
chmod +x hql-mac-arm
sudo mv hql-mac-arm /usr/local/bin/hql

# Mac Intel
curl -LO https://github.com/hlvm-dev/hql/releases/latest/download/hql-mac-intel
chmod +x hql-mac-intel
sudo mv hql-mac-intel /usr/local/bin/hql

# Linux
curl -LO https://github.com/hlvm-dev/hql/releases/latest/download/hql-linux
chmod +x hql-linux
sudo mv hql-linux /usr/local/bin/hql

# Windows
# Download hql-windows.exe from releases
```

**Use as library (Deno/Node.js)**
```typescript
import { transpile, run } from "jsr:@hlvm/hql";

const js = await transpile("(+ 1 2)");
console.log(js);  // "1 + 2"

const result = await run("(+ 1 2)");
console.log(result);  // 3
```

## Documentation

- [Language Guide](./doc/README.md) - Learn HQL syntax
- [Standard Library](./doc/api/stdlib.md) - Built-in functions
- [Examples](./doc/features/) - Code examples
- [API Reference](./doc/api/) - Complete API docs

## Development

```bash
# Clone
git clone https://github.com/hlvm-dev/hql.git
cd hql

# Run tests
deno test --allow-all

# Build binary
make build
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

## License

MIT - see [LICENSE](./LICENSE)
