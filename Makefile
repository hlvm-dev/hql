# HQL Build System - Simple distribution builder
# Usage:
#   make          - Build for your computer
#   make install  - Install system-wide
#   make all      - Build for Mac/Linux/Windows

VERSION := 0.1.0
BINARY := hql
DIST_DIR := dist

# Quick build for current computer
build:
	@mkdir -p $(DIST_DIR)
	@echo "📦 Embedding HQL packages..."
	@./scripts/embed-packages.ts
	@echo "🔨 Building HQL binary..."
	@deno compile --allow-all --no-check --output $(DIST_DIR)/$(BINARY) core/cli/cli.ts
	@echo "✅ Done! Binary: ./$(DIST_DIR)/$(BINARY)"
	@ls -lh $(DIST_DIR)/$(BINARY)

# Install to system
install: build
	@echo "📦 Installing HQL system-wide..."
	@sudo cp $(DIST_DIR)/$(BINARY) /usr/local/bin/
	@echo "✅ Installed! Try: hql --version"

# Build and launch REPL immediately
fast: build
	@echo "🚀 Launching REPL..."
	@./$(DIST_DIR)/$(BINARY) repl

# Test it works
test: build
	@echo "🧪 Testing HQL binary..."
	@./$(DIST_DIR)/$(BINARY) --version
	@echo '(print "Test passed!")' > /tmp/hql-test.hql
	@./$(DIST_DIR)/$(BINARY) run /tmp/hql-test.hql
	@rm /tmp/hql-test.hql
	@echo "✅ All tests passed!"

# Build for Mac (Intel)
build-mac-intel:
	@mkdir -p $(DIST_DIR)
	@echo "📦 Embedding HQL packages..."
	@./scripts/embed-packages.ts
	@echo "🍎 Building for Mac Intel..."
	@deno compile --allow-all --no-check --target x86_64-apple-darwin --output $(DIST_DIR)/hql-mac-intel core/cli/cli.ts
	@echo "✅ Created: $(DIST_DIR)/hql-mac-intel"

# Build for Mac (Apple Silicon)
build-mac-arm:
	@mkdir -p $(DIST_DIR)
	@echo "📦 Embedding HQL packages..."
	@./scripts/embed-packages.ts
	@echo "🍎 Building for Mac ARM..."
	@deno compile --allow-all --no-check --target aarch64-apple-darwin --output $(DIST_DIR)/hql-mac-arm core/cli/cli.ts
	@echo "✅ Created: $(DIST_DIR)/hql-mac-arm"

# Build for Linux
build-linux:
	@mkdir -p $(DIST_DIR)
	@echo "📦 Embedding HQL packages..."
	@./scripts/embed-packages.ts
	@echo "🐧 Building for Linux..."
	@deno compile --allow-all --no-check --target x86_64-unknown-linux-gnu --output $(DIST_DIR)/hql-linux core/cli/cli.ts
	@echo "✅ Created: $(DIST_DIR)/hql-linux"

# Build for Windows
build-windows:
	@mkdir -p $(DIST_DIR)
	@echo "📦 Embedding HQL packages..."
	@./scripts/embed-packages.ts
	@echo "🪟 Building for Windows..."
	@deno compile --allow-all --no-check --target x86_64-pc-windows-msvc --output $(DIST_DIR)/hql-windows.exe core/cli/cli.ts
	@echo "✅ Created: $(DIST_DIR)/hql-windows.exe"

# Build for ALL platforms (for distribution)
all: build-mac-intel build-mac-arm build-linux build-windows
	@echo ""
	@echo "📦 All binaries built:"
	@ls -lh $(DIST_DIR)/hql-*
	@echo ""
	@echo "✅ Ready to distribute!"

# Clean up
clean:
	@rm -rf $(DIST_DIR) /tmp/hql-test.hql
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
