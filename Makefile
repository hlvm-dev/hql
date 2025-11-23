# HQL Build System - Simple distribution builder
# Usage:
#   make          - Build for your computer
#   make install  - Install system-wide
#   make all      - Build for Mac/Linux/Windows

VERSION := 0.1.0
BINARY := hql

# Quick build for current computer
build:
	@echo "📦 Embedding HQL packages..."
	@./scripts/embed-packages.ts
	@echo "🔨 Building HQL binary..."
	@deno compile --allow-all --no-check --config deno.json --output $(BINARY) core/cli/cli.ts
	@echo "✅ Done! Binary: ./$(BINARY)"
	@ls -lh $(BINARY)

# Install to system
install: build
	@echo "📦 Installing HQL system-wide..."
	@sudo cp $(BINARY) /usr/local/bin/
	@echo "✅ Installed! Try: hql --version"

# Build and launch REPL immediately
fast: build
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
	@deno compile --allow-all --no-check --target x86_64-apple-darwin --output hql-mac-intel core/cli/cli.ts
	@echo "✅ Created: hql-mac-intel"

# Build for Mac (Apple Silicon)
build-mac-arm:
	@echo "📦 Embedding HQL packages..."
	@./scripts/embed-packages.ts
	@echo "🍎 Building for Mac ARM..."
	@deno compile --allow-all --no-check --target aarch64-apple-darwin --output hql-mac-arm core/cli/cli.ts
	@echo "✅ Created: hql-mac-arm"

# Build for Linux
build-linux:
	@echo "📦 Embedding HQL packages..."
	@./scripts/embed-packages.ts
	@echo "🐧 Building for Linux..."
	@deno compile --allow-all --no-check --target x86_64-unknown-linux-gnu --output hql-linux core/cli/cli.ts
	@echo "✅ Created: hql-linux"

# Build for Windows
build-windows:
	@echo "📦 Embedding HQL packages..."
	@./scripts/embed-packages.ts
	@echo "🪟 Building for Windows..."
	@deno compile --allow-all --no-check --target x86_64-pc-windows-msvc --output hql-windows.exe core/cli/cli.ts
	@echo "✅ Created: hql-windows.exe"

# Build for ALL platforms (for distribution)
all: build-mac-intel build-mac-arm build-linux build-windows
	@echo ""
	@echo "📦 All binaries built:"
	@ls -lh hql-*
	@echo ""
	@echo "✅ Ready to distribute!"

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
	@echo "  make fast         - Build and launch REPL"
	@echo "  make install      - Install system-wide"
	@echo "  make test         - Build and test"
	@echo "  make all          - Build for all platforms"
	@echo "  make clean        - Remove build files"
	@echo ""
	@echo "Platform-specific builds:"
	@echo "  make build-mac-intel"
	@echo "  make build-mac-arm"
	@echo "  make build-linux"
	@echo "  make build-windows"

.PHONY: build install fast test all clean help
.PHONY: build-mac-intel build-mac-arm build-linux build-windows
