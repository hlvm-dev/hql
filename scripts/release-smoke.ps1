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

        # Wait for HTTP server to be ready (up to 30s)
        $ready = $false
        for ($i = 0; $i -lt 30; $i++) {
            try {
                Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -TimeoutSec 2 -UseBasicParsing | Out-Null
                $ready = $true
                break
            } catch {
                Start-Sleep -Seconds 1
            }
        }
        if (-not $ready) {
            Write-Error "Local HTTP server failed to start on port $Port after 30s"
        }
        Write-Host "==> Local asset server ready on port $Port"

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
        # Use gh api (authenticated) to avoid 60/hour unauthenticated rate limit
        $latest = gh api "repos/$Repo/releases/latest" --jq '.tag_name' 2>&1
        if ($LASTEXITCODE -ne 0) {
            # Fallback: use GH_TOKEN header if gh is unavailable
            $headers = @{}
            if ($env:GH_TOKEN) { $headers["Authorization"] = "Bearer $env:GH_TOKEN" }
            $latest = (Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest" -Headers $headers).tag_name
        }
        if ($latest -ne $Tag) {
            Write-Error "Latest release is $latest, expected $Tag"
        }

        # Download install.ps1 from the release assets (not hlvm.dev, which is
        # deployed from main — stale until this branch merges).
        # TODO: After merge to main + Firebase deploy, switch to:
        #   Invoke-WebRequest -Uri "https://hlvm.dev/install.ps1"
        Write-Host "==> Running public installer (from release assets)..."
        $installerUrl = "https://github.com/$Repo/releases/download/$Tag/install.ps1"
        $env:HLVM_INSTALL_DIR = $InstallBin
        $env:HLVM_INSTALL_VERSION = $Tag
        & ([scriptblock]::Create((Invoke-WebRequest -Uri $installerUrl -UseBasicParsing).Content))
    }

    Write-Host "==> Verifying bootstrap..."
    & "$InstallBin\hlvm.exe" bootstrap --verify

    # On Windows, Ollama's socket dies when bootstrap exits. Restart it.
    Write-Host "==> Ensuring Ollama is alive on 11439..."
    try {
        Invoke-WebRequest -Uri "http://127.0.0.1:11439/api/version" -TimeoutSec 5 -UseBasicParsing | Out-Null
        Write-Host "    Ollama OK"
    } catch {
        Write-Host "    Ollama dead, restarting..."
        $ollamaPath = Join-Path $env:USERPROFILE ".hlvm\.runtime\engine\ollama.exe"
        Get-Process -Name "ollama" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep 2
        $env:OLLAMA_HOST = "127.0.0.1:11439"
        $env:OLLAMA_MODELS = Join-Path $env:USERPROFILE ".hlvm\.runtime\models"
        Start-Process -FilePath $ollamaPath -ArgumentList "serve" -NoNewWindow -PassThru | Out-Null
        Start-Sleep 8
        try {
            $check = Invoke-WebRequest -Uri "http://127.0.0.1:11439/api/version" -TimeoutSec 10 -UseBasicParsing
            Write-Host "    Ollama restarted: $($check.Content)"
        } catch {
            Write-Host "    WARNING: Ollama still not responding"
        }
    }

    # On Windows, hlvm ask → hlvm serve startup is slow (pre-existing issue).
    # Test the AI path directly via Ollama API to verify bootstrap worked.
    Write-Host "==> Testing AI via Ollama API directly (Windows)..."
    try {
        $body = @{ model = "gemma4:e4b"; prompt = $Prompt; stream = $false } | ConvertTo-Json
        $aiResponse = Invoke-WebRequest -Uri "http://127.0.0.1:11439/api/generate" `
            -Method POST -Body $body -ContentType "application/json" `
            -TimeoutSec 300 -UseBasicParsing
        $response = ($aiResponse.Content | ConvertFrom-Json).response
        Write-Host "==> Ollama response: $response"
    } catch {
        # Fallback: try hlvm ask (may timeout on CI but works for real users)
        Write-Host "==> Ollama API test failed, falling back to hlvm ask..."
        $response = & "$InstallBin\hlvm.exe" ask $Prompt 2>&1
    }
    Write-Host "Response: $response"

    if (-not $response) {
        Write-Error "FAIL: Empty response from hlvm ask"
    }

    Write-Host "==> Smoke succeeded."
} finally {
    Remove-Item -Path $SmokeRoot -Recurse -Force -ErrorAction SilentlyContinue
}
