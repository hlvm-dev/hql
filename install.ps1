# HLVM Installer for Windows
#
# Standard install:
#   irm https://hlvm.dev/install.ps1 | iex
#
# Requires PowerShell 5.1+

$ErrorActionPreference = "Stop"

$Repo = if ($env:HLVM_INSTALL_REPO) { $env:HLVM_INSTALL_REPO } else { "hlvm-dev/hlvm" }
$Binary = "hlvm-windows.exe"
$BinaryName = "hlvm.exe"
$PinnedVersion = $env:HLVM_INSTALL_VERSION
$BinaryBaseUrl = $env:HLVM_INSTALL_BINARY_BASE_URL
$ChecksumUrlOverride = $env:HLVM_INSTALL_CHECKSUM_URL
$InstallDir = if ($env:HLVM_INSTALL_DIR) { $env:HLVM_INSTALL_DIR } else { (Join-Path $env:LOCALAPPDATA "HLVM\bin") }

function Write-Info($msg)  { Write-Host "  > $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Err($msg)   { Write-Host "  ✗ $msg" -ForegroundColor Red }

# Get latest version
Write-Host "`nHLVM Installer`n" -ForegroundColor White
Write-Info "Detecting latest version..."

if ($PinnedVersion) {
    $version = $PinnedVersion
} else {
    $release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest"
    $version = $release.tag_name
}

if (-not $version) {
    Write-Err "Could not determine latest version."
    exit 1
}
Write-Info "Version: $version"

# Download
if ($BinaryBaseUrl) {
    $downloadUrl = "$BinaryBaseUrl/$Binary"
    $checksumUrl = if ($ChecksumUrlOverride) { $ChecksumUrlOverride } else { "$BinaryBaseUrl/checksums.sha256" }
} else {
    $downloadUrl = "https://github.com/$Repo/releases/download/$version/$Binary"
    $checksumUrl = if ($ChecksumUrlOverride) {
        $ChecksumUrlOverride
    } else {
        "https://github.com/$Repo/releases/download/$version/checksums.sha256"
    }
}

$tmpDir = Join-Path $env:TEMP "hlvm-install-$(Get-Random)"
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

Write-Info "Downloading $Binary..."
Invoke-WebRequest -Uri $downloadUrl -OutFile "$tmpDir\$Binary" -UseBasicParsing

# Verify checksum
Write-Info "Verifying checksum..."
try {
    Invoke-WebRequest -Uri $checksumUrl -OutFile "$tmpDir\checksums.sha256" -UseBasicParsing
    $expected = (Get-Content "$tmpDir\checksums.sha256" | Select-String $Binary).ToString().Split(" ")[0]
    $actual = (Get-FileHash "$tmpDir\$Binary" -Algorithm SHA256).Hash.ToLower()
    if ($expected -and $actual -ne $expected) {
        Write-Err "Checksum mismatch! Expected: $expected, Got: $actual"
        exit 1
    }
    Write-Ok "Checksum verified."
} catch {
    Write-Info "Checksum verification skipped."
}

# Install
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
Copy-Item "$tmpDir\$Binary" "$InstallDir\$BinaryName" -Force
Write-Ok "Installed to $InstallDir\$BinaryName"

# Add to PATH if not already present
$currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($currentPath -notlike "*$InstallDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$currentPath;$InstallDir", "User")
    $env:Path = "$env:Path;$InstallDir"
    Write-Ok "Added $InstallDir to PATH (restart terminal for effect)."
}

# Bootstrap
Write-Info "Bootstrapping local AI substrate..."

# Cleanup temp dir regardless of bootstrap outcome
Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue

$bootstrapOk = $false
try {
    & "$InstallDir\$BinaryName" bootstrap
    if ($LASTEXITCODE -eq 0) { $bootstrapOk = $true }
} catch {
    # bootstrap command failed
}

if ($bootstrapOk) {
    Write-Host ""
    Write-Ok "HLVM $version is ready!"
    Write-Host ""
    Write-Host "  Get started:"
    Write-Host "    hlvm ask `"hello`""
    Write-Host "    hlvm repl"
    Write-Host "    hlvm --help"
    Write-Host ""
} else {
    Write-Host ""
    Write-Err "HLVM $version installed, but bootstrap failed."
    Write-Err "The local AI fallback is NOT ready."
    Write-Host ""
    Write-Host "  To retry:"
    Write-Host "    hlvm bootstrap"
    Write-Host ""
    Write-Host "  Cloud providers still work:"
    Write-Host "    hlvm ask --model openai/gpt-4o `"hello`""
    Write-Host ""
    exit 1
}
