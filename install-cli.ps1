# CodeWiki CLI - one-click global install (CLI + MCP server only, no desktop app).
# Usage:
#   .\install-cli.ps1
#   irm https://raw.githubusercontent.com/gaosichun888/codewiki/main/install-cli.ps1 | iex
$ErrorActionPreference = "Stop"

Write-Host "==============================================="
Write-Host "  CodeWiki CLI Installer (codewiki + MCP)"
Write-Host "==============================================="

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "ERROR: Node.js 18+ is required. Install from https://nodejs.org/ and retry."
  exit 1
}
Write-Host ("Node: " + (node -v))

# Self-bootstrap: if not inside a CodeWiki checkout, clone first.
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
npm install --no-audit --no-fund

Write-Host "[2/4] Building CLI (codewiki)..."
npm run build:cli

Write-Host "[3/4] Building MCP server..."
npm run build:mcp

Write-Host "[4/4] Linking 'codewiki' into your PATH..."
try {
  npm link
  Write-Host "  Linked via 'npm link'."
} catch {
  Write-Host "  'npm link' failed; trying 'npm i -g .' ..."
  try { npm i -g . } catch {
    Write-Host "  Could not link globally. You can still run it with:"
    Write-Host ("    node " + (Join-Path (Get-Location) 'dist-cli\codewiki-cli.js') + " --help")
    exit 0
  }
}

Write-Host ""
Write-Host "Done. Verify with:"
Write-Host "    codewiki --version"
Write-Host "    codewiki --help"
Write-Host ""
Write-Host "Quick start in any project:"
Write-Host "    cd C:\path\to\your\project"
Write-Host "    codewiki index ."
Write-Host "    codewiki init --ide cursor      # export IDE MCP config"
Write-Host "    codewiki tui                     # interactive console"
