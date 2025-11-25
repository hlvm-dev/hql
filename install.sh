#!/bin/sh
# HQL Language Installer
# Usage: curl -fsSL https://hql-lang.org/install.sh | sh
# Or: curl -fsSL https://raw.githubusercontent.com/yourusername/hql/main/install.sh | sh

set -e

# Colors for pretty output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Configuration
REPO="hlvm-dev/hql"
VERSION="latest"
INSTALL_DIR="${HQL_INSTALL_DIR:-$HOME/.hql}"
BIN_DIR="$INSTALL_DIR/bin"

# Detect platform
detect_platform() {
    local platform=""
    local arch=""

    # Detect OS
    case "$(uname -s)" in
        Darwin*)
            platform="mac"
            ;;
        Linux*)
            platform="linux"
            ;;
        MINGW*|MSYS*|CYGWIN*)
            platform="windows"
            ;;
        *)
            echo "${RED}Error: Unsupported operating system$(uname -s)${NC}"
            exit 1
            ;;
    esac

    # Detect architecture
    case "$(uname -m)" in
        x86_64|amd64)
            arch="intel"
            ;;
        aarch64|arm64)
            arch="arm"
            ;;
        *)
            echo "${RED}Error: Unsupported architecture $(uname -m)${NC}"
            exit 1
            ;;
    esac

    # Combine platform and architecture
    if [ "$platform" = "mac" ]; then
        if [ "$arch" = "arm" ]; then
            echo "hql-mac-arm"
        else
            echo "hql-mac-intel"
        fi
    elif [ "$platform" = "linux" ]; then
        echo "hql-linux"
    else
        echo "hql-windows.exe"
    fi
}

# Download binary from GitHub releases
download_binary() {
    local binary_name="$1"
    local download_url="https://github.com/$REPO/releases/latest/download/$binary_name"

    echo "${BLUE}→ Downloading HQL from $download_url${NC}"

    # Create installation directory
    mkdir -p "$BIN_DIR"

    # Download binary
    if command -v curl > /dev/null 2>&1; then
        curl -fsSL "$download_url" -o "$BIN_DIR/hql"
    elif command -v wget > /dev/null 2>&1; then
        wget -q "$download_url" -O "$BIN_DIR/hql"
    else
        echo "${RED}Error: curl or wget is required${NC}"
        exit 1
    fi

    # Make binary executable
    chmod +x "$BIN_DIR/hql"
}

# Add to PATH
setup_path() {
    local shell_config=""

    # Detect shell configuration file
    if [ -n "$ZSH_VERSION" ]; then
        shell_config="$HOME/.zshrc"
    elif [ -n "$BASH_VERSION" ]; then
        if [ -f "$HOME/.bash_profile" ]; then
            shell_config="$HOME/.bash_profile"
        else
            shell_config="$HOME/.bashrc"
        fi
    elif [ -f "$HOME/.profile" ]; then
        shell_config="$HOME/.profile"
    fi

    # Check if already in PATH
    if echo "$PATH" | grep -q "$BIN_DIR"; then
        echo "${GREEN}✓ $BIN_DIR already in PATH${NC}"
        return
    fi

    # Add to shell config
    if [ -n "$shell_config" ]; then
        echo "" >> "$shell_config"
        echo "# HQL Language" >> "$shell_config"
        echo "export PATH=\"\$PATH:$BIN_DIR\"" >> "$shell_config"
        echo "${GREEN}✓ Added $BIN_DIR to $shell_config${NC}"
        echo "${YELLOW}⚠ Please restart your shell or run: source $shell_config${NC}"
    else
        echo "${YELLOW}⚠ Could not detect shell configuration file${NC}"
        echo "${YELLOW}⚠ Please manually add $BIN_DIR to your PATH${NC}"
    fi
}

# Main installation
main() {
    echo "${BOLD}${BLUE}"
    echo "╔═══════════════════════════════════════╗"
    echo "║   HQL Language Installer              ║"
    echo "╚═══════════════════════════════════════╝"
    echo "${NC}"

    # Detect platform
    local binary_name=$(detect_platform)
    echo "${BLUE}→ Detected platform: $binary_name${NC}"

    # Download binary
    download_binary "$binary_name"

    # Setup PATH
    setup_path

    # Verify installation
    if [ -x "$BIN_DIR/hql" ]; then
        local version=$("$BIN_DIR/hql" --version 2>&1 || echo "unknown")
        echo ""
        echo "${GREEN}${BOLD}✅ HQL installed successfully!${NC}"
        echo "${GREEN}   Version: $version${NC}"
        echo ""
        echo "${BLUE}Quick start:${NC}"
        echo "  ${BOLD}hql repl${NC}        - Start interactive REPL"
        echo "  ${BOLD}hql run file.hql${NC} - Run a HQL file"
        echo "  ${BOLD}hql --help${NC}       - Show all commands"
        echo ""
        echo "${YELLOW}Note: You may need to restart your shell or run:${NC}"
        echo "  ${BOLD}export PATH=\"\$PATH:$BIN_DIR\"${NC}"
    else
        echo "${RED}Error: Installation failed${NC}"
        exit 1
    fi
}

# Run installer
main
