Identify and optimize algorithms in the current code:

- **Analyze time complexity** - Find O(n²), O(n³), or worse algorithms that can be improved
- **Replace with proven alternatives** - Use hash maps for O(1) lookups, binary search for O(log n), sorting algorithms with guaranteed bounds
- **Optimize data structures** - Replace arrays with Sets/Maps where appropriate, use appropriate collections for the access patterns
- **Reduce redundant computation** - Add memoization, caching, or early exits where beneficial

**Critical requirement**: The optimized code must produce exactly the same output given the same input. Behavior must be identical - only performance improves. All tests must pass.

$ARGUMENTS
