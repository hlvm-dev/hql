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

    # ── Windows hlvm serve debug session ──────────────────────────────
    Write-Host ""
    Write-Host "=== WINDOWS DEBUG: hlvm serve startup ==="
    Write-Host ""

    # 1. Verify Ollama is alive
    Write-Host "==> Step 1: Check Ollama on 11439"
    try {
        $ov = Invoke-WebRequest -Uri "http://127.0.0.1:11439/api/version" -TimeoutSec 5 -UseBasicParsing
        Write-Host "    Ollama OK: $($ov.Content)"
    } catch {
        Write-Host "    Ollama DEAD. Restarting..."
        $ollamaPath = Join-Path $env:USERPROFILE ".hlvm\.runtime\engine\ollama.exe"
        Get-Process -Name "ollama" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep 2
        $env:OLLAMA_HOST = "127.0.0.1:11439"
        $env:OLLAMA_MODELS = Join-Path $env:USERPROFILE ".hlvm\.runtime\models"
        Start-Process -FilePath $ollamaPath -ArgumentList "serve" -NoNewWindow -PassThru | Out-Null
        Start-Sleep 5
    }

    # 2. Start hlvm serve in foreground, capture output
    Write-Host "==> Step 2: Start hlvm serve (foreground, 15s capture)"
    $serveErr = Join-Path $SmokeRoot "serve-stderr.log"
    $serveOut = Join-Path $SmokeRoot "serve-stdout.log"
    $serveProc = Start-Process -FilePath "$InstallBin\hlvm.exe" -ArgumentList "serve" `
        -RedirectStandardError $serveErr -RedirectStandardOutput $serveOut `
        -PassThru -NoNewWindow
    Start-Sleep -Seconds 15
    Write-Host "    Serve PID: $($serveProc.Id), HasExited: $($serveProc.HasExited)"
    if ($serveProc.HasExited) {
        Write-Host "    Serve EXIT CODE: $($serveProc.ExitCode)"
    }
    Write-Host "    --- serve stderr (first 20 lines) ---"
    if (Test-Path $serveErr) { Get-Content $serveErr -ErrorAction SilentlyContinue | Select-Object -First 20 | ForEach-Object { Write-Host "    $_" } }
    Write-Host "    --- serve stdout (first 20 lines) ---"
    if (Test-Path $serveOut) { Get-Content $serveOut -ErrorAction SilentlyContinue | Select-Object -First 20 | ForEach-Object { Write-Host "    $_" } }

    # 3. Check what ports are open
    Write-Host "==> Step 3: Check ports 11435 and 11439"
    netstat -ano | Select-String "11435|11439" | ForEach-Object { Write-Host "    $_" }

    # 4. Try to hit serve health endpoint directly
    Write-Host "==> Step 4: Curl serve health endpoint"
    try {
        $health = Invoke-WebRequest -Uri "http://127.0.0.1:11435/health" -TimeoutSec 5 -UseBasicParsing
        Write-Host "    Health OK: $($health.Content)"
    } catch {
        Write-Host "    Health FAILED: $_"
    }

    # 5. Check Windows firewall
    Write-Host "==> Step 5: Windows firewall check"
    $fw = netsh advfirewall firewall show rule name=all dir=in 2>&1 | Select-String "11435|11439|hlvm|ollama" | Select-Object -First 5
    if ($fw) { $fw | ForEach-Object { Write-Host "    $_" } } else { Write-Host "    No firewall rules found for our ports" }

    # 6. Kill diagnostic serve before real test
    Stop-Process -Id $serveProc.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep 2

    Write-Host ""
    Write-Host "=== END WINDOWS DEBUG ==="
    Write-Host ""

    # Now run the actual test
    Write-Host "==> Running: hlvm ask `"$Prompt`""
    $response = & "$InstallBin\hlvm.exe" ask $Prompt 2>&1
    Write-Host "Response: $response"

    if (-not $response) {
        Write-Error "FAIL: Empty response from hlvm ask"
    }

    Write-Host "==> Smoke succeeded."
} finally {
    Remove-Item -Path $SmokeRoot -Recurse -Force -ErrorAction SilentlyContinue
}
