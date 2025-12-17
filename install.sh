#!/bin/sh
# HQL Language Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/hlvm-dev/hql/main/install.sh | sh

set -e

# Colors for pretty output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m' # No Color

# Configuration
REPO="hlvm-dev/hql"
VERSION="latest"
INSTALL_DIR="${HQL_INSTALL_DIR:-$HOME/.hql}"
BIN_DIR="$INSTALL_DIR/bin"

# Print functions
print_step() {
    echo "${BOLD}${BLUE}==>${NC}${BOLD} $1${NC}"
}

print_success() {
    echo "${GREEN}✓${NC} $1"
}

print_error() {
    echo "${RED}✗${NC} $1"
}

print_warning() {
    echo "${YELLOW}⚠${NC} $1"
}

print_info() {
    echo "${CYAN}ℹ${NC} $1"
}

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
            print_error "Unsupported operating system: $(uname -s)"
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
            print_error "Unsupported architecture: $(uname -m)"
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
        if [ "$arch" = "arm" ]; then
            print_error "Linux ARM64 is not yet supported"
            print_info "Supported platforms: Linux x86_64, macOS (Intel/ARM), Windows"
            print_info "Build from source: https://github.com/hlvm-dev/hql#building-from-source"
            exit 1
        fi
        echo "hql-linux"
    else
        echo "hql-windows.exe"
    fi
}

# Download binary from GitHub releases with progress
download_binary() {
    local binary_name="$1"
    local download_url="https://github.com/$REPO/releases/latest/download/$binary_name"

    print_step "Downloading HQL binary..."
    print_info "Source: $download_url"
    print_info "Target: $BIN_DIR/hql"
    echo ""

    # Create installation directory
    mkdir -p "$BIN_DIR"

    # Download binary with progress bar
    if command -v curl > /dev/null 2>&1; then
        # Use -# for progress bar instead of silent mode
        echo "${DIM}Download progress:${NC}"
        if ! curl -#fL "$download_url" -o "$BIN_DIR/hql"; then
            print_error "Download failed"
            print_info "Please check your internet connection and try again"
            exit 1
        fi
    elif command -v wget > /dev/null 2>&1; then
        # wget shows progress by default
        if ! wget --show-progress -q "$download_url" -O "$BIN_DIR/hql"; then
            print_error "Download failed"
            print_info "Please check your internet connection and try again"
            exit 1
        fi
    else
        print_error "Neither curl nor wget is installed"
        print_info "Please install curl or wget and try again"
        exit 1
    fi

    echo ""
    print_success "Download complete!"

    # Make binary executable
    chmod +x "$BIN_DIR/hql"
    print_success "Binary made executable"
}

# Detect user's actual shell and add to PATH
setup_path() {
    print_step "Configuring PATH..."

    # Check if already in PATH
    if echo "$PATH" | grep -q "$BIN_DIR"; then
        print_success "$BIN_DIR already in PATH"
        return 0
    fi

    # Detect user's shell from $SHELL environment variable (more reliable)
    local user_shell=$(basename "$SHELL")
    local shell_config=""
    local shell_configs=""

    case "$user_shell" in
        zsh)
            shell_config="$HOME/.zshrc"
            shell_configs=".zshrc"
            ;;
        bash)
            # Check which bash config exists
            if [ -f "$HOME/.bash_profile" ]; then
                shell_config="$HOME/.bash_profile"
                shell_configs=".bash_profile"
            elif [ -f "$HOME/.bashrc" ]; then
                shell_config="$HOME/.bashrc"
                shell_configs=".bashrc"
            else
                shell_config="$HOME/.bash_profile"
                shell_configs=".bash_profile"
            fi
            ;;
        fish)
            shell_config="$HOME/.config/fish/config.fish"
            shell_configs="config.fish"
            ;;
        *)
            # Fallback to .profile for unknown shells
            shell_config="$HOME/.profile"
            shell_configs=".profile"
            ;;
    esac

    print_info "Detected shell: $user_shell"
    print_info "Config file: $shell_configs"

    # Add to shell config
    if [ -n "$shell_config" ]; then
        # Create config file if it doesn't exist
        mkdir -p "$(dirname "$shell_config")"
        touch "$shell_config"

        echo "" >> "$shell_config"
        echo "# HQL Language - Added by installer" >> "$shell_config"
        echo "export PATH=\"\$PATH:$BIN_DIR\"" >> "$shell_config"

        print_success "Added $BIN_DIR to $shell_configs"
    else
        print_warning "Could not detect shell configuration file"
        print_info "Please manually add $BIN_DIR to your PATH"
    fi
}

# Verify installation
verify_installation() {
    print_step "Verifying installation..."

    if [ ! -x "$BIN_DIR/hql" ]; then
        print_error "Binary not found or not executable"
        return 1
    fi

    local file_size=$(du -h "$BIN_DIR/hql" | cut -f1)
    print_success "Binary installed: $file_size"

    # Try to get version (in a new shell with updated PATH)
    local version=$(export PATH="$PATH:$BIN_DIR" && "$BIN_DIR/hql" --version 2>/dev/null || echo "unknown")
    print_success "Version: $version"

    return 0
}

# Main installation
main() {
    # Print banner
    echo ""
    echo "${BOLD}${MAGENTA}╔═══════════════════════════════════════╗${NC}"
    echo "${BOLD}${MAGENTA}║                                       ║${NC}"
    echo "${BOLD}${MAGENTA}║      ${CYAN}HQL Language Installer${MAGENTA}         ║${NC}"
    echo "${BOLD}${MAGENTA}║                                       ║${NC}"
    echo "${BOLD}${MAGENTA}╚═══════════════════════════════════════╝${NC}"
    echo ""

    # Detect platform
    print_step "Detecting platform..."
    local binary_name=$(detect_platform)
    print_success "Platform: $binary_name"
    echo ""

    # Download binary
    download_binary "$binary_name"
    echo ""

    # Setup PATH
    setup_path
    echo ""

    # Verify installation
    if verify_installation; then
        echo ""
        echo "${GREEN}${BOLD}╔═══════════════════════════════════════╗${NC}"
        echo "${GREEN}${BOLD}║   ✓ Installation Successful!          ║${NC}"
        echo "${GREEN}${BOLD}╚═══════════════════════════════════════╝${NC}"
        echo ""
        echo "${BOLD}Quick Start:${NC}"
        echo "  ${CYAN}hql repl${NC}          ${DIM}# Start interactive REPL${NC}"
        echo "  ${CYAN}hql run file.hql${NC}  ${DIM}# Run a HQL file${NC}"
        echo "  ${CYAN}hql --help${NC}        ${DIM}# Show all commands${NC}"
        echo ""
        echo "${BOLD}${YELLOW}⚡ Action Required:${NC}"
        echo "  ${BOLD}Restart your terminal${NC} or run:"
        echo "  ${CYAN}source ~/.zshrc${NC}  ${DIM}# If using zsh${NC}"
        echo "  ${CYAN}source ~/.bashrc${NC} ${DIM}# If using bash${NC}"
        echo ""
        echo "${DIM}Or simply open a new terminal window.${NC}"
        echo ""
        echo "${BOLD}Installed to:${NC} ${GREEN}$BIN_DIR/hql${NC}"
        echo ""
    else
        echo ""
        print_error "Installation verification failed"
        print_info "Please report this issue at: https://github.com/$REPO/issues"
        exit 1
    fi
}

# Run installer
main
