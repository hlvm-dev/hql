# HQL Module Publishing System – Quick Reference (v2025‑04‑26)

## 🗂️ Fundamental Rule — Always Provide the _Entry File_

`hql publish` **always expects the path to the module’s entry `.hql` file**
(e.g. `./my‑module/index.hql`).\
Passing only a directory is no longer supported.

---

## Basic Usage

```bash
# Publish to JSR (default)
hql publish ./my-module/index.hql

# Publish to NPM
hql publish ./my-module/index.hql npm

# Publish to JSR with specific version
hql publish ./my-module/index.hql jsr 1.2.3

# Publish to NPM with specific version
hql publish ./my-module/index.hql npm 1.2.3

# Publish to both JSR and NPM
hql publish ./my-module/index.hql all

# Publish to both JSR and NPM with specific version (both)
hql publish ./my-module/index.hql all 1.2.3

# Dry‑run mode (no actual publishing)
hql publish ./my-module/index.hql --dry-run
```

---

## Use‑Case Walk‑throughs

### Case 1: Only an HQL file, no metadata

```bash
hql publish ./my-module/index.hql
```

**What happens**

1. CLI prompts for **package name**.
2. CLI prompts for **version** (default `0.0.1`).
3. Generates the platform metadata files (`jsr.json`, `package.json`, …) in the
   _module’s directory_.
4. Builds and publishes to **JSR** (default).

---

### Case 2: Only an HQL file, explicit version when metadata file is missing

```bash
hql publish ./my-module/index.hql npm 0.1.5
```

**What happens**

1. Prompts for _package name_.
2. Uses **`0.1.5`** as the default in the version prompt.
3. Generates `package.json`.
4. Builds and publishes to **NPM**.

---

### Case 3: Metadata already present (`package.json` / `deno.json`)

```bash
hql publish ./my-npm-package/index.hql
```

**What happens**

1. Reads _package name_ from metadata.
2. Queries the remote registry for the latest version and auto‑increments it
   by `0.0.1`.
3. Builds and publishes.

---

### Case 4: Force a specific version when metadata exists

```bash
hql publish ./my-jsr-package/index.hql jsr 2.0.0
```

**What happens**

1. Uses the metadata _package name_.
2. Uses **`2.0.0`** exactly (skips remote version check).
3. Builds and publishes.

---

### Case 5: Publish to both registries with a specific version

```bash
hql publish ./my-module/index.hql all 1.2.3
```

**What happens**

1. Uses the metadata _package name_ (or prompts if none).
2. Uses **`1.2.3`**.
3. Builds and publishes to **JSR** _and_ **NPM**.

---

## CLI Reference

```bash
hql publish <entry-file> [platform] [version] [options]
```

| Parameter    | Description                                 | Accepted values     |
| ------------ | ------------------------------------------- | ------------------- |
| `entry-file` | **Path to the module’s entry `.hql` file**  | _Required_          |
| `platform`   | Target registry (default **jsr**)           | `jsr`, `npm`, `all` |
| `version`    | Force specific version (skips auto‑version) | `X.Y.Z`             |

### Options

| Option      | Effect                     |
| ----------- | -------------------------- |
| `--dry-run` | Build only; do not publish |
| `--verbose` | Show detailed logs         |

---

## Environment Variables

| Variable           | Description                                 |
| ------------------ | ------------------------------------------- |
| `DRY_RUN_PUBLISH`  | If set (`=1`), always perform a dry run     |
| `SKIP_LOGIN_CHECK` | If set (`=1`), skip registry authentication |

---

## Troubleshooting

### Authentication

```bash
# JSR
deno login

# NPM
npm login

# Skip auth checks
SKIP_LOGIN_CHECK=1 hql publish ./my-module/index.hql
```

### Version Conflicts

If the desired version already exists in the registry:

```bash
hql publish ./my-module/index.hql npm 1.2.4
```

---

## Package Outputs

The build step generates:

- **JSR** – `jsr.json` (scoped name `@user/package`)
- **NPM** – `package.json` with correct fields
- A bundled `.js` file plus `.d.ts` TypeScript definitions

---

## Core Decision Logic

| Scenario                | Package name             | Version                                                                                                                                | Metadata generation & behaviour          |
| ----------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **No metadata present** | Prompt user _every time_ | Prompt – default `0.0.1` or CLI value                                                                                                  | Create `jsr.json` / `package.json`       |
| **Metadata present**    | Always use value in file | If CLI provides a version → use it.<br>Otherwise: fetch latest from registry, bump by `0.0.1` (fallback to file value if fetch fails). | Update metadata files in‑place if needed |

> **Important:** The CLI no longer provides an option to pass the package name;
> it is either prompted (no metadata) or read from existing metadata.

---

### Summary of Key Rules

1. **Entry file path is mandatory** — directory‑only invocations are deprecated.
2. If no metadata exists, the CLI always asks for **both** name and version.
3. If metadata exists, the CLI **never** asks for name and only asks for version
   when remote detection fails or the user forces one with the CLI argument.
4. A CLI‑supplied version always overrides auto‑increment behaviour.

---

That’s the updated quick reference reflecting the new single‑entry‑file
requirement. 🚀

### Publish algorithm

When Metadata Files DON'T Exist: Package Name: MUST always ask via prompt Remove
CLI option for package name entirely Version: If specified in CLI: Use that
version as default in prompt If not specified: Default to 0.0.1 in prompt Always
ask via prompt, with appropriate default Metadata Generation: Generate
platform-specific metadata files (deno.json for JSR, package.json for NPM) Use
answers from prompts to populate these files When Metadata Files EXIST: Package
Name: Always use from metadata file Remove ability to override via CLI Version:
If specified in CLI: Force use that version, skip remote version check If not
specified: Fetch from remote registry and increment by 0.0.1 If remote registry
fetch fails: Fall back to metadata file version

### Decision Tree

START ──► Do metadata files (deno.json / package.json) exist? │ ├─ NO ──► Prompt
for **package name** │ │ │ └─► Was **version** passed on CLI? │ │ │ ├─ YES ──►
Prompt for version │ │ (pre-filled with CLI value) │ │ │ └─ NO ──► Prompt for
version │ (default 0.0.1) │ │ ► Generate metadata files │ (deno.json /
package.json) with answers │ └─ YES ─► Read **package name** from metadata
(cannot be overridden) │ └─► Was **version** passed on CLI? │ ├─ YES ──► Use CLI
version │ (skip remote check) │ └─ NO ──► Fetch latest version from remote
registry │ ├─ Fetch OK ──► Increment by 0.0.1 │ └─ Fetch FAIL ─► Use version in
metadata
