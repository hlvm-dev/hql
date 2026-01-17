# HLVM

**Runtime platform for HQL and JavaScript.**

[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

HLVM runs HQL (a Lisp that compiles to JavaScript) alongside first-class JS, with macros, AI runtime hooks, and zero runtime dependencies for compiled output.

---

## Installation

**macOS (Intel & Apple Silicon):**

```bash
curl -fsSL https://raw.githubusercontent.com/hlvm-dev/hlvm/main/install.sh | sh
```

**Linux x86_64:**

```bash
curl -fsSL https://raw.githubusercontent.com/hlvm-dev/hlvm/main/install.sh | sh
```

> **Note:** Linux installer has limited testing. Please [report issues](https://github.com/hlvm-dev/hlvm/issues).

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/hlvm-dev/hlvm/main/install.ps1 | iex
```

> **Note:** Windows installer has limited testing. Please [report issues](https://github.com/hlvm-dev/hlvm/issues).

**From source:**

```bash
make build
```

See [build guide](./docs/BUILD.md) for details.

**Update & Uninstall:**

```bash
hlvm upgrade      # Update to latest version
hlvm uninstall    # Remove HLVM from system
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
hlvm run hello.hql
```

REPL:

```bash
hlvm repl
```

---

## Documentation

**Learning:**

- [Learning Guide](./docs/GUIDE.md) - Quick start + complete guide from beginner to advanced
- [Manual](./docs/MANUAL.md) - Language reference

**Language Reference:**

- [Syntax Reference](./docs/HQL-SYNTAX.md) - Definitive syntax documentation
- [Quick Reference Card](./docs/REFERENCE.md) - Syntax at a glance
- [Type System](./docs/TYPE-SYSTEM.md) - TypeScript type annotations
- [Style Guide](./docs/style-guide.md) - Coding conventions

**API Reference:**

- [Standard Library](./docs/api/stdlib.md) - Sequence operations, collections
- [Built-ins](./docs/api/builtins.md) - Runtime primitives
- [Module System](./docs/api/module-system.md) - Import/export resolution
- [Runtime](./docs/api/runtime.md) - Runtime environment

**Feature Documentation:**

- [Language Features](./docs/features/) - Complete feature specs (17 features)

**Development:**

- [Build Guide](./docs/BUILD.md) - Building from source
- [Testing Guide](./docs/TESTING.md) - Running and writing tests
- [Contributing](./CONTRIBUTING.md) - Contribution guidelines
- [Release Guide](./docs/RELEASING.md) - Creating releases

**Tooling:**

- [LSP & Editor Support](./docs/LSP.md) - VS Code extension
- [Error System](./docs/ERROR-SYSTEM.md) - Error reporting and source maps

**Internals:**

- [Self-Hosted Stdlib](./docs/SELF-HOSTED-STDLIB.md) - Stdlib design philosophy

---

## Contributing

Contributions welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## License

HLVM is licensed under the [MIT License](./LICENSE).

This project includes third-party dependencies with their own licenses. See [THIRD-PARTY-LICENSES](./THIRD-PARTY-LICENSES) for details.
