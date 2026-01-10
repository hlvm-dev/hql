!ultrathink

Identify and optimize data structures in the current code:

- **Wrong collection types** - Arrays used where Sets/Maps would be O(1), linear search where hash lookup fits
- **Inefficient representations** - Storing computed values instead of computing on demand (or vice versa)
- **Memory layout issues** - Scattered data that should be co-located, unnecessary object wrapping
- **Missing indexes** - Repeated lookups that could use auxiliary data structures
- **Redundant storage** - Same data duplicated in multiple places that could be normalized
- **Inappropriate nesting** - Deeply nested objects that should be flattened, or flat arrays that should be trees

**Critical requirement**: The optimized code must produce exactly the same output given the same input. Behavior must be identical - only performance/memory improves.

## Mandatory Verification (DO NOT SKIP)

After completing optimization, you MUST:

1. **Run all tests** - Execute `deno task test` and ensure ALL tests pass
2. **Run type checking** - Execute `deno check` on modified files to verify no type errors
3. **Verify build** - Run `make build` if applicable to ensure the project builds successfully
4. **Confirm identical behavior** - The optimized code must produce exactly the same results as before

**The job is NOT complete until all verification steps pass.** If any test fails or errors occur, fix them before finishing.

## Arguments (optional)

You can specify:
- **Target path**: `src/parser/` - only optimize this directory/file
- **Focus type**: `Maps and Sets` - focus on specific data structure types
- **Constraint**: `memory priority` or `speed priority` - optimization goal

Examples:
- `/jss-refactor-datastructure src/interpreter/` - optimize interpreter only
- `/jss-refactor-datastructure focus on lookup tables` - specific focus
- `/jss-refactor-datastructure src/env.ts memory priority` - optimize for memory

$ARGUMENTS
