!ultrathink

Simplify unnecessarily complex code:

- **Reduce nesting** - Flatten deeply nested conditionals with early returns/guards
- **Clarify logic** - Rewrite convoluted expressions into clear, readable form
- **Split large functions** - Break down functions doing too many things
- **Remove over-engineering** - Strip unnecessary abstractions, configurations, or indirection

**Critical requirement**: Simplified code must produce identical results. The code should be easier to read and maintain while doing exactly the same thing.

## Mandatory Verification (DO NOT SKIP)

After completing simplification, you MUST:

1. **Run all tests** - Execute `deno task test` and ensure ALL tests pass
2. **Run type checking** - Execute `deno check` on modified files to verify no type errors
3. **Verify build** - Run `make build` if applicable to ensure the project builds successfully
4. **Confirm identical behavior** - The simplified code must produce exactly the same results as before

**The job is NOT complete until all verification steps pass.** If any test fails or errors occur, fix them before finishing.

$ARGUMENTS
