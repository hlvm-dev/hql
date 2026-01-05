# HQL Build System - Simple distribution builder
# Usage:
#   make          - Build for your computer
#   make install  - Install system-wide
#   make all      - Build for Mac/Linux/Windows

VERSION := 0.0.1
BINARY := hql

# Quick build for current computer
build:
	@echo "📦 Embedding HQL packages..."
	@./scripts/embed-packages.ts
	@echo "🔨 Building HQL binary..."
	@deno compile --allow-all --no-check --config deno.json --output $(BINARY) src/cli/cli.ts
	@echo "✅ Done! Binary: ./$(BINARY)"
	@ls -lh $(BINARY)

# Install to system
install: build
	@echo "📦 Installing HQL system-wide..."
	@sudo cp $(BINARY) /usr/local/bin/
	@echo "✅ Installed! Try: hql --version"

# Build and launch REPL immediately
repl: build
	@echo "🚀 Launching REPL..."
	@./$(BINARY) repl

# Test it works
test: build
	@echo "🧪 Testing HQL binary..."
	@./$(BINARY) --version
	@echo '(print "Test passed!")' > /tmp/hql-test.hql
	@./$(BINARY) run /tmp/hql-test.hql
	@rm /tmp/hql-test.hql
	@echo "✅ All tests passed!"

# Build for Mac (Intel)
build-mac-intel:
	@echo "📦 Embedding HQL packages..."
	@./scripts/embed-packages.ts
	@echo "🍎 Building for Mac Intel..."
	@deno compile --allow-all --no-check --target x86_64-apple-darwin --output hql-mac-intel src/cli/cli.ts
	@echo "✅ Created: hql-mac-intel"

# Build for Mac (Apple Silicon)
build-mac-arm:
	@echo "📦 Embedding HQL packages..."
	@./scripts/embed-packages.ts
	@echo "🍎 Building for Mac ARM..."
	@deno compile --allow-all --no-check --target aarch64-apple-darwin --output hql-mac-arm src/cli/cli.ts
	@echo "✅ Created: hql-mac-arm"

# Build for Linux
build-linux:
	@echo "📦 Embedding HQL packages..."
	@./scripts/embed-packages.ts
	@echo "🐧 Building for Linux..."
	@deno compile --allow-all --no-check --target x86_64-unknown-linux-gnu --output hql-linux src/cli/cli.ts
	@echo "✅ Created: hql-linux"

# Build for Windows
build-windows:
	@echo "📦 Embedding HQL packages..."
	@./scripts/embed-packages.ts
	@echo "🪟 Building for Windows..."
	@deno compile --allow-all --no-check --target x86_64-pc-windows-msvc --output hql-windows.exe src/cli/cli.ts
	@echo "✅ Created: hql-windows.exe"

# Build for ALL platforms (for distribution)
all: build-mac-intel build-mac-arm build-linux build-windows
	@echo ""
	@echo "📦 All binaries built:"
	@ls -lh hql-*
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
	@echo "📦 Embedding HQL packages..."
	@./scripts/embed-packages.ts
	@echo "🤖 Building HQL with AI (includes Ollama)..."
	@deno compile --allow-all --no-check --config deno.json \
		--include resources/ai-engine \
		--output $(BINARY) src/cli/cli.ts
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
	@echo "🧪 Testing HQL AI features..."
	@./$(BINARY) run -e '(import [ask] from "@hql/ai") (print (ask "Say: Hello from HQL!"))'
	@echo "✅ AI test passed!"

# Clean up
clean:
	@rm -f hql hql-* /tmp/hql-test.hql
	@echo "🧹 Cleaned build files"

# Show help
help:
	@echo "HQL Build System"
	@echo ""
	@echo "Commands:"
	@echo "  make              - Build for current computer"
	@echo "  make repl         - Build and launch REPL"
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

.PHONY: build install repl test all clean help
.PHONY: build-mac-intel build-mac-arm build-linux build-windows
.PHONY: build-ai setup-ai test-ai
