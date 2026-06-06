#!/usr/bin/env bash
# CodeWiki CLI — one-click global install (CLI + MCP server only, no desktop app).
# Usage:
#   ./install-cli.sh
#   curl -fsSL https://raw.githubusercontent.com/gaosichun888/codewiki/main/install-cli.sh | bash
set -e

echo "==============================================="
echo "  CodeWiki CLI Installer (codewiki + MCP)"
echo "==============================================="

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js 18+ is required. Install from https://nodejs.org/ and retry."
  exit 1
fi
echo "Node: $(node -v)"

# Self-bootstrap: if not inside a CodeWiki checkout, clone first.
REPO_URL="${CODEWIKI_REPO:-https://github.com/gaosichun888/codewiki.git}"
if [ ! -f "package.json" ] || ! grep -q '"name": *"codewiki"' package.json 2>/dev/null; then
  echo "[0/4] Not inside a CodeWiki checkout — cloning $REPO_URL ..."
  if ! command -v git >/dev/null 2>&1; then
    echo "ERROR: git is required to clone. Install git and retry."
    exit 1
  fi
  git clone --depth 1 "$REPO_URL" codewiki
  cd codewiki
fi

echo "[1/4] Installing dependencies..."
npm install --no-audit --no-fund

echo "[2/4] Building CLI (codewiki)..."
npm run build:cli

echo "[3/4] Building MCP server..."
npm run build:mcp

echo "[4/4] Linking 'codewiki' into your PATH..."
if npm link 2>/dev/null; then
  echo "  Linked via 'npm link'."
else
  echo "  'npm link' needs permissions; trying 'npm i -g .' ..."
  npm i -g . 2>/dev/null || {
    echo "  Could not link globally (permissions). You can still run it with:"
    echo "    node \"$(pwd)/dist-cli/codewiki-cli.js\" --help"
    exit 0
  }
fi

echo ""
echo "Done. Verify with:"
echo "    codewiki --version"
echo "    codewiki --help"
echo ""
echo "Quick start in any project:"
echo "    cd /path/to/your/project"
echo "    codewiki index ."
echo "    codewiki init --ide cursor      # export IDE MCP config"
echo "    codewiki tui                     # interactive console"
