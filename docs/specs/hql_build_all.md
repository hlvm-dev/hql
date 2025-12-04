# Building for All Targets with HQL Build Tool

The HQL build tool supports building for all supported platforms and
architectures with a single command. There are multiple ways to trigger this
behavior for user convenience:

## Usage

You can use any of the following forms to build for all supported targets:

- `--all` (long flag)
- `-all` (single dash, easy to type)
- `all` (as the first positional argument)

All three are equivalent and will build for all platforms/architectures
supported by HQL.

### Examples

```
deno run --allow-all core/build.ts --all
```

```
deno run --allow-all core/build.ts -all
```

```
deno run --allow-all core/build.ts all
```

## Additional Options

You can combine `all` with other options:

```
deno run --allow-all core/build.ts all --output ./dist --version 1.2.3
```

or

```
deno run --allow-all core/build.ts --all -o ./dist -v 1.2.3
```

## Help Output

The help message will show:

```
--all, -all, all            Build all supported targets (all forms are equivalent)
```

## Notes

- The `all` positional argument must be the first argument if used.
- All three forms are interchangeable; use whichever is most convenient.
- This makes cross-platform builds easier and more ergonomic.
