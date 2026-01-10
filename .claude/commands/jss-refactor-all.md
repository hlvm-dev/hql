!ultrathink

Refactor the current code with these principles:

- **Keep code clean, DRY, and KISS** - Remove all redundancy and repetition
- **Simplify complexity** - Rewrite unnecessarily complex code into simpler versions that do the same thing
- **Optimize algorithms and data structures** - Replace poor implementations with better, faster, proven alternatives that achieve the same result
- **Remove garbage** - Delete unused code, files, scripts, docs, or anything out-of-date, legacy, or dead code that is nowhere used or referenced

**Critical requirement**: Everything must remain fully operational and work exactly the same way. The refactored code must be logically proven to operate successfully with better, faster, cleaner implementation.

## Mandatory Verification (DO NOT SKIP)

After completing refactoring, you MUST:

1. **Run all tests** - Execute `deno task test` and ensure ALL tests pass
2. **Run type checking** - Execute `deno check` on modified files to verify no type errors
3. **Verify build** - Run `make build` if applicable to ensure the project builds successfully
4. **Confirm identical behavior** - The refactored code must produce exactly the same results as before

**The job is NOT complete until all verification steps pass.** If any test fails or errors occur, fix them before finishing.

$ARGUMENTS
