# HLVM Rebrand Checklist (External)

This file tracks external actions required for the HLVM rebrand. These are not all code changes inside this repo.

## Repository and Releases
- Rename GitHub repo to `hlvm-dev/hlvm` and verify redirects from the old repo.
- Update release assets and tags to use `hlvm-*` binary names.
- Update release notes templates and badges to reference HLVM.

## Package Registry
- Publish `@hlvm/*` packages on JSR/NPM as the only namespace.
- Remove or deprecate any `@hql/*` artifacts; no compatibility shims.

## Distribution
- Update any external installers, Homebrew taps, or package managers if they exist.
- Update download URLs in external docs or blog posts.
- Publish the VSCode extension under the HLVM publisher (rename to `hlvm-hql-language`).

## Communication
- Add a breaking-change note in release notes and CHANGELOG (hard cut).
- Provide migration notes (CLI rename, config path change, env var rename).
