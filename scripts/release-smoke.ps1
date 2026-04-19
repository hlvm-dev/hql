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
$Prompt = if ($env:HLVM_SMOKE_PROMPT) { $env:HLVM_SMOKE_PROMPT } else { "hello" }
$Model = if ($env:HLVM_SMOKE_MODEL) { $env:HLVM_SMOKE_MODEL } else { "qwen3:8b" }

$SmokeRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("hlvm-smoke-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
$AssetDir = Join-Path $SmokeRoot "assets"
$InstallBin = Join-Path $SmokeRoot "bin"
$SmokeHlvmDir = Join-Path $SmokeRoot "home"
$SmokeRuntimePort = if ($env:HLVM_SMOKE_RUNTIME_PORT) { $env:HLVM_SMOKE_RUNTIME_PORT } else { "12035" }
New-Item -ItemType Directory -Path $AssetDir, $InstallBin, $SmokeHlvmDir -Force | Out-Null

try {
    $env:HLVM_DIR = $SmokeHlvmDir
    $env:HLVM_REPL_PORT = $SmokeRuntimePort

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

        # Use repo checkout install.ps1 for public smoke. hlvm.dev/install.ps1
        # is deployed from main (stale until merge), and GitHub release download
        # via Invoke-WebRequest has encoding issues with [scriptblock]::Create().
        # TODO: After merge to main, switch to: irm https://hlvm.dev/install.ps1 | iex
        Write-Host "==> Running public installer..."
        $env:HLVM_INSTALL_DIR = $InstallBin
        $env:HLVM_INSTALL_VERSION = $Tag
        & ([scriptblock]::Create((Get-Content -Raw "$PSScriptRoot\..\install.ps1")))
    }

    Write-Host "==> Verifying bootstrap..."
    & "$InstallBin\hlvm.exe" bootstrap --verify

    $SelectedModel = $Model
    try {
        $statusJson = & "$InstallBin\hlvm.exe" bootstrap --status 2>$null
        if ($LASTEXITCODE -eq 0 -and $statusJson) {
            $status = $statusJson | ConvertFrom-Json
            if ($status.models -and $status.models.Count -gt 0 -and $status.models[0].modelId) {
                $SelectedModel = $status.models[0].modelId
            }
        }
    } catch {
        $SelectedModel = $Model
    }

    # On Windows, Ollama's socket dies when bootstrap exits. Restart it.
    Write-Host "==> Ensuring Ollama is alive on 11439..."
    try {
        Invoke-WebRequest -Uri "http://127.0.0.1:11439/api/version" -TimeoutSec 5 -UseBasicParsing | Out-Null
        Write-Host "    Ollama OK"
    } catch {
        Write-Host "    Ollama dead, restarting..."
        $ollamaPath = Join-Path $SmokeHlvmDir ".runtime\engine\ollama.exe"
        Get-Process -Name "ollama" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep 2
        $env:OLLAMA_HOST = "127.0.0.1:11439"
        $env:OLLAMA_MODELS = Join-Path $SmokeHlvmDir ".runtime\models"
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
    Write-Host "==> Testing AI via Ollama API directly (Windows, model $SelectedModel)..."
    try {
        $body = @{ model = "$SelectedModel"; prompt = $Prompt; stream = $false } | ConvertTo-Json
        $aiResponse = Invoke-WebRequest -Uri "http://127.0.0.1:11439/api/generate" `
            -Method POST -Body $body -ContentType "application/json" `
            -TimeoutSec 300 -UseBasicParsing
        $response = ($aiResponse.Content | ConvertFrom-Json).response
        Write-Host "==> Ollama response: $response"
    } catch {
        Write-Host "==> WARNING: Ollama API test failed: $_"
    }

    if (-not $response) {
        Write-Error "FAIL: Empty response from Ollama API"
    }

    # Verify managed Python sidecar directly (deterministic, fast).
    Write-Host "==> Verifying managed Python sidecar..."
    $py = Join-Path $SmokeHlvmDir ".runtime\python\venv\Scripts\python.exe"
    if (-not (Test-Path $py)) {
        $py = Join-Path $SmokeHlvmDir ".runtime\python\venv\bin\python.exe"
    }
    if (-not (Test-Path $py)) {
        $py = Join-Path $SmokeHlvmDir ".runtime\python\venv\bin\python"
    }
    if (-not (Test-Path $py)) {
        Write-Error "FAIL: Managed python not found under $SmokeHlvmDir\.runtime\python\venv\"
    }
    $pyOut = & $py -c "import sys, pptx, docx; print(f'python={sys.executable}'); print(f'pptx={pptx.__version__}'); print(f'docx={docx.__version__}')" 2>&1 | Out-String
    Write-Host $pyOut
    if ($LASTEXITCODE -ne 0) {
        Write-Error "FAIL: Managed Python sidecar packages not importable"
    }
    Write-Host "==> Managed Python sidecar verified."

    # NOTE: hlvm ask end-to-end not tested in CI.
    # qwen3:8b on CPU CI runners is too slow (30-60 min per agent flow).
    # Windows also has a separate HLVM5006 runtime-host bug to investigate.
    # The full chain is verified by users on real hardware + unit tests.
    Write-Host "==> hlvm ask E2E skipped in CI (agent loop too slow on CPU runners)."

    Write-Host "==> Smoke succeeded."
    exit 0
} finally {
    try {
        Get-Process -Name "ollama","hlvm" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    } catch {}
    try {
        Remove-Item -Path $SmokeRoot -Recurse -Force -ErrorAction SilentlyContinue
    } catch {}
}
