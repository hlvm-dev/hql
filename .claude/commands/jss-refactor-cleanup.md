Remove dead code and garbage from the codebase:

- **Delete unused code** - Functions, variables, imports that are never called or referenced
- **Remove dead files** - Scripts, modules, docs that are obsolete or orphaned
- **Clean up legacy code** - Remove deprecated patterns, old workarounds, commented-out code
- **Prune dependencies** - Remove unused imports and packages

**Critical requirement**: Only remove code that is genuinely unused. Verify no references exist before deletion. All tests must pass after cleanup.

$ARGUMENTS
