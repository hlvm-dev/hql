# HLVM Build System - Simple distribution builder
# Usage:
#   make          - Build for your computer
#   make install  - Install system-wide
#   make all      - Build for Mac/Linux/Windows

VERSION := 0.0.1
BINARY := hlvm

# Quick build for current computer
build:
	@echo "📦 Embedding HLVM packages..."
	@./scripts/embed-packages.ts
	@echo "🔨 Building HLVM binary..."
	@deno compile --allow-all --no-check --config deno.json --output $(BINARY) src/hlvm/cli/cli.ts
	@echo "✅ Done! Binary: ./$(BINARY)"
	@ls -lh $(BINARY)

# Install to system
install: build
	@echo "📦 Installing HLVM system-wide..."
	@sudo cp $(BINARY) /usr/local/bin/
	@echo "✅ Installed! Try: hlvm --version"

# Build and launch REPL immediately
repl: build
	@echo "🚀 Launching REPL..."
	@./$(BINARY) repl

# Build and launch Ink REPL (experimental - better AI streaming)
ink: build
	@echo "🚀 Launching Ink REPL..."
	@./$(BINARY) repl --ink

# Test it works
test: build
	@echo "🧪 Testing HLVM binary..."
	@./$(BINARY) --version
	@echo '(print "Test passed!")' > /tmp/hlvm-test.hql
	@./$(BINARY) run /tmp/hlvm-test.hql
	@rm /tmp/hlvm-test.hql
	@echo "✅ All tests passed!"

# Build for Mac (Intel)
build-mac-intel:
	@echo "📦 Embedding HLVM packages..."
	@./scripts/embed-packages.ts
	@echo "🍎 Building for Mac Intel..."
	@deno compile --allow-all --no-check --target x86_64-apple-darwin --output hlvm-mac-intel src/hlvm/cli/cli.ts
	@echo "✅ Created: hlvm-mac-intel"

# Build for Mac (Apple Silicon)
build-mac-arm:
	@echo "📦 Embedding HLVM packages..."
	@./scripts/embed-packages.ts
	@echo "🍎 Building for Mac ARM..."
	@deno compile --allow-all --no-check --target aarch64-apple-darwin --output hlvm-mac-arm src/hlvm/cli/cli.ts
	@echo "✅ Created: hlvm-mac-arm"

# Build for Linux
build-linux:
	@echo "📦 Embedding HLVM packages..."
	@./scripts/embed-packages.ts
	@echo "🐧 Building for Linux..."
	@deno compile --allow-all --no-check --target x86_64-unknown-linux-gnu --output hlvm-linux src/hlvm/cli/cli.ts
	@echo "✅ Created: hlvm-linux"

# Build for Windows
build-windows:
	@echo "📦 Embedding HLVM packages..."
	@./scripts/embed-packages.ts
	@echo "🪟 Building for Windows..."
	@deno compile --allow-all --no-check --target x86_64-pc-windows-msvc --output hlvm-windows.exe src/hlvm/cli/cli.ts
	@echo "✅ Created: hlvm-windows.exe"

# Build for ALL platforms (for distribution)
all: build-mac-intel build-mac-arm build-linux build-windows
	@echo ""
	@echo "📦 All binaries built:"
	@ls -lh hlvm-*
	@echo ""
	@echo "✅ Ready to distribute!"

# Build with AI (includes embedded Ollama)
# Requires: resources/ai-engine (Ollama binary)
build-ai:
	@if [ ! -f resources/ai-engine ]; then \
		echo "❌ Missing resources/ai-engine"; \
		echo "   Run: make setup-ai"; \
		exit 1; \
	fi
	@echo "📦 Embedding HLVM packages..."
	@./scripts/embed-packages.ts
	@echo "🤖 Building HLVM with AI (includes Ollama)..."
	@deno compile --allow-all --no-check --config deno.json \
		--include resources/ai-engine \
		--output $(BINARY) src/hlvm/cli/cli.ts
	@echo "✅ Done! AI-enabled binary: ./$(BINARY)"
	@ls -lh $(BINARY)

# Setup AI engine (download Ollama for embedding)
setup-ai:
	@echo "📥 Setting up AI engine..."
	@mkdir -p resources
	@if [ -f /usr/local/bin/ollama ]; then \
		echo "   Using system Ollama..."; \
		cp /usr/local/bin/ollama resources/ai-engine; \
	elif [ -f $(HOME)/.ollama/ollama ]; then \
		echo "   Using user Ollama..."; \
		cp $(HOME)/.ollama/ollama resources/ai-engine; \
	elif command -v ollama >/dev/null 2>&1; then \
		echo "   Copying from PATH..."; \
		cp $$(which ollama) resources/ai-engine; \
	else \
		echo "❌ Ollama not found. Install it first:"; \
		echo "   curl -fsSL https://ollama.com/install.sh | sh"; \
		exit 1; \
	fi
	@chmod +x resources/ai-engine
	@echo "✅ AI engine ready: resources/ai-engine"
	@ls -lh resources/ai-engine

# Test AI features
test-ai: build-ai
	@echo "🧪 Testing HLVM AI features..."
	@./$(BINARY) run -e '(import [ask] from "@hlvm/ai") (print (ask "Say: Hello from HLVM!"))'
	@echo "✅ AI test passed!"

# Clean up
clean:
	@rm -f hlvm hlvm-* /tmp/hlvm-test.hql
	@echo "🧹 Cleaned build files"

# Show help
help:
	@echo "HLVM Build System"
	@echo ""
	@echo "Commands:"
	@echo "  make              - Build for current computer"
	@echo "  make repl         - Build and launch REPL"
	@echo "  make ink          - Build and launch Ink REPL (experimental)"
	@echo "  make install      - Install system-wide"
	@echo "  make test         - Build and test"
	@echo "  make all          - Build for all platforms"
	@echo "  make clean        - Remove build files"
	@echo ""
	@echo "AI-Enabled Build (includes Ollama):"
	@echo "  make setup-ai     - Setup AI engine (copy Ollama)"
	@echo "  make build-ai     - Build with embedded AI"
	@echo "  make test-ai      - Test AI features"
	@echo ""
	@echo "Platform-specific builds:"
	@echo "  make build-mac-intel"
	@echo "  make build-mac-arm"
	@echo "  make build-linux"
	@echo "  make build-windows"

.PHONY: build install repl ink test all clean help
.PHONY: build-mac-intel build-mac-arm build-linux build-windows
.PHONY: build-ai setup-ai test-ai
