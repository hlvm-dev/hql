!ultrathink

Comprehensive optimization of both algorithms AND data structures in the current code:

## Algorithm Optimizations
- **Analyze time complexity** - Find O(n²), O(n³), or worse algorithms that can be improved
- **Replace with proven alternatives** - Use hash maps for O(1) lookups, binary search for O(log n)
- **Reduce redundant computation** - Add memoization, caching, or early exits where beneficial
- **Eliminate unnecessary iterations** - Combine loops, use streaming/lazy evaluation

## Data Structure Optimizations
- **Wrong collection types** - Arrays used where Sets/Maps would be O(1)
- **Inefficient representations** - Optimize for actual access patterns
- **Missing indexes** - Add auxiliary structures for repeated lookups
- **Memory layout** - Co-locate related data, remove unnecessary wrapping

## Combined Wins
- **Algorithm + Structure synergy** - Sometimes the right data structure makes a better algorithm possible
- **Hot path optimization** - Focus on code that runs frequently
- **Holistic view** - Consider how data flows through algorithms end-to-end

**Critical requirement**: The optimized code must produce exactly the same output given the same input. Behavior must be identical - only performance improves.

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
- **Priority**: `algorithm first` or `datastructure first` - what to focus on
- **Constraint**: `memory priority` or `speed priority` - optimization goal
- **Scope**: `hot paths only` - focus on frequently executed code

Examples:
- `/jss-refactor-full src/interpreter/` - comprehensive optimization of interpreter
- `/jss-refactor-full hot paths only` - only optimize performance-critical code
- `/jss-refactor-full src/eval.ts speed priority` - optimize eval.ts for speed

$ARGUMENTS
