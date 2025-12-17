#!/bin/bash
#
# HQL LSP Setup and Test Script
# Run from HQL root directory: ./scripts/setup-and-test-lsp.sh
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HQL_ROOT="$(dirname "$SCRIPT_DIR")"
VSCODE_EXT="$HQL_ROOT/vscode-hql"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  HQL LSP Setup and Test${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Step 1: Run automated LSP tests
echo -e "${YELLOW}Step 1: Running automated LSP tests...${NC}"
echo ""
if deno run --allow-all "$HQL_ROOT/scripts/test-lsp.ts"; then
    echo -e "${GREEN}✅ Automated tests passed${NC}"
else
    echo -e "${RED}❌ Automated tests failed${NC}"
    exit 1
fi
echo ""

# Step 2: Run unit tests
echo -e "${YELLOW}Step 2: Running unit tests...${NC}"
echo ""
if deno test "$HQL_ROOT/tests/unit/lsp/" --allow-all; then
    echo -e "${GREEN}✅ Unit tests passed${NC}"
else
    echo -e "${RED}❌ Unit tests failed${NC}"
    exit 1
fi
echo ""

# Step 3: Setup VSCode extension
echo -e "${YELLOW}Step 3: Setting up VSCode extension...${NC}"
echo ""
cd "$VSCODE_EXT"

if [ ! -d "node_modules" ]; then
    echo "Installing npm dependencies..."
    npm install
else
    echo "Dependencies already installed"
fi

echo "Compiling TypeScript..."
npm run compile

echo -e "${GREEN}✅ VSCode extension compiled${NC}"
echo ""

# Step 4: Create test file
TEST_FILE="$HQL_ROOT/test-lsp-demo.hql"
echo -e "${YELLOW}Step 4: Creating test file...${NC}"
cat > "$TEST_FILE" << 'EOF'
;; HQL LSP Test File
;; Test the following features:

;; 1. Variable binding
(let x 42)
(let message "Hello, HQL!")

;; 2. Function definition
(fn greet [name]
  (str "Hello, " name "!"))

;; 3. Function with multiple params
(fn add [a b]
  (+ a b))

;; 4. Class definition
(class Point
  (field x)
  (field y)
  (fn distance [self other]
    (Math.sqrt (+ (* (- other.x self.x) (- other.x self.x))
                  (* (- other.y self.y) (- other.y self.y))))))

;; 5. Enum definition
(enum Color
  (case Red)
  (case Green)
  (case Blue))

;; 6. Macro definition
(macro when [condition body]
  `(if ~condition ~body nil))

;; Test hover: mouse over 'greet', 'add', 'Point', 'Color'
;; Test completion: type ( at line below and press Ctrl+Space
;; Test go-to-definition: Ctrl+Click on 'greet' below

(greet "World")
(add x 10)

;; Test diagnostics: uncomment line below to see error
;; (let missing-paren
EOF

echo -e "${GREEN}✅ Test file created: $TEST_FILE${NC}"
echo ""

# Step 5: Close any existing VSCode for vscode-hql and reopen fresh
echo -e "${YELLOW}Step 5: Opening VSCode...${NC}"
echo ""

# Kill any existing VSCode windows for this project (optional, may not work on all systems)
# pkill -f "Visual Studio Code.*vscode-hql" 2>/dev/null || true

# Open VSCode fresh with the extension folder
code --new-window "$VSCODE_EXT"

# Wait a moment for VSCode to open
sleep 2

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Setup Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}In VSCode that just opened:${NC}"
echo ""
echo "  1. ${YELLOW}Wait 2 seconds${NC} for VSCode to fully load"
echo ""
echo "  2. ${YELLOW}Press F5${NC} to launch Extension Development Host"
echo "     - If F5 shows debugger list, choose 'Run Extension'"
echo "     - Or: Run menu → Start Debugging"
echo ""
echo "  3. ${YELLOW}In the NEW VSCode window that opens:${NC}"
echo "     File → Open → $TEST_FILE"
echo ""
echo "  4. ${YELLOW}Test features:${NC}"
echo "     - Hover over 'greet' → see function info"
echo "     - Type ( then Ctrl+Space → see completion"
echo "     - Ctrl+Click on 'greet' → jump to definition"
echo ""
