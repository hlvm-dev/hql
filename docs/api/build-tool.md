# HQL Build Tool (`core/build.ts`)

> **Note:** This document describes the internal build script (`core/build.ts`) that powers the primary `hql compile` CLI command. For most users, using `hql compile` directly is recommended.

The project now ships with a first-class build orchestrator that bundles an HQL
entry module for multiple publish targets. It mirrors the proposed workflow in
`doc/specs/hql_build_all.md` and is safe to use in CI.

```
deno run --allow-all core/build.ts --all
```

> Requires Deno 1.40+ because it uses the `Deno.Command` APIs exposed by the
> runtime wrapper in `src/platform/platform.ts`.

---

## Features at a Glance

- ✅ **Single command** builds both JSR and NPM artifacts (`--all`).
- ✅ Supports per-target invocation (`--jsr`, `--npm`).
- ✅ Works from any directory via `--entry` and `--output` flags.
- ✅ Respects `--version` overrides without mutating source metadata.
- ✅ Produces deterministic output inside `.hql-cache/rt/...`.
- ✅ Circular-import safe (uses the same module compiler as the runtime).

When `--all` is provided the tool performs the steps below:

1. Compile the entry module (and its import graph) into temporary `.mjs` files
   using the runtime compiler.
2. Prepare **JSR** metadata (`dist/jsr.json`, `dist/deno.json`). Existing
   metadata is reused; otherwise sane defaults are created.
3. Prepare **NPM** metadata (`dist/package.json`). Again, existing files are
   merged rather than overwritten.
4. Optionally copies the entire `dist/` directory to a custom destination.

---

## CLI Reference

```
deno run -A core/build.ts [options] [entry]
```

| Option                     | Description                                                         |
| -------------------------- | ------------------------------------------------------------------- |
| `--all`, `-all`, `all`     | Build both JSR and NPM outputs (default behaviour).                 |
| `--jsr` / `--npm`          | Build only the selected registry.                                   |
| `--entry`, `-e <file>`     | Entry HQL file (defaults to `./mod.ts`).                            |
| `--output`, `-o <dir>`     | Copy the generated `dist/` folder to another directory.             |
| `--version`, `-v <semver>` | Override the metadata version written to `jsr.json`/`package.json`. |
| `--verbose`                | Print detailed logs (exact paths, metadata decisions).              |
| `--help`, `-h`             | Show usage.                                                         |

Examples:

```bash
# Build both registries and copy to ./release
$ deno run -A core/build.ts all --output ./release

# Build only the JSR package, overriding version metadata
$ deno run -A core/build.ts --jsr --version 1.2.3

# Custom entry file inside packages/app.hql
$ deno run -A core/build.ts --all --entry packages/app.hql
```

---

## Output Layout

After a successful run the tool generates:

```
dist/
  esm/index.js       # Bundled JavaScript output
  types/index.d.ts   # Type definitions (auto-generated fallback when missing)
  README.md          # Created when absent so registries have basic docs
  jsr.json           # JSR package metadata (if `--jsr` selected)
  deno.json          # Duplicate metadata for `deno publish`
  package.json       # NPM metadata (if `--npm` selected)
```

If `--output` is provided these files are copied verbatim to the destination
folder, making it trivial to archive or publish from CI.

---

## Implementation Notes

- The build tool reuses `publish_jsr.ts` / `publish_npm.ts` internals but runs
  them in **dry-run** mode, so no registry network calls are performed.
- Circular HQL imports are resolved using the shared cache introduced in
  `mod.ts` (the same fix used by the runtime execution path).
- All metadata writes happen inside `dist/`; source files (`package.json`,
  `jsr.json`, etc.) are left untouched.
- The tool is idempotent: repeated runs reuse cached compilation results via the
  `compiledModules` map.

---

## Troubleshooting

| Symptom                        | Cause / Fix                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------- |
| "Entry file not found"         | Verify `--entry` path is correct.                                             |
| "Unsupported import file type" | Only `.hql`, `.js`, `.ts`, `npm:`, `jsr:` and HTTP(S) imports are supported.  |
| Empty output directory         | Ensure the entry module exports something; otherwise type stubs are produced. |
| Wrong version in metadata      | Pass `--version` explicitly (overrides existing files temporarily).           |

---

## Integration Tips

- Add `deno run -A core/build.ts --all` to your release pipeline to guarantee
  both registries receive the identical bundle.
- Combine with `deno task`:

```json
{
  "tasks": {
    "build:all": "deno run -A core/build.ts --all",
    "build:jsr": "deno run -A core/build.ts --jsr",
    "build:npm": "deno run -A core/build.ts --npm"
  }
}
```

- Because the tool uses pure TypeScript, customizing it (e.g., adding ZIP
  packaging) is straightforward.
