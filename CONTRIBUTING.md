# Contributing to HQL

Thank you for your interest in contributing to HQL.

## Development Setup

### Prerequisites

- Install the HQL binary or build from source
- Familiarity with Lisp syntax

### Building from Source

Clone the repository:
```bash
git clone https://github.com/hlvm-dev/hql.git
cd hql
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

Expected output:
```
ok | 1457 passed | 0 failed
```

## Making Changes

### Code Style

- Follow existing code patterns
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
- `doc/api/` - For API changes
- `doc/features/` - For feature examples

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
- HQL version (`hql --version`)
- Operating system
- Steps to reproduce
- Expected vs actual behavior

## Community

- Be respectful and constructive
- Help others learn
- Share knowledge

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
