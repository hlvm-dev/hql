# Smoke-test the staged draft or public installer path on Windows.
#
# Usage:
#   pwsh -File scripts/release-smoke.ps1 -Mode staged -Tag v0.1.0
#   pwsh -File scripts/release-smoke.ps1 -Mode public -Tag v0.1.0

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("staged", "public")]
    [string]$Mode,

    [Parameter(Mandatory = $true)]
    [string]$Tag,

    [string]$Repo = $(if ($env:HLVM_SMOKE_REPO) { $env:HLVM_SMOKE_REPO } else { "hlvm-dev/hql" }),
    [string]$InstallerUrl = $(if ($env:HLVM_SMOKE_INSTALLER_URL) { $env:HLVM_SMOKE_INSTALLER_URL } else { "https://hlvm.dev/install.ps1" }),
    [string]$Prompt = $(if ($env:HLVM_SMOKE_PROMPT) { $env:HLVM_SMOKE_PROMPT } else { "hello" })
)

$ErrorActionPreference = "Stop"

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Missing required command: $Name"
    }
}

function Get-FreePort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $port = ($listener.LocalEndpoint).Port
    $listener.Stop()
    return $port
}

function Run-PostChecks([string]$BinaryPath, [string]$HomeDir) {
    & $BinaryPath bootstrap --verify
    if ($LASTEXITCODE -ne 0) {
        throw "bootstrap --verify failed"
    }

    & $BinaryPath ask $Prompt
    if ($LASTEXITCODE -ne 0) {
        throw "hlvm ask failed"
    }
}

$smokeRoot = Join-Path $env:TEMP ("hlvm-release-smoke-" + [guid]::NewGuid().ToString("N"))
$assetDir = Join-Path $smokeRoot "assets"
$homeDir = Join-Path $smokeRoot "home"
$installDir = Join-Path $smokeRoot "bin"
$installerPath = Join-Path $smokeRoot "install.ps1"
$binaryPath = Join-Path $installDir "hlvm.exe"
$serverProcess = $null
$previousHome = $env:HOME
$previousUserProfile = $env:USERPROFILE
$previousHlvmDir = $env:HLVM_DIR

New-Item -ItemType Directory -Path $assetDir, $homeDir, $installDir -Force | Out-Null

try {
    Write-Host "Smoke root: $smokeRoot"
    Invoke-WebRequest -Uri $InstallerUrl -OutFile $installerPath -UseBasicParsing

    if ($Mode -eq "staged") {
        Require-Command "gh"
        Require-Command "python"

        gh release download $Tag --repo $Repo --pattern "hlvm-windows.exe*" --pattern "checksums.sha256" --dir $assetDir

        $port = Get-FreePort
        $stdoutPath = Join-Path $smokeRoot "http.stdout.log"
        $stderrPath = Join-Path $smokeRoot "http.stderr.log"
        $serverProcess = Start-Process python `
            -ArgumentList "-m", "http.server", $port, "--bind", "127.0.0.1", "--directory", $assetDir `
            -PassThru `
            -RedirectStandardOutput $stdoutPath `
            -RedirectStandardError $stderrPath

        Start-Sleep -Seconds 2

        $env:HLVM_INSTALL_REPO = $Repo
        $env:HLVM_INSTALL_VERSION = $Tag
        $env:HLVM_INSTALL_DIR = $installDir
        $env:HLVM_INSTALL_BINARY_BASE_URL = "http://127.0.0.1:$port"
        $env:HLVM_INSTALL_CHECKSUM_URL = "http://127.0.0.1:$port/checksums.sha256"
    } else {
        $latest = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest"
        if ($latest.tag_name -ne $Tag) {
            throw "Expected latest release $Tag but found $($latest.tag_name)"
        }

        $env:HLVM_INSTALL_DIR = $installDir
        Remove-Item Env:HLVM_INSTALL_REPO -ErrorAction SilentlyContinue
        Remove-Item Env:HLVM_INSTALL_VERSION -ErrorAction SilentlyContinue
        Remove-Item Env:HLVM_INSTALL_BINARY_BASE_URL -ErrorAction SilentlyContinue
        Remove-Item Env:HLVM_INSTALL_CHECKSUM_URL -ErrorAction SilentlyContinue
    }

    $env:HOME = $homeDir
    $env:USERPROFILE = $homeDir
    $env:HLVM_DIR = Join-Path $homeDir ".hlvm"

    & $installerPath
    if ($LASTEXITCODE -ne 0) {
        throw "Installer failed"
    }

    Run-PostChecks -BinaryPath $binaryPath -HomeDir $homeDir
    Write-Host "`nWindows smoke succeeded."
} finally {
    if ($serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force
    }

    Remove-Item Env:HLVM_INSTALL_REPO -ErrorAction SilentlyContinue
    Remove-Item Env:HLVM_INSTALL_VERSION -ErrorAction SilentlyContinue
    Remove-Item Env:HLVM_INSTALL_BINARY_BASE_URL -ErrorAction SilentlyContinue
    Remove-Item Env:HLVM_INSTALL_CHECKSUM_URL -ErrorAction SilentlyContinue
    Remove-Item Env:HLVM_INSTALL_DIR -ErrorAction SilentlyContinue
    if ($null -ne $previousHome) {
        $env:HOME = $previousHome
    } else {
        Remove-Item Env:HOME -ErrorAction SilentlyContinue
    }
    if ($null -ne $previousUserProfile) {
        $env:USERPROFILE = $previousUserProfile
    } else {
        Remove-Item Env:USERPROFILE -ErrorAction SilentlyContinue
    }
    if ($null -ne $previousHlvmDir) {
        $env:HLVM_DIR = $previousHlvmDir
    } else {
        Remove-Item Env:HLVM_DIR -ErrorAction SilentlyContinue
    }

    if (Test-Path $smokeRoot) {
        Remove-Item -Recurse -Force $smokeRoot
    }
}
