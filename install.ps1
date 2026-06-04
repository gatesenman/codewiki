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
