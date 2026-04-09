# HLVM Build System - Simple distribution builder
# Usage:
#   make          - Build for your computer
#   make install  - Install system-wide
#   make all      - Build for Mac/Linux/Windows

VERSION := 0.1.0
BINARY := hlvm
CLI_ENTRY := src/hlvm/cli/cli.ts
AI_ENGINE_DIR := resources/ai-engine
AI_ENGINE_STAMP := $(AI_ENGINE_DIR)/.ollama-source
AI_MODEL_DIR := resources/ai-model
AI_MODEL_STAMP := $(AI_MODEL_DIR)/.model-source
CHROMIUM_DIR := resources/ai-chromium
COMPILE_SCRIPT := ./scripts/compile-hlvm.sh

# Transpile stdlib.hql → self-hosted.js
stdlib:
	@echo "Building stdlib from HQL source..."
	@deno run -A scripts/build-stdlib.ts

# Embed HQL packages for development and binary builds
embed-packages:
	@echo "📦 Embedding HLVM packages..."
	@./scripts/embed-packages.ts

# Generate OpenAPI specification
openapi:
	@echo "Generating OpenAPI specification..."
	@deno task openapi

# Quick build for current computer (always clean — no stale cache)
build: clean setup-ai stdlib embed-packages
	@echo "🔨 Building HLVM binary with embedded AI engine (clean)..."
	@DENO_DIR=$$(mktemp -d) $(COMPILE_SCRIPT) --output $(BINARY)
	@echo "✅ Done! Binary: ./$(BINARY)"
	@ls -lh $(BINARY)

# Fast build — uses cached DENO_DIR, skips clean
build-fast: setup-ai stdlib embed-packages
	@echo "🔨 Building HLVM binary with embedded AI engine (cached)..."
	@$(COMPILE_SCRIPT) --output $(BINARY)
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

# Fast REPL — cached build, no clean
fast: build-fast
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
build-mac-intel: stdlib embed-packages
	@echo "🍎 Building for Mac Intel..."
	@$(COMPILE_SCRIPT) --target x86_64-apple-darwin --output hlvm-mac-intel
	@echo "✅ Created: hlvm-mac-intel"

# Build for Mac (Apple Silicon)
build-mac-arm: stdlib embed-packages
	@echo "🍎 Building for Mac ARM..."
	@$(COMPILE_SCRIPT) --target aarch64-apple-darwin --output hlvm-mac-arm
	@echo "✅ Created: hlvm-mac-arm"

# Build for Linux
build-linux: stdlib embed-packages
	@echo "🐧 Building for Linux..."
	@$(COMPILE_SCRIPT) --target x86_64-unknown-linux-gnu --output hlvm-linux
	@echo "✅ Created: hlvm-linux"

# Build for Windows
build-windows: stdlib embed-packages
	@echo "🪟 Building for Windows..."
	@$(COMPILE_SCRIPT) --target x86_64-pc-windows-msvc --output hlvm-windows.exe
	@echo "✅ Created: hlvm-windows.exe"

# Build for ALL platforms (for distribution)
all: build-mac-intel build-mac-arm build-linux build-windows
	@echo ""
	@echo "📦 All binaries built:"
	@ls -lh hlvm-*
	@echo ""
	@echo "✅ Ready to distribute!"

# Build with AI (compatibility alias for the default build)
build-ai: build
	@true

# Pinned Ollama version — SSOT shared with GitHub Actions.
OLLAMA_VERSION ?= $(strip $(shell cat embedded-ollama-version.txt))

