# HLVM Installer for Windows
# Usage: irm https://raw.githubusercontent.com/hlvm-dev/hlvm/main/install.ps1 | iex
#
# WARNING: This installer has NOT been tested on Windows.
# Please report issues at: https://github.com/hlvm-dev/hlvm/issues

$ErrorActionPreference = "Stop"

# Configuration
$Repo = "hlvm-dev/hlvm"
$InstallDir = "$env:USERPROFILE\.hlvm"
$BinDir = "$InstallDir\bin"

function Write-Step {
    param([string]$Message)
    Write-Host "==> " -ForegroundColor Blue -NoNewline
    Write-Host $Message -ForegroundColor White
}

function Write-Success {
    param([string]$Message)
    Write-Host "[OK] " -ForegroundColor Green -NoNewline
    Write-Host $Message
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] " -ForegroundColor Red -NoNewline
    Write-Host $Message
}

function Write-Warning {
    param([string]$Message)
    Write-Host "[WARN] " -ForegroundColor Yellow -NoNewline
    Write-Host $Message
}

function Install-DefaultModel {
    param([string]$HlvmPath)
    Write-Step "Installing default AI model..."
    try {
        & $HlvmPath ai setup
        Write-Success "Default AI model installed"
    }
    catch {
        Write-Error "Default model installation failed: $_"
        Write-Host "Ensure Ollama is available, then rerun: $HlvmPath ai setup" -ForegroundColor Yellow
        exit 1
    }
}

# Main installation
function Install-HLVM {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Magenta
    Write-Host "           HLVM Installer              " -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Magenta
    Write-Host ""
    Write-Warning "This installer has NOT been tested. Please report issues."
    Write-Host ""

    # Create directories
    Write-Step "Creating installation directory..."
    if (-not (Test-Path $BinDir)) {
        New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
    }
    Write-Success "Directory: $BinDir"

    # Download binary
    Write-Step "Downloading HLVM binary..."
    $Url = "https://github.com/$Repo/releases/latest/download/hlvm-windows.exe"
    $OutPath = "$BinDir\hlvm.exe"

    Write-Host "  Source: $Url" -ForegroundColor DarkGray
    Write-Host "  Target: $OutPath" -ForegroundColor DarkGray

    try {
        # Use TLS 1.2
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $Url -OutFile $OutPath -UseBasicParsing
        Write-Success "Download complete"
    }
    catch {
        Write-Error "Download failed: $_"
        Write-Host ""
        Write-Host "Please check your internet connection and try again." -ForegroundColor Yellow
        Write-Host "Or download manually from: https://github.com/$Repo/releases" -ForegroundColor Yellow
        exit 1
    }

    # Add to PATH
    Write-Step "Configuring PATH..."
    $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($UserPath -notlike "*$BinDir*") {
        [Environment]::SetEnvironmentVariable("Path", "$UserPath;$BinDir", "User")
        Write-Success "Added $BinDir to PATH"
    }
    else {
        Write-Success "$BinDir already in PATH"
    }

    # Verify installation
    Write-Step "Verifying installation..."
    if (Test-Path $OutPath) {
        $Size = (Get-Item $OutPath).Length / 1MB
        Write-Success ("Binary installed: {0:N1} MB" -f $Size)

        # Test execution
        try {
            $Version = & $OutPath --version 2>&1
            Write-Success "Version: $Version"
        }
        catch {
            Write-Success "Binary installed (version check skipped)"
        }
    }
    else {
        Write-Error "Binary not found at $OutPath"
        exit 1
    }

    # Install default AI model
    Install-DefaultModel -HlvmPath $OutPath

    # Success message
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "   Installation Successful!            " -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Quick Start:" -ForegroundColor White
    Write-Host "  hlvm repl        " -ForegroundColor Cyan -NoNewline
    Write-Host "# Start interactive REPL" -ForegroundColor DarkGray
    Write-Host "  hlvm run file.hql" -ForegroundColor Cyan -NoNewline
    Write-Host "# Run a HQL file" -ForegroundColor DarkGray
    Write-Host "  hlvm --help      " -ForegroundColor Cyan -NoNewline
    Write-Host "# Show all commands" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "IMPORTANT: Restart your terminal for PATH changes to take effect." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To upgrade later, run this installer again." -ForegroundColor DarkGray
    Write-Host "To uninstall: Remove-Item -Recurse $InstallDir" -ForegroundColor DarkGray
    Write-Host ""
}

# Run installer
Install-HLVM
