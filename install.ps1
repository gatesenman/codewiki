# CodeWiki cross-platform installer (Windows / PowerShell)
# Builds the desktop app installer from source and links the CLI.
$ErrorActionPreference = "Stop"

Write-Host "==============================================="
Write-Host "  CodeWiki Installer (Windows)"
Write-Host "==============================================="

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "ERROR: Node.js 18+ is required. Install from https://nodejs.org/ and retry."
  exit 1
}
Write-Host ("Node: " + (node -v))

# Self-bootstrap: when piped directly (irm ... | iex) outside a checkout, clone first.
$RepoUrl = if ($env:CODEWIKI_REPO) { $env:CODEWIKI_REPO } else { "https://github.com/gaosichun888/codewiki.git" }
$inCheckout = (Test-Path "package.json") -and (Select-String -Path "package.json" -Pattern '"name"\s*:\s*"codewiki"' -Quiet)
if (-not $inCheckout) {
  Write-Host "[0/4] Not inside a CodeWiki checkout - cloning $RepoUrl ..."
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: git is required to clone. Install git and retry."
    exit 1
  }
  git clone --depth 1 $RepoUrl codewiki
  Set-Location codewiki
}

Write-Host "[1/4] Installing dependencies..."
npm install

Write-Host "[2/4] Building app + CLI..."
npm run build
npm run build:cli

Write-Host "[3/4] Building Windows installer (NSIS Setup + portable)..."
npm run dist:win

Write-Host "[4/4] Linking CLI (codewiki)..."
try { npm link } catch { Write-Host "  (skip npm link - run 'npx codewiki --help' instead)" }

Write-Host ""
Write-Host "Done. Installer artifacts are in .\release"
Write-Host "  - 'CodeWiki Setup 1.0.0.exe'  (installer)"
Write-Host "  - 'CodeWiki 1.0.0.exe'        (portable, no install)"
Write-Host "Run the CLI with:  codewiki --help   (or: npx codewiki --help)"
Write-Host "Run the desktop app in dev mode with:  npm run electron:dev"
