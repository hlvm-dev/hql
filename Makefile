# HLVM Build System
# Usage:
#   make          - Build for your computer
#   make install  - Install system-wide
#   make all      - Build for Mac/Linux/Windows

VERSION := 0.2.0
BINARY := hlvm
CLI_ENTRY := src/hlvm/cli/cli.ts
COMPILE_SCRIPT := ./scripts/compile-hlvm.sh

# Transpile stdlib.hql → self-hosted.js
stdlib:
	@echo "Building stdlib from HQL source..."
	@deno run -A scripts/build-stdlib.ts

# Embed HQL packages for development and binary builds
embed-packages:
	@echo "Embedding HLVM packages..."
	@./scripts/embed-packages.ts

# Generate OpenAPI specification
openapi:
	@echo "Generating OpenAPI specification..."
	@deno task openapi

# Build for current computer (clean)
build: clean stdlib embed-packages
	@echo "Building HLVM binary..."
	@DENO_DIR=$$(mktemp -d) $(COMPILE_SCRIPT) --output $(BINARY)
	@echo "Done! Binary: ./$(BINARY)"
	@ls -lh $(BINARY)

# Fast build — uses cached DENO_DIR, skips clean
build-fast: stdlib embed-packages
	@echo "Building HLVM binary (cached)..."
	@$(COMPILE_SCRIPT) --output $(BINARY)
	@echo "Done! Binary: ./$(BINARY)"
	@ls -lh $(BINARY)

# Install to system
install: build
	@echo "Installing HLVM system-wide..."
	@sudo cp $(BINARY) /usr/local/bin/
	@echo "Installed! Try: hlvm --version"

# Build and launch REPL immediately
repl: build
	@echo "Launching REPL..."
	@./$(BINARY) repl

# Fast REPL — cached build, no clean
fast: build-fast
	@echo "Launching REPL..."
	@./$(BINARY) repl

# Build and launch Ink REPL (experimental - better AI streaming)
ink: build
	@echo "Launching Ink REPL..."
	@./$(BINARY) repl --ink

# Test it works
test: build
	@echo "Testing HLVM binary..."
	@./$(BINARY) --version
	@echo '(print "Test passed!")' > /tmp/hlvm-test.hql
	@./$(BINARY) run /tmp/hlvm-test.hql
	@rm /tmp/hlvm-test.hql
	@echo "All tests passed!"

# Build for Mac (Intel)
build-mac-intel: stdlib embed-packages
	@echo "Building for Mac Intel..."
	@$(COMPILE_SCRIPT) --target x86_64-apple-darwin --output hlvm-mac-intel
	@echo "Created: hlvm-mac-intel"

# Build for Mac (Apple Silicon)
build-mac-arm: stdlib embed-packages
	@echo "Building for Mac ARM..."
	@$(COMPILE_SCRIPT) --target aarch64-apple-darwin --output hlvm-mac-arm
	@echo "Created: hlvm-mac-arm"

# Build for Linux
build-linux: stdlib embed-packages
	@echo "Building for Linux..."
	@$(COMPILE_SCRIPT) --target x86_64-unknown-linux-gnu --output hlvm-linux
	@echo "Created: hlvm-linux"

# Build for Windows
build-windows: stdlib embed-packages
	@echo "Building for Windows..."
	@$(COMPILE_SCRIPT) --target x86_64-pc-windows-msvc --output hlvm-windows.exe
	@echo "Created: hlvm-windows.exe"

# Build for ALL platforms (for distribution)
all: build-mac-intel build-mac-arm build-linux build-windows
	@echo ""
	@echo "All binaries built:"
	@ls -lh hlvm-*
	@echo ""
	@echo "Ready to distribute!"

# Test AI features
test-ai: build
	@echo "Testing HLVM AI features..."
	@./$(BINARY) run -e '(print (ai.status))'
	@echo "AI test passed!"

# Clean up (binaries + Deno compile cache)
clean:
	@rm -f hlvm hlvm-* /tmp/hlvm-test.hql
	@rm -rf "$${DENO_DIR:-$$HOME/.cache/deno}/deno_compile_*" 2>/dev/null || true
	@echo "Cleaned build files + compile cache"

# Show help
help:
	@echo "HLVM Build System"
	@echo ""
	@echo "Commands:"
	@echo "  make              - Build for current computer"
	@echo "  make fast         - Build + REPL using cached deps"
	@echo "  make repl         - Build + REPL from clean slate"
	@echo "  make ink          - Build + Ink REPL (experimental)"
	@echo "  make install      - Install system-wide"
	@echo "  make test         - Build and test"
	@echo "  make test-ai      - Build and test AI features"
	@echo "  make all          - Build for all platforms"
	@echo "  make clean        - Remove build files"
	@echo ""
	@echo "Platform-specific builds:"
	@echo "  make build-mac-intel"
	@echo "  make build-mac-arm"
	@echo "  make build-linux"
	@echo "  make build-windows"
	@echo ""
	@echo "Note: Ollama is downloaded at runtime (hlvm bootstrap),"
	@echo "      not embedded in the binary at build time."

.PHONY: stdlib embed-packages openapi build build-fast install repl fast ink test all clean help
.PHONY: build-mac-intel build-mac-arm build-linux build-windows test-ai
