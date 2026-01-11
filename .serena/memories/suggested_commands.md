# Suggested Commands for HQL Development

## Testing
- `deno task test` - Run unit tests
- `deno task test:unit` - Run unit tests only
- `deno task test:binary` - Run binary tests (requires built binary)
- `deno task test:all` - Run all tests
- `deno task test:watch` - Watch mode for tests

## Building
- `make build` - Build HQL binary for current platform
- `make install` - Install system-wide
- `make repl` - Build and launch REPL
- `make clean` - Clean build files

## Development
- `deno check <file>` - Type check a file
- `deno lint` - Run linter
- `deno fmt` - Format code

## Running HQL
- `./hql run <file.hql>` - Run an HQL file
- `./hql repl` - Start REPL
- `./hql --version` - Show version
