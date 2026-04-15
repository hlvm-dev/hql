# HLVM

**AI-native runtime infrastructure.**

[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

HLVM is an AI-native runtime infrastructure that includes HQL (a Lisp that compiles to JavaScript), an AI agent SDK, and first-class JS integration — with macros, MCP tool servers, and zero runtime dependencies for compiled output.

---

## Installation

**One command. Ready on completion.**

macOS / Linux:
```bash
curl -fsSL https://hlvm.dev/install.sh | sh
```

Windows (PowerShell):
```powershell
irm https://hlvm.dev/install.ps1 | iex
```

Downloads the binary (~363 MB), sets up the local AI engine, and pulls the default model during install. After install finishes, `hlvm ask "hello"` works immediately.

For building from source, see the [build guide](./docs/BUILD.md).

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

AI Agent:

```bash
# Interactive mode (default)
hlvm ask "explain this code"

# Non-interactive mode (CI/CD)
hlvm ask -p "analyze code quality"

# Fine-grained permissions
hlvm ask --allowedTools write_file "fix linting errors"
```

---

## Documentation

**AI Agent:**

- [Agent System](./docs/agent.md) - Architecture and reference
- [CLI Permissions](./docs/cli-permissions.md) - Permission system guide
- [Non-Interactive Mode](./docs/examples/headless-mode.md) - Non-interactive usage

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

**Tooling:**

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