# Setup AI engine (download pinned Ollama runtime for embedding)
setup-ai:
	@echo "📥 Setting up AI engine (Ollama $(OLLAMA_VERSION))..."
	@mkdir -p resources
	@set -e; \
	if [ -f "$(AI_ENGINE_STAMP)" ] \
		&& [ "$$(cat "$(AI_ENGINE_STAMP)" 2>/dev/null)" = "official:$(OLLAMA_VERSION)" ] \
		&& [ -f "$(AI_ENGINE_DIR)/manifest.json" ] \
		&& { [ -f "$(AI_ENGINE_DIR)/ollama" ] || [ -f "$(AI_ENGINE_DIR)/ollama.exe" ]; }; then \
		echo "✅ AI engine already present: $(AI_ENGINE_DIR) (Ollama $(OLLAMA_VERSION))"; \
		ls -lah "$(AI_ENGINE_DIR)"; \
		exit 0; \
	fi; \
	rm -rf "$(AI_ENGINE_DIR)"; \
	mkdir -p "$(AI_ENGINE_DIR)"; \
	UNAME_S=$$(uname -s); UNAME_M=$$(uname -m); \
	STAMP_VALUE="official:$(OLLAMA_VERSION)"; \
	OLLAMA_BASE="https://github.com/ollama/ollama/releases/download/$(OLLAMA_VERSION)"; \
	if [ "$$UNAME_S" = "Darwin" ]; then \
		OLLAMA_ASSET="ollama-darwin.tgz"; \
	elif [ "$$UNAME_S" = "Linux" ] && [ "$$UNAME_M" = "x86_64" ]; then \
		OLLAMA_ASSET="ollama-linux-amd64.tar.zst"; \
	elif [ "$$UNAME_S" = "Linux" ] && [ "$$UNAME_M" = "aarch64" ]; then \
		OLLAMA_ASSET="ollama-linux-arm64.tar.zst"; \
	else \
		echo "❌ No official Ollama binary for $$UNAME_S/$$UNAME_M."; \
		echo "   Falling back to system Ollama..."; \
		if command -v ollama >/dev/null 2>&1; then \
			cp $$(which ollama) "$(AI_ENGINE_DIR)/ollama"; \
			chmod +x "$(AI_ENGINE_DIR)/ollama"; \
			STAMP_VALUE="system:$$(ollama --version 2>/dev/null | head -1 | tr -d '\r')"; \
			OLLAMA_ASSET=""; \
		else \
			echo "❌ Ollama not found. Install from: https://ollama.ai"; \
			exit 1; \
		fi; \
	fi; \
	if [ -n "$$OLLAMA_ASSET" ]; then \
		OLLAMA_URL="$$OLLAMA_BASE/$$OLLAMA_ASSET"; \
		ARCHIVE_PATH="resources/$$OLLAMA_ASSET"; \
		echo "   Downloading from $$OLLAMA_URL..."; \
		curl -fsSL -o "$$ARCHIVE_PATH" "$$OLLAMA_URL"; \
		case "$$OLLAMA_ASSET" in \
			*.tgz) tar -xzf "$$ARCHIVE_PATH" -C "$(AI_ENGINE_DIR)" ;; \
			*.tar.zst) tar --zstd -xf "$$ARCHIVE_PATH" -C "$(AI_ENGINE_DIR)" ;; \
			*) echo "❌ Unsupported Ollama archive: $$OLLAMA_ASSET"; exit 1 ;; \
		esac; \
		rm -f "$$ARCHIVE_PATH"; \
	fi; \
	if [ ! -f "$(AI_ENGINE_DIR)/ollama" ] && [ ! -f "$(AI_ENGINE_DIR)/ollama.exe" ]; then \
		echo "❌ Extracted Ollama runtime is missing the main executable."; \
		exit 1; \
	fi; \
	printf '%s\n' "$$STAMP_VALUE" > "$(AI_ENGINE_STAMP)"
	@deno run -A scripts/write-ai-engine-manifest.ts "$(AI_ENGINE_DIR)"
	@chmod +x "$(AI_ENGINE_DIR)/ollama" 2>/dev/null || true
	@echo "✅ AI engine ready: $(AI_ENGINE_DIR) (Ollama $(OLLAMA_VERSION))"
	@ls -lah "$(AI_ENGINE_DIR)"

# Setup bundled model (pull gemma4:e4b into resources/ai-model/)
setup-model: setup-ai
	@echo "📥 Setting up bundled model..."
	@./scripts/setup-bundled-model.sh

