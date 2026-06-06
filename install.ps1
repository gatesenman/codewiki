# ──────────────────────────────────────────────────────────────
# CodeWiki One-Click Installer (Windows)
# Installs: Desktop App · CLI · MCP Server · VSCode Extension
#
# Usage:
#   irm https://raw.githubusercontent.com/gaosichun888/codewiki/main/install.ps1 | iex
#   # or:
#   .\install.ps1 [-NoDesktop] [-NoCli] [-NoMcp] [-NoVscode] [-Prefix DIR]
# ──────────────────────────────────────────────────────────────
param(
    [switch]$NoDesktop,
    [switch]$NoCli,
    [switch]$NoMcp,
    [switch]$NoVscode,
    [string]$Prefix = "$env:USERPROFILE\.codewiki",
    [string]$Branch = "main",
    [switch]$Help
)

$ErrorActionPreference = "Stop"
$RepoUrl = "https://github.com/gaosichun888/codewiki.git"
$NodeMin = 18

# ── Colors ────────────────────────────────────────────────────
function Info($msg)  { Write-Host "[info]  $msg" -ForegroundColor Cyan }
function Ok($msg)    { Write-Host "[ok]    $msg" -ForegroundColor Green }
function Warn($msg)  { Write-Host "[warn]  $msg" -ForegroundColor Yellow }
function Fail($msg)  { Write-Host "[error] $msg" -ForegroundColor Red; exit 1 }

if ($Help) {
    Write-Host @"
Usage: install.ps1 [OPTIONS]

Options:
  -NoDesktop    Skip Electron desktop app build
  -NoCli        Skip CLI installation
  -NoMcp        Skip MCP Server build
  -NoVscode     Skip VSCode extension installation
  -Prefix DIR   Install to DIR (default: ~\.codewiki)
  -Branch NAME  Git branch to clone (default: main)
  -Help         Show this help
"@
    exit 0
}

# ── Prerequisite checks ──────────────────────────────────────
function Check-Cmd($name) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        Fail "$name is required but not found. Please install it first."
    }
}

Check-Cmd "git"
Check-Cmd "node"
Check-Cmd "npm"

$nodeVer = (node -v) -replace '^v','' -split '\.' | Select-Object -First 1
if ([int]$nodeVer -lt $NodeMin) {
    Fail "Node.js >= $NodeMin required (found $(node -v)). Please upgrade."
}

Ok "Prerequisites: git, node $(node -v), npm $(npm -v)"

# ── Clone or update repo ─────────────────────────────────────
$SrcDir = Join-Path $Prefix "source"

if (Test-Path (Join-Path $SrcDir ".git")) {
    Info "Updating existing source at $SrcDir ..."
    Push-Location $SrcDir
    git fetch origin $Branch --depth=1
    git checkout $Branch -- .
    git reset --hard "origin/$Branch"
} else {
    Info "Cloning codewiki to $SrcDir ..."
    New-Item -ItemType Directory -Force -Path $Prefix | Out-Null
    git clone --depth=1 --branch $Branch $RepoUrl $SrcDir
    Push-Location $SrcDir
}

Ok "Source ready at $SrcDir"

# ── Install dependencies ─────────────────────────────────────
Info "Installing npm dependencies ..."
npm install --prefer-offline 2>&1 | Select-Object -Last 1
Ok "Dependencies installed"

