!ultrathink

Remove dead code and garbage from the codebase:

- **Delete unused code** - Functions, variables, imports that are never called or referenced
- **Remove dead files** - Scripts, modules, docs that are obsolete or orphaned
- **Clean up legacy code** - Remove deprecated patterns, old workarounds, commented-out code
- **Prune dependencies** - Remove unused imports and packages

**Critical requirement**: Only remove code that is genuinely unused. Verify no references exist before deletion.

## Mandatory Verification (DO NOT SKIP)

After completing cleanup, you MUST:

1. **Run all tests** - Execute `deno task test` and ensure ALL tests pass
2. **Run type checking** - Execute `deno check` on modified files to verify no type errors
3. **Verify build** - Run `make build` if applicable to ensure the project builds successfully
4. **Confirm nothing is broken** - Ensure removed code was truly unused and nothing depends on it

**The job is NOT complete until all verification steps pass.** If any test fails or errors occur, fix them before finishing.

$ARGUMENTS
