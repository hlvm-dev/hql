# Smoke-test staged or public installer path on Windows.
# Usage:
#   pwsh -File scripts/release-smoke.ps1 -Mode staged -Tag v0.2.0
#   pwsh -File scripts/release-smoke.ps1 -Mode public -Tag v0.2.0

param(
    [Parameter(Mandatory)][ValidateSet("staged", "public")][string]$Mode,
    [Parameter(Mandatory)][string]$Tag
)

$ErrorActionPreference = "Stop"
$Repo = if ($env:HLVM_SMOKE_REPO) { $env:HLVM_SMOKE_REPO } else { "hlvm-dev/hql" }
$Prompt = if ($env:HLVM_SMOKE_PROMPT) { $env:HLVM_SMOKE_PROMPT } elseif ($env:HLVM_PUBLIC_SMOKE_PROMPT) { $env:HLVM_PUBLIC_SMOKE_PROMPT } else { "hello" }

$SmokeRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("hlvm-smoke-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
$AssetDir = Join-Path $SmokeRoot "assets"
$InstallBin = Join-Path $SmokeRoot "bin"
New-Item -ItemType Directory -Path $AssetDir, $InstallBin -Force | Out-Null

try {
    if ($Mode -eq "staged") {
        Write-Host "==> Downloading draft assets for $Tag..."
        gh release download $Tag --repo $Repo --dir $AssetDir

        # Start local HTTP server to serve assets
        $Port = Get-Random -Minimum 49152 -Maximum 65535
        if (-not (Get-Command python3 -ErrorAction SilentlyContinue)) {
            if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
                Write-Error "python3 or python is required for staged smoke test"
                exit 1
            }
            $PythonCmd = "python"
        } else {
            $PythonCmd = "python3"
        }
        $Server = Start-Process $PythonCmd -ArgumentList "-m", "http.server", $Port, "--directory", $AssetDir -PassThru -NoNewWindow
        Start-Sleep -Seconds 2

        try {
            Write-Host "==> Running installer (staged, local assets on port $Port)..."
            $env:HLVM_INSTALL_REPO = $Repo
            $env:HLVM_INSTALL_VERSION = $Tag
            $env:HLVM_INSTALL_DIR = $InstallBin
            $env:HLVM_INSTALL_BINARY_BASE_URL = "http://127.0.0.1:$Port"
            $env:HLVM_INSTALL_CHECKSUM_URL = "http://127.0.0.1:$Port/checksums.sha256"
            # Use install.ps1 from the release assets (not hlvm.dev which may be stale)
            $installerPath = Join-Path $AssetDir "install.ps1"
            & ([scriptblock]::Create((Get-Content -Raw $installerPath)))
        } finally {
            Stop-Process -Id $Server.Id -Force -ErrorAction SilentlyContinue
        }
    } else {
        Write-Host "==> Validating published release..."
        $latest = (Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest").tag_name
        if ($latest -ne $Tag) {
            Write-Error "Latest release is $latest, expected $Tag"
        }

        Write-Host "==> Running public installer..."
        $env:HLVM_INSTALL_DIR = $InstallBin
        # Use repo install.ps1 (hlvm.dev may be stale until branch merges to main)
        & ([scriptblock]::Create((Get-Content -Raw "$PSScriptRoot\..\install.ps1")))
    }

    Write-Host "==> Verifying bootstrap..."
    & "$InstallBin\hlvm.exe" bootstrap --verify

    # Check if Ollama is running before ask
    Write-Host "==> Diagnostic: checking Ollama on port 11439..."
    try {
        $ollamaCheck = Invoke-WebRequest -Uri "http://127.0.0.1:11439/api/version" -TimeoutSec 5 -UseBasicParsing
        Write-Host "==> Ollama running: $($ollamaCheck.Content)"
    } catch {
        Write-Host "==> Ollama NOT reachable on 11439: $_"
    }

    # Check port 11435 (hlvm serve port)
    Write-Host "==> Diagnostic: checking port 11435..."
    $portCheck = netstat -ano | Select-String ":11435"
    Write-Host "==> Port 11435 status: $portCheck"

    Write-Host "==> Running: hlvm ask `"$Prompt`""
    $env:HLVM_LOG_LEVEL = "debug"
    $response = & "$InstallBin\hlvm.exe" ask $Prompt 2>&1
    Remove-Item Env:\HLVM_LOG_LEVEL -ErrorAction SilentlyContinue
    Write-Host "Response: $response"

    if (-not $response) {
        Write-Error "FAIL: Empty response from hlvm ask"
    }

    Write-Host "==> Smoke succeeded."
} finally {
    Remove-Item -Path $SmokeRoot -Recurse -Force -ErrorAction SilentlyContinue
}