# ── Build CLI ─────────────────────────────────────────────────
if (-not $NoCli) {
    Info "Building CLI ..."
    npm run build:cli

    $BinDir = Join-Path $Prefix "bin"
    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

    # Create .cmd wrapper
    $wrapper = "@echo off`r`nnode `"$SrcDir\dist-cli\codewiki-cli.js`" %*"
    Set-Content -Path (Join-Path $BinDir "codewiki.cmd") -Value $wrapper -Encoding ASCII
    Ok "CLI installed -> $BinDir\codewiki.cmd"
}

# ── Build MCP Server ─────────────────────────────────────────
if (-not $NoMcp) {
    Info "Building MCP Server ..."
    npm run build:mcp

    $BinDir = Join-Path $Prefix "bin"
    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

    $wrapper = "@echo off`r`nnode `"$SrcDir\dist\server\mcp-server.js`" %*"
    Set-Content -Path (Join-Path $BinDir "codewiki-mcp.cmd") -Value $wrapper -Encoding ASCII

    # Generate MCP client config
    $ConfigDir = Join-Path $Prefix "config"
    New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
    $mcpConfig = @"
{
  "mcpServers": {
    "codewiki": {
      "command": "node",
      "args": ["$($SrcDir -replace '\\','/')"/dist/server/mcp-server.js"],
      "env": {}
    }
  }
}
"@
    Set-Content -Path (Join-Path $ConfigDir "mcp-client-config.json") -Value $mcpConfig -Encoding UTF8
    Ok "MCP Server installed -> $BinDir\codewiki-mcp.cmd"
    Ok "MCP client config -> $ConfigDir\mcp-client-config.json"
}

# ── Build Desktop App ────────────────────────────────────────
$ReleaseDir = Join-Path $SrcDir "release"
if (-not $NoDesktop) {
    Info "Building desktop app (Electron) ..."
    npm run build 2>&1 | Select-Object -Last 3

    Info "Packaging desktop app for Windows ..."
    try {
        npx --yes electron-builder --win --config 2>&1 | Select-Object -Last 5

        if (Test-Path $ReleaseDir) {
            Ok "Desktop app packaged -> $ReleaseDir\"
            Info "Installers found:"
            Get-ChildItem $ReleaseDir -File | Where-Object { $_.Extension -in '.exe','.msi' } | ForEach-Object { Write-Host "  $_" }
        }
    } catch {
        Warn "electron-builder failed. Run 'npm run dist:win' manually in $SrcDir"
    }
}

# ── Build & Install VSCode Extension ─────────────────────────
if (-not $NoVscode) {
    Info "Building VSCode extension ..."
    $VscodeDir = Join-Path $SrcDir "vscode-extension"
    Push-Location $VscodeDir
    npm install 2>&1 | Select-Object -Last 1

    try {
        npx --yes @vscode/vsce package --no-dependencies 2>&1 | Select-Object -Last 1
        $vsix = Get-ChildItem $VscodeDir -Filter "*.vsix" | Sort-Object Name | Select-Object -Last 1

        if ($vsix) {
            Copy-Item $vsix.FullName -Destination $Prefix
            Ok "VSCode extension packaged -> $Prefix\$($vsix.Name)"

            if (Get-Command "code" -ErrorAction SilentlyContinue) {
                Info "Installing VSCode extension ..."
                code --install-extension $vsix.FullName --force
                Ok "VSCode extension installed"
            } else {
                Warn "'code' CLI not found. Install manually:"
                Write-Host "  code --install-extension $Prefix\$($vsix.Name)"
            }
        }
    } catch {
        Warn "vsce not available, compiling only."
        npm run compile
        Ok "VSCode extension compiled (not packaged)."
    }

    Pop-Location
}

# ── PATH setup ────────────────────────────────────────────────
$BinDir = Join-Path $Prefix "bin"
if (Test-Path $BinDir) {
    $userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
    if ($userPath -notlike "*$BinDir*") {
        Info "Adding $BinDir to user PATH ..."
        [Environment]::SetEnvironmentVariable("PATH", "$BinDir;$userPath", "User")
        $env:PATH = "$BinDir;$env:PATH"
        Ok "PATH updated (restart terminal to apply)"
    }
}

Pop-Location

# ── Summary ───────────────────────────────────────────────────
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor White
Write-Host "  CodeWiki installation complete!" -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor White
Write-Host ""
Write-Host "  Install prefix:  $Prefix"
Write-Host "  Source code:     $SrcDir"
if (-not $NoCli)     { Write-Host "  CLI:             $BinDir\codewiki.cmd" }
if (-not $NoMcp)     { Write-Host "  MCP Server:      $BinDir\codewiki-mcp.cmd" }
if (-not $NoMcp)     { Write-Host "  MCP Config:      $Prefix\config\mcp-client-config.json" }
if (-not $NoDesktop) { Write-Host "  Desktop App:     $ReleaseDir\" }
if (-not $NoVscode)  { Write-Host "  VSCode ext:      $Prefix\*.vsix" }
Write-Host ""
Write-Host "  Quick start:"
if (-not $NoCli) {
    Write-Host "    codewiki index C:\path\to\project    # Index a project"
    Write-Host "    codewiki search 'query'              # Semantic search"
}
if (-not $NoDesktop) { Write-Host "    npm run electron:dev                 # Launch desktop app (dev)" }
Write-Host ""
Write-Host "  Documentation: https://github.com/gaosichun888/codewiki" -ForegroundColor Cyan
Write-Host ""
