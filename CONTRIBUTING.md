# Contributing to HLVM

Thank you for your interest in contributing to HLVM.

## Development Setup

### Prerequisites

- Install the HLVM binary or build from source
- Familiarity with Lisp syntax

### Building from Source

Clone the repository:
```bash
git clone https://github.com/hlvm-dev/hlvm.git
cd hlvm
```

Build:
```bash
make build
```

### Running Tests

Run the test suite:
```bash
make test
```

All tests should pass.

## Making Changes

### Code Style

- Follow existing code patterns (see [Style Guide](./docs/style-guide.md))
- Add tests for new features
- Update documentation

### Testing

Before submitting:
```bash
# Run all tests
make test

# Run lint
make lint
```

All tests must pass.

### Documentation

Update relevant documentation:
- `README.md` - If changing core features
- `docs/MANUAL.md` - For new language features
- `docs/api/` - For API changes
- `docs/features/` - For feature examples

## Submitting Changes

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests
5. Submit a pull request

### Pull Request Guidelines

- Clear description of changes
- Include test coverage
- Update documentation
- Reference related issues

## Reporting Issues

Use GitHub Issues to report:
- Bugs
- Feature requests
- Documentation improvements

Include:
- HLVM version (`hlvm --version`)
- Operating system
- Steps to reproduce
- Expected vs actual behavior

## Releases

See [Build Guide](./docs/BUILD.md) for build details.

## Community

- Be respectful and constructive
- Help others learn
- Share knowledge

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
