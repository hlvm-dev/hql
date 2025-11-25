# HQL

A Lisp that compiles to JavaScript.

[![Tests](https://img.shields.io/badge/tests-1457%20passing-success)](./test)
[![Version](https://img.shields.io/badge/version-0.1.0-blue)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()

HQL is a modern Lisp dialect that transpiles to JavaScript. It features full JavaScript interoperability, a powerful macro system, and runs on any JavaScript runtime.

## Installation

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/hlvm-dev/hql/main/install.sh | sh
```

**Windows**

Download the latest release from the [releases page](https://github.com/hlvm-dev/hql/releases).

**Build from source**

See [contributing guidelines](./CONTRIBUTING.md).

## Quick Start

Create `hello.hql`:

```lisp
(fn greet [name]
  (print "Hello," name))

(greet "World")
```

Run it:

```bash
hql run hello.hql
```

Try the REPL:

```bash
hql repl
```

See the [manual](./docs/MANUAL.md) for more examples.

## Documentation

- [Manual](./docs/MANUAL.md)
- [Quick Start](./QUICKSTART.md)
- [Standard Library](./doc/api/stdlib.md)
- [Language Features](./doc/features/)
- [API Reference](./doc/api/)

## Contributing

We welcome contributions. See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.
