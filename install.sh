#!/usr/bin/env bash
# CodeWiki cross-platform installer (macOS / Linux)
# Builds the desktop app installer from source and links the CLI.
set -e

echo "==============================================="
echo "  CodeWiki Installer (macOS / Linux)"
echo "==============================================="

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js 18+ is required. Install from https://nodejs.org/ and retry."
  exit 1
fi
echo "Node: $(node -v)"

echo "[1/4] Installing dependencies..."
npm install

echo "[2/4] Building app + CLI..."
npm run build
npm run build:cli

OS="$(uname -s)"
case "$OS" in
  Darwin)
    echo "[3/4] Building macOS installer (.dmg / .zip)..."
    npm run dist:mac
    ;;
  Linux)
    echo "[3/4] Building Linux installer (AppImage / .deb)..."
    npm run dist:linux
    ;;
  *)
    echo "[3/4] Unknown OS '$OS' — building generic package..."
    npm run dist
    ;;
esac

echo "[4/4] Linking CLI (codewiki)..."
npm link 2>/dev/null || echo "  (skip npm link — run 'npx codewiki --help' instead)"

echo ""
echo "Done. Installer artifacts are in ./release"
echo "Run the CLI with:  codewiki --help   (or: npx codewiki --help)"
echo "Run the desktop app in dev mode with:  npm run electron:dev"
