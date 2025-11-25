# HQL

**A Lisp that compiles to JavaScript.**

[![Tests](https://img.shields.io/badge/tests-1457%20passing-success)](./test)
[![Version](https://img.shields.io/badge/version-0.1.0-blue)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()

Modern Lisp dialect with full JavaScript interoperability, powerful macros, and zero runtime dependencies.

---

## Installation

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/hlvm-dev/hql/main/install.sh | sh
```

**Windows:**

Download from [releases](https://github.com/hlvm-dev/hql/releases).

**From source:**

```bash
make build
```

See [build guide](./docs/BUILD.md) for details.

---

## Quick Start

```lisp
(fn greet [name]
  (print "Hello," name))

(greet "World")
```

Run:

```bash
hql run hello.hql
```

REPL:

```bash
hql repl
```

---

## Documentation

**Learning:**

- [Learning Guide](./docs/GUIDE.md) - Complete guide from beginner to advanced
- [Quick Start](./QUICKSTART.md) - 5-minute introduction
- [Manual](./docs/MANUAL.md) - Language reference

**Development:**

- [Build Guide](./docs/BUILD.md) - Building from source
- [Testing Guide](./docs/TESTING.md) - Running and writing tests
- [Contributing](./CONTRIBUTING.md) - Contribution guidelines

**Reference:**

- [Standard Library](./doc/api/stdlib.md) - Built-in functions
- [Language Features](./doc/features/) - Feature documentation
- [API Reference](./doc/api/) - Complete API

---

## Contributing

Contributions welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md).
