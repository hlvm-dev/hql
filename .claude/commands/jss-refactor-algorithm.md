!ultrathink

Identify and optimize algorithms in the current code:

- **Analyze time complexity** - Find O(n²), O(n³), or worse algorithms that can be improved
- **Replace with proven alternatives** - Use hash maps for O(1) lookups, binary search for O(log n), sorting algorithms with guaranteed bounds
- **Optimize data structures** - Replace arrays with Sets/Maps where appropriate, use appropriate collections for the access patterns
- **Reduce redundant computation** - Add memoization, caching, or early exits where beneficial

**Critical requirement**: The optimized code must produce exactly the same output given the same input. Behavior must be identical - only performance improves.

## Mandatory Verification (DO NOT SKIP)

After completing optimization, you MUST:

1. **Run all tests** - Execute `deno task test` and ensure ALL tests pass
2. **Run type checking** - Execute `deno check` on modified files to verify no type errors
3. **Verify build** - Run `make build` if applicable to ensure the project builds successfully
4. **Confirm identical behavior** - The optimized code must produce exactly the same results as before

**The job is NOT complete until all verification steps pass.** If any test fails or errors occur, fix them before finishing.

$ARGUMENTS
