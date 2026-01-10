!ultrathink

Apply DRY (Don't Repeat Yourself) and KISS (Keep It Simple, Stupid) principles:

- **Eliminate duplication** - Find repeated code blocks and extract into reusable functions
- **Remove redundancy** - Consolidate similar logic, merge near-identical functions
- **Simplify interfaces** - Reduce parameter counts, use sensible defaults
- **Consistent patterns** - Ensure similar operations use the same approach throughout

**Critical requirement**: Refactored code must behave exactly the same. No functional changes - only structural improvements.

## Mandatory Verification (DO NOT SKIP)

After completing refactoring, you MUST:

1. **Run all tests** - Execute `deno task test` and ensure ALL tests pass
2. **Run type checking** - Execute `deno check` on modified files to verify no type errors
3. **Verify build** - Run `make build` if applicable to ensure the project builds successfully
4. **Confirm identical behavior** - The refactored code must produce exactly the same results as before

**The job is NOT complete until all verification steps pass.** If any test fails or errors occur, fix them before finishing.

$ARGUMENTS
