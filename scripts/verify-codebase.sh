#!/bin/bash
# HQL Codebase Verification Script
# Run this after ANY code changes to ensure nothing broke

set -e  # Exit on any error

echo "========================================"
echo "HQL CODEBASE VERIFICATION"
echo "========================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

FAILED=0

# Expected values (updated after recent test additions - now 1174 tests)
# Includes 10 new tests for @hql/string package (stdlib-string.test.ts)
EXPECTED_TESTS=1174
EXPECTED_FAILURES=0
EXPECTED_IGNORED=0

echo "Step 1: Full Test Suite"
echo "----------------------------------------"
TEST_OUTPUT=$(deno test --allow-all --config=core/deno.json test/*.test.ts test/organized/syntax/*/*.test.ts 2>&1)
echo "$TEST_OUTPUT" | tail -20

# Extract test counts
PASSED=$(echo "$TEST_OUTPUT" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' || echo "0")
FAILED_COUNT=$(echo "$TEST_OUTPUT" | grep -oE '[0-9]+ failed' | grep -oE '[0-9]+' || echo "0")
IGNORED=$(echo "$TEST_OUTPUT" | grep -oE '[0-9]+ ignored' | grep -oE '[0-9]+' || echo "0")

echo ""
echo "Results:"
echo "  Passed:  $PASSED (expected: $EXPECTED_TESTS)"
echo "  Failed:  $FAILED_COUNT (expected: $EXPECTED_FAILURES)"
echo "  Ignored: $IGNORED (expected: $EXPECTED_IGNORED)"

if [ "$PASSED" -eq "$EXPECTED_TESTS" ] && [ "$FAILED_COUNT" -eq "$EXPECTED_FAILURES" ]; then
    echo -e "${GREEN}✅ Test suite: PASS${NC}"
else
    echo -e "${RED}❌ Test suite: FAIL${NC}"
    FAILED=1
fi

echo ""
echo "Step 2: TypeScript Compilation"
echo "----------------------------------------"
if deno check --config=core/deno.json core/src/transpiler/index.ts 2>&1; then
    echo -e "${GREEN}✅ TypeScript: PASS${NC}"
else
    echo -e "${RED}❌ TypeScript: FAIL${NC}"
    FAILED=1
fi

echo ""
echo "Step 3: Feature Verification"
echo "----------------------------------------"

# Test 1: Basic arithmetic
echo -n "Testing basic arithmetic... "
RESULT=$(deno eval "import hql from './mod.ts'; console.log(await hql.run('(+ (* 5 5) (- 10 2))'))" 2>&1 | grep -v "Download" | tail -1)
if [ "$RESULT" = "33" ]; then
    echo -e "${GREEN}✅ PASS${NC} (got: $RESULT)"
else
    echo -e "${RED}❌ FAIL${NC} (expected: 33, got: $RESULT)"
    FAILED=1
fi

# Test 2: Mixed args
echo -n "Testing mixed args... "
RESULT=$(deno eval "import hql from './mod.ts'; console.log(await hql.run('(fn subtract (x y) (- x y)) (subtract 10 y: 3)'))" 2>&1 | grep -v "Download" | tail -1)
if [ "$RESULT" = "7" ]; then
    echo -e "${GREEN}✅ PASS${NC} (got: $RESULT)"
else
    echo -e "${RED}❌ FAIL${NC} (expected: 7, got: $RESULT)"
    FAILED=1
fi

# Test 3: Circular imports
echo -n "Testing circular imports... "
RESULT=$(deno eval "import hql from './mod.ts'; const code='(import [circularFunction] from \"./test/fixtures/circular/a.hql\") (circularFunction)'; console.log(await hql.run(code))" 2>&1 | grep -v "Download" | tail -1)
if [ "$RESULT" = "20" ]; then
    echo -e "${GREEN}✅ PASS${NC} (got: $RESULT)"
else
    echo -e "${RED}❌ FAIL${NC} (expected: 20, got: $RESULT)"
    FAILED=1
fi

echo ""
echo "Step 4: Critical Test Files"
echo "----------------------------------------"

# Operators
echo -n "Testing operator.test.ts... "
OPS=$(deno test --allow-all test/organized/syntax/operator/operator.test.ts 2>&1 | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+')
if [ "$OPS" = "47" ]; then
    echo -e "${GREEN}✅ 47/47${NC}"
else
    echo -e "${RED}❌ $OPS/47${NC}"
    FAILED=1
fi

# Classes
echo -n "Testing class.test.ts... "
CLASSES=$(deno test --allow-all test/organized/syntax/class/class.test.ts 2>&1 | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+')
if [ "$CLASSES" = "32" ]; then
    echo -e "${GREEN}✅ 32/32${NC}"
else
    echo -e "${RED}❌ $CLASSES/32${NC}"
    FAILED=1
fi

# Loops
echo -n "Testing loop.test.ts... "
LOOPS=$(deno test --allow-all test/organized/syntax/loop/loop.test.ts 2>&1 | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+')
if [ "$LOOPS" = "23" ]; then
    echo -e "${GREEN}✅ 23/23${NC}"
else
    echo -e "${RED}❌ $LOOPS/23${NC}"
    FAILED=1
fi

# Functions (includes mixed args)
echo -n "Testing function.test.ts... "
FUNCS=$(deno test --allow-all test/organized/syntax/function/function.test.ts 2>&1 | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+')
if [ "$FUNCS" = "70" ]; then
    echo -e "${GREEN}✅ 70/70${NC}"
else
    echo -e "${RED}❌ $FUNCS/70${NC}"
    FAILED=1
fi

# Circular imports
echo -n "Testing syntax-circular.test.ts... "
CIRCULAR=$(deno test --allow-all test/syntax-circular.test.ts 2>&1 | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+')
if [ "$CIRCULAR" = "3" ]; then
    echo -e "${GREEN}✅ 3/3${NC}"
else
    echo -e "${RED}❌ $CIRCULAR/3${NC}"
    FAILED=1
fi

echo ""
echo "========================================"
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ VERIFICATION PASSED${NC}"
    echo "Codebase is fully operational!"
    echo "Safe to commit changes."
    exit 0
else
    echo -e "${RED}❌ VERIFICATION FAILED${NC}"
    echo "Regressions detected!"
    echo "DO NOT COMMIT - Fix issues first."
    exit 1
fi
