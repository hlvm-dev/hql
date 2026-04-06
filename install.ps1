# HLVM Installer for Windows
#
# Standard install:
#   irm https://hlvm.dev/install.ps1 | iex
#
# Requires PowerShell 5.1+

$ErrorActionPreference = "Stop"

$Repo = if ($env:HLVM_INSTALL_REPO) { $env:HLVM_INSTALL_REPO } else { "hlvm-dev/hql" }
$Package = "hlvm-windows.zip"
$BinaryName = "hlvm.exe"
$PinnedVersion = $env:HLVM_INSTALL_VERSION
$BinaryBaseUrl = $env:HLVM_INSTALL_BINARY_BASE_URL
$ChecksumUrlOverride = $env:HLVM_INSTALL_CHECKSUM_URL
$InstallDir = if ($env:HLVM_INSTALL_DIR) { $env:HLVM_INSTALL_DIR } else { (Join-Path $env:LOCALAPPDATA "HLVM\bin") }

function Write-Info($msg)  { Write-Host "  > $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Err($msg)   { Write-Host "  ✗ $msg" -ForegroundColor Red }

function Download-ReleaseAsset {
    param(
        [string]$BaseUrl,
        [string]$AssetName,
        [string]$OutputPath
    )

    $directUrl = "$BaseUrl/$AssetName"
    try {
        Invoke-WebRequest -Uri $directUrl -OutFile $OutputPath -UseBasicParsing
        return
    } catch {
        Remove-Item $OutputPath -Force -ErrorAction SilentlyContinue
    }

    Write-Info "Direct asset unavailable; trying split download..."

    $partFiles = @()
    $partIndex = 0
    while ($true) {
        $partName = "{0}.part-{1:D3}" -f $AssetName, $partIndex
        $partPath = Join-Path (Split-Path -Parent $OutputPath) $partName
        try {
            Invoke-WebRequest -Uri "$BaseUrl/$partName" -OutFile $partPath -UseBasicParsing
            $partFiles += $partPath
            $partIndex++
        } catch {
            Remove-Item $partPath -Force -ErrorAction SilentlyContinue
            break
        }
    }

    if ($partFiles.Count -eq 0) {
        throw "Could not download $AssetName from $BaseUrl"
    }

    $outputStream = [System.IO.File]::Open($OutputPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
        foreach ($partPath in ($partFiles | Sort-Object)) {
            $inputStream = [System.IO.File]::OpenRead($partPath)
            try {
                $inputStream.CopyTo($outputStream)
            } finally {
                $inputStream.Dispose()
            }
        }
    } finally {
        $outputStream.Dispose()
    }

    foreach ($partPath in $partFiles) {
        Remove-Item $partPath -Force -ErrorAction SilentlyContinue
    }

    Write-Info "Reassembled $AssetName from $($partFiles.Count) release part(s)."
}

function Get-HlvmDir {
    if ($env:HLVM_DIR) {
        return $env:HLVM_DIR
    }
    if ($env:HOME) {
        return Join-Path $env:HOME ".hlvm"
    }
    return Join-Path $env:USERPROFILE ".hlvm"
}

function Stage-EmbeddedAiEngine {
    param(
        [string]$ExtractedRoot
    )

    $sourceEngineDir = Join-Path $ExtractedRoot "ai-engine"
    if (-not (Test-Path $sourceEngineDir)) {
        throw "Windows package is missing ai-engine payload."
    }

    $runtimeDir = Join-Path (Get-HlvmDir) ".runtime"
    $targetEngineDir = Join-Path $runtimeDir "engine"
    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
    if (Test-Path $targetEngineDir) {
        Remove-Item -Recurse -Force $targetEngineDir
    }
    New-Item -ItemType Directory -Path $targetEngineDir -Force | Out-Null
    Copy-Item (Join-Path $sourceEngineDir "*") $targetEngineDir -Recurse -Force
    Write-Ok "Staged embedded AI engine at $targetEngineDir"
}

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
    $downloadBaseUrl = $BinaryBaseUrl
    $checksumUrl = if ($ChecksumUrlOverride) { $ChecksumUrlOverride } else { "$BinaryBaseUrl/checksums.sha256" }
} else {
    $downloadBaseUrl = "https://github.com/$Repo/releases/download/$version"
    $checksumUrl = if ($ChecksumUrlOverride) {
        $ChecksumUrlOverride
    } else {
        "https://github.com/$Repo/releases/download/$version/checksums.sha256"
    }
}

$tmpDir = Join-Path $env:TEMP "hlvm-install-$(Get-Random)"
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

Write-Info "Downloading $Package..."
Download-ReleaseAsset -BaseUrl $downloadBaseUrl -AssetName $Package -OutputPath "$tmpDir\$Package"

# Verify checksum
Write-Info "Verifying checksum..."
try {
    Invoke-WebRequest -Uri $checksumUrl -OutFile "$tmpDir\checksums.sha256" -UseBasicParsing
    $expected = (Get-Content "$tmpDir\checksums.sha256" | Select-String $Package).ToString().Split(" ")[0]
    $actual = (Get-FileHash "$tmpDir\$Package" -Algorithm SHA256).Hash.ToLower()
    if ($expected -and $actual -ne $expected) {
        Write-Err "Checksum mismatch! Expected: $expected, Got: $actual"
        exit 1
    }
    Write-Ok "Checksum verified."
} catch {
    Write-Info "Checksum verification skipped."
}

# Install
$extractDir = Join-Path $tmpDir "package"
Expand-Archive -Path "$tmpDir\$Package" -DestinationPath $extractDir -Force

$packagedBinary = Join-Path $extractDir $BinaryName
if (-not (Test-Path $packagedBinary)) {
    Write-Err "Windows package did not contain $BinaryName."
    exit 1
}

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
Copy-Item $packagedBinary "$InstallDir\$BinaryName" -Force
Write-Ok "Installed to $InstallDir\$BinaryName"
Stage-EmbeddedAiEngine -ExtractedRoot $extractDir

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

$bootstrapError = $null
try {
    & "$InstallDir\$BinaryName" bootstrap
} catch {
    $bootstrapError = $_
}
$bootstrapOk = ($null -eq $bootstrapError) -and ($LASTEXITCODE -eq 0)

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
    if ($bootstrapError) {
        Write-Err ("Bootstrap error: " + $bootstrapError.Exception.Message)
    }
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
