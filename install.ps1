# HLVM Installer for Windows
# Usage: irm https://hlvm.dev/install.ps1 | iex

$ErrorActionPreference = "Stop"

$Repo = if ($env:HLVM_INSTALL_REPO) { $env:HLVM_INSTALL_REPO } else { "hlvm-dev/hql" }
$LocalAppData = $env:LOCALAPPDATA
if (-not $LocalAppData) { $LocalAppData = [System.IO.Path]::Combine($env:USERPROFILE, "AppData", "Local") }
$InstallDir = if ($env:HLVM_INSTALL_DIR) { $env:HLVM_INSTALL_DIR } else { "$LocalAppData\HLVM\bin" }
$BinaryBaseUrl = $env:HLVM_INSTALL_BINARY_BASE_URL
$ChecksumUrl = $env:HLVM_INSTALL_CHECKSUM_URL
$PinnedVersion = $env:HLVM_INSTALL_VERSION

$Binary = "hlvm-windows.exe"

function Write-Info($msg) { Write-Host "  > $msg" }
function Write-Ok($msg) { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Err($msg) { Write-Host "  ✗ $msg" -ForegroundColor Red }

# Resolve version
if ($PinnedVersion) {
    $Version = $PinnedVersion
} else {
    $release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest"
    $Version = $release.tag_name
}

Write-Host ""
Write-Host "HLVM Installer" -NoNewline
Write-Host ""
Write-Host ""
Write-Info "Platform: windows/x86_64 → $Binary"
Write-Info "Version: $Version"

# Create temp directory
$TmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("hlvm-install-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Path $TmpDir -Force | Out-Null

try {
    # Download binary
    if ($BinaryBaseUrl) {
        $url = "$BinaryBaseUrl/$Binary"
    } else {
        $url = "https://github.com/$Repo/releases/download/$Version/$Binary"
    }
    Write-Info "Downloading $Binary..."
    Invoke-WebRequest -Uri $url -OutFile "$TmpDir\$Binary" -UseBasicParsing

    # Verify checksum
    if ($ChecksumUrl) {
        $csUrl = $ChecksumUrl
    } else {
        $csUrl = "https://github.com/$Repo/releases/download/$Version/checksums.sha256"
    }
    try {
        Invoke-WebRequest -Uri $csUrl -OutFile "$TmpDir\checksums.sha256" -UseBasicParsing
        $expected = (Get-Content "$TmpDir\checksums.sha256" | Where-Object { $_ -match $Binary }) -replace '\s+.*', ''
        if ($expected) {
            $actual = (Get-FileHash "$TmpDir\$Binary" -Algorithm SHA256).Hash.ToLower()
            if ($actual -ne $expected) {
                Write-Err "Checksum mismatch!"
                Write-Err "  Expected: $expected"
                Write-Err "  Actual:   $actual"
                exit 1
            }
            Write-Ok "Checksum verified."
        }
    } catch {
        Write-Info "Checksum not available — skipping verification"
    }

    # Install
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Move-Item -Path "$TmpDir\$Binary" -Destination "$InstallDir\hlvm.exe" -Force
    Write-Ok "Installed to $InstallDir\hlvm.exe"

    # Add to PATH if not already there
    $userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
    $pathEntries = $userPath -split ';' | ForEach-Object { $_.Trim() }
    if ($pathEntries -notcontains $InstallDir) {
        [Environment]::SetEnvironmentVariable("PATH", "$InstallDir;$userPath", "User")
        $env:PATH = "$InstallDir;$env:PATH"
        Write-Info "Added $InstallDir to PATH"
    }

    # Bootstrap
    Write-Host ""
    Write-Info "Bootstrapping local AI runtime..."
    & "$InstallDir\hlvm.exe" bootstrap
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Ok "HLVM $Version is ready!"
        Write-Host ""
        Write-Host "  Get started:"
        Write-Host "    hlvm ask `"hello`""
        Write-Host "    hlvm repl"
        Write-Host "    hlvm --help"
        Write-Host ""
    } else {
        Write-Host ""
        Write-Err "HLVM $Version installed, but bootstrap failed."
        Write-Host "  You can retry with: hlvm bootstrap"
        Write-Host "  Or use a cloud model: hlvm ask --model openai/gpt-4o `"hello`""
        exit 1
    }
} finally {
    Remove-Item -Path $TmpDir -Recurse -Force -ErrorAction SilentlyContinue
}
