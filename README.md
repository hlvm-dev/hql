# HQL

**A Lisp that compiles to JavaScript.**

[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

Modern Lisp dialect with full JavaScript interoperability, powerful macros, and zero runtime dependencies.

---

## Installation

**macOS (Intel & Apple Silicon):**

```bash
curl -fsSL https://raw.githubusercontent.com/hlvm-dev/hql/main/install.sh | sh
```

**Linux x86_64:**

```bash
curl -fsSL https://raw.githubusercontent.com/hlvm-dev/hql/main/install.sh | sh
```

> **Note:** Linux installer has limited testing. Please [report issues](https://github.com/hlvm-dev/hql/issues).

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/hlvm-dev/hql/main/install.ps1 | iex
```

> **Note:** Windows installer has limited testing. Please [report issues](https://github.com/hlvm-dev/hql/issues).

**From source:**

```bash
make build
```

See [build guide](./docs/BUILD.md) for details.

**Update & Uninstall:**

```bash
hql upgrade      # Update to latest version
hql uninstall    # Remove HQL from system
```

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
- [Quick Start](./docs/QUICKSTART.md) - 5-minute introduction
- [Manual](./docs/MANUAL.md) - Language reference

**Development:**

- [Build Guide](./docs/BUILD.md) - Building from source
- [Testing Guide](./docs/TESTING.md) - Running and writing tests
- [Contributing](./CONTRIBUTING.md) - Contribution guidelines

**Reference:**

- [Standard Library](./docs/api/stdlib.md) - Built-in functions
- [Language Features](./docs/features/) - Feature documentation
- [API Reference](./docs/api/) - Complete API

---

## Contributing

Contributions welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md).