# Package sidecar model tarball for bundled install
# The binary stays standard (~587 MB); the model ships as a separate tarball.
# macOS/Windows Mach-O/PE32+ limit is 2 GB — embedding ~9.6 GB is impossible.
package-bundled-model: setup-model
	@echo "📦 Packaging sidecar model tarball..."
	@tar -cf hlvm-model.tar -C resources/ai-model .
	@echo "✅ Done! Sidecar: ./hlvm-model.tar"
	@ls -lh hlvm-model.tar

# Setup Chromium for bundled build (download via playwright-core)
setup-chromium:  ## Download Chromium for bundled build
	@echo "📥 Setting up bundled Chromium..."
	@./scripts/setup-bundled-chromium.sh

# Package Chromium sidecar tarball
package-bundled-chromium: setup-chromium  ## Package Chromium sidecar tarball
	@echo "📦 Packaging sidecar Chromium tarball..."
	@tar -czf hlvm-chromium.tar.gz -C $(CHROMIUM_DIR) .
	@echo "✅ Done! Sidecar: ./hlvm-chromium.tar.gz"
	@ls -lh hlvm-chromium.tar.gz

# Build standard binary + sidecar model + sidecar Chromium for bundled distribution
build-bundled: clean setup-ai setup-model setup-chromium stdlib embed-packages
	@echo "🔨 Building HLVM binary + sidecar model + sidecar Chromium..."
	@DENO_DIR=$$(mktemp -d) $(COMPILE_SCRIPT) --output $(BINARY)
	@tar -cf hlvm-model.tar -C resources/ai-model .
	@tar -czf hlvm-chromium.tar.gz -C $(CHROMIUM_DIR) .
	@echo "✅ Done! Binary: ./$(BINARY) + Sidecars: ./hlvm-model.tar ./hlvm-chromium.tar.gz"
	@ls -lh $(BINARY) hlvm-model.tar hlvm-chromium.tar.gz

# Test AI features
test-ai: build-ai
	@echo "🧪 Testing HLVM AI features..."
	@./$(BINARY) run -e '(print (ai.status))'
	@echo "✅ AI test passed!"

# Clean up (binaries + Deno compile cache)
clean:
	@rm -f hlvm hlvm-* /tmp/hlvm-test.hql
	@rm -rf "$${DENO_DIR:-$$HOME/.cache/deno}/deno_compile_*" 2>/dev/null || true
	@echo "🧹 Cleaned build files + compile cache"

# Show help
help:
	@echo "HLVM Build System"
	@echo ""
	@echo "Commands:"
	@echo "  make              - Build for current computer with embedded AI (clean)"
	@echo "  make fast         - Build + REPL with embedded AI using cached deps"
	@echo "  make repl         - Build + REPL from clean slate"
	@echo "  make ink          - Build + Ink REPL (experimental)"
	@echo "  make install      - Install system-wide"
	@echo "  make test         - Build and test"
	@echo "  make all          - Build for all platforms"
	@echo "  make clean        - Remove build files"
	@echo ""
	@echo "Embedded AI engine:"
	@echo "  make setup-ai     - Setup pinned embedded AI runtime"
	@echo "  make build-ai     - Compatibility alias for 'make'"
	@echo "  make test-ai      - Test AI features"
	@echo ""
	@echo "Bundled (sidecar tarballs for offline install):"
	@echo "  make setup-model              - Pull gemma4:e4b into resources/ai-model/"
	@echo "  make package-bundled-model    - Create sidecar hlvm-model.tar"
	@echo "  make setup-chromium           - Download Chromium into resources/ai-chromium/"
	@echo "  make package-bundled-chromium - Create sidecar hlvm-chromium.tar.gz"
	@echo "  make build-bundled            - Build binary + sidecar model + sidecar Chromium"
	@echo ""
	@echo "Platform-specific builds:"
	@echo "  make build-mac-intel"
	@echo "  make build-mac-arm"
	@echo "  make build-linux"
	@echo "  make build-windows"

.PHONY: stdlib embed-packages openapi build build-fast install repl fast ink test all clean help
.PHONY: build-mac-intel build-mac-arm build-linux build-windows
.PHONY: build-ai setup-ai test-ai setup-model package-bundled-model
.PHONY: setup-chromium package-bundled-chromium build-bundled
