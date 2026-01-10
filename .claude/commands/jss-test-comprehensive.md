!ultrathink

Write comprehensive tests - identify gaps and fill them with REAL, VALID tests:

## Phase 1: Analyze Test Coverage

- **Map existing tests** - What features/functions/modules already have tests?
- **Identify gaps** - What code paths have NO tests or WEAK tests?
- **Find critical untested code** - Core logic, edge cases, error handling without coverage
- **Check test quality** - Are existing tests actually testing meaningful behavior?

## Phase 2: Prioritize What Needs Tests

Focus on (in order):
1. **Core functionality** - The main features users rely on
2. **Edge cases** - Boundary conditions, empty inputs, large inputs
3. **Error paths** - What happens when things go wrong?
4. **Integration points** - Where modules connect and data flows between them
5. **Regression risks** - Code that broke before or looks fragile

## Phase 3: Write Tests

**MANDATORY REQUIREMENTS:**

- **REAL tests only** - Every test must verify actual, meaningful behavior
- **NO fake/pointless tests** - Tests like `expect(1).toBe(1)` or trivial checks are FORBIDDEN
- **Test the contract** - What should this code do? Test THAT.
- **Meaningful assertions** - Each assertion must verify something that matters
- **Descriptive names** - Test names should explain what behavior is being verified
- **Independent tests** - Each test should work in isolation, no order dependency

**Test Structure:**
```typescript
Deno.test("functionName - specific behavior being tested", () => {
  // Arrange - set up test data
  // Act - call the code being tested
  // Assert - verify the expected outcome
});
```

## FORBIDDEN (will reject the work):

- Tests that don't actually test anything meaningful
- Copy-paste tests with minor variations that add no value
- Tests that pass regardless of implementation (tautologies)
- Tests with no assertions or weak assertions
- Tests that test implementation details instead of behavior
- Commented-out tests or skipped tests without justification

## Mandatory Verification (DO NOT SKIP)

After writing tests, you MUST:

1. **Run all tests** - Execute `deno task test` and ensure ALL tests pass
2. **Verify new tests fail appropriately** - Temporarily break the code to confirm tests catch it
3. **Run type checking** - Execute `deno check` on test files
4. **Review test quality** - Each test must have clear purpose and meaningful assertions

**The job is NOT complete until all verification steps pass.**

## Arguments (optional)

You can specify:
- **Target path**: `src/parser/` - write tests for this directory/file only
- **Focus area**: `error handling` - focus on specific aspect
- **Test type**: `unit tests` or `integration tests` - specify test granularity
- **Priority**: `edge cases only` - focus on specific test category

Examples:
- `/jss-test-comprehensive` - analyze and fill gaps across entire project
- `/jss-test-comprehensive src/interpreter/` - tests for interpreter only
- `/jss-test-comprehensive src/parser/lexer.ts edge cases` - edge case tests for lexer
- `/jss-test-comprehensive integration tests for REPL` - integration tests for REPL

$ARGUMENTS
