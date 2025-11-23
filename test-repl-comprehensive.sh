#!/bin/bash
# Comprehensive REPL Test Script
# Tests all v2.0 features through the REPL

set -e

echo "🧪 HQL REPL Comprehensive Test"
echo "=============================="
echo ""

# Test 1: Version
echo "✓ Test 1: Version command"
deno run -A --config deno.json core/cli/repl.ts --version | grep "2.0.0" || { echo "❌ Version test failed"; exit 1; }

# Test 2: Help
echo "✓ Test 2: Help command"
deno run -A --config deno.json core/cli/repl.ts --help | grep "Interactive" || { echo "❌ Help test failed"; exit 1; }

# Test 3: Basic arithmetic
echo "✓ Test 3: Arithmetic operations"
echo "(+ 1 2)" | deno run -A --config deno.json core/cli/repl.ts 2>&1 | grep -q "3" || { echo "❌ Arithmetic test failed"; exit 1; }

# Test 4: Comparisons
echo "✓ Test 4: Comparison operators"
echo "(== 5 5)" | deno run -A --config deno.json core/cli/repl.ts 2>&1 | grep -q "true" || { echo "❌ Comparison test failed"; exit 1; }

# Test 5: Strings
echo "✓ Test 5: String operations"
echo '"Hello, World!"' | deno run -A --config deno.json core/cli/repl.ts 2>&1 | grep -q "Hello, World" || { echo "❌ String test failed"; exit 1; }

# Test 6: Variables
echo "✓ Test 6: Variable bindings"
echo -e "(let x 10)\nx" | deno run -A --config deno.json core/cli/repl.ts 2>&1 | grep -q "10" || { echo "❌ Variable test failed"; exit 1; }

# Test 7: Functions
echo "✓ Test 7: Function definitions"
echo -e "(fn add [a b] (+ a b))\n(add 5 7)" | deno run -A --config deno.json core/cli/repl.ts 2>&1 | grep -q "12" || { echo "❌ Function test failed"; exit 1; }

# Test 8: Arrow lambdas
echo "✓ Test 8: Arrow lambdas"
echo '(map (=> (* $0 2)) [1 2 3])' | deno run -A --config deno.json core/cli/repl.ts 2>&1 | grep -q "2,4,6" || { echo "❌ Arrow lambda test failed"; exit 1; }

# Test 9: Arrays
echo "✓ Test 9: Array literals"
echo "[1 2 3 4 5]" | deno run -A --config deno.json core/cli/repl.ts 2>&1 | grep -q "1" || { echo "❌ Array test failed"; exit 1; }

# Test 10: Objects
echo "✓ Test 10: Object literals"
echo '{"name": "HQL"}' | deno run -A --config deno.json core/cli/repl.ts 2>&1 | grep -q "name" || { echo "❌ Object test failed"; exit 1; }

# Test 11: Conditionals
echo "✓ Test 11: If conditionals"
echo "(if true 1 2)" | deno run -A --config deno.json core/cli/repl.ts 2>&1 | grep -q "1" || { echo "❌ Conditional test failed"; exit 1; }

# Test 12: All v2.0 operators
echo "✓ Test 12: All v2.0 operators"
cat test-repl.hql | deno run -A --config deno.json core/cli/repl.ts 2>&1 | grep -q "42" || { echo "❌ v2.0 operators test failed"; exit 1; }

echo ""
echo "=============================="
echo "✅ All REPL tests passed!"
echo "=============================="
echo ""
echo "Summary:"
echo "  - Version command: ✓"
echo "  - Help command: ✓"
echo "  - Arithmetic ops: ✓"
echo "  - Comparison ops: ✓"
echo "  - String operations: ✓"
echo "  - Variable bindings: ✓"
echo "  - Function definitions: ✓"
echo "  - Arrow lambdas: ✓"
echo "  - Array literals: ✓"
echo "  - Object literals: ✓"
echo "  - Conditionals: ✓"
echo "  - v2.0 operators: ✓"
echo ""
echo "🎉 HQL REPL is fully functional!"
