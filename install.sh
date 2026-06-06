#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# CodeWiki One-Click Installer
# Installs: Desktop App · CLI · MCP Server · VSCode Extension
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/gaosichun888/codewiki/main/install.sh | bash
#   # or clone first, then:
#   ./install.sh [--no-desktop] [--no-cli] [--no-mcp] [--no-vscode] [--prefix DIR]
# ──────────────────────────────────────────────────────────────
set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────
INSTALL_DESKTOP=true
INSTALL_CLI=true
INSTALL_MCP=true
INSTALL_VSCODE=true
PREFIX="${CODEWIKI_PREFIX:-$HOME/.codewiki}"
REPO_URL="https://github.com/gaosichun888/codewiki.git"
BRANCH="main"
NODE_MIN=18

# ── Colors ────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { printf "${CYAN}[info]${NC}  %s\n" "$*"; }
ok()    { printf "${GREEN}[ok]${NC}    %s\n" "$*"; }
warn()  { printf "${YELLOW}[warn]${NC}  %s\n" "$*"; }
fail()  { printf "${RED}[error]${NC} %s\n" "$*" >&2; exit 1; }

# ── Parse arguments ───────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-desktop) INSTALL_DESKTOP=false ;;
    --no-cli)     INSTALL_CLI=false ;;
    --no-mcp)     INSTALL_MCP=false ;;
    --no-vscode)  INSTALL_VSCODE=false ;;
    --prefix)     PREFIX="$2"; shift ;;
    --branch)     BRANCH="$2"; shift ;;
    -h|--help)
      echo "Usage: install.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --no-desktop   Skip Electron desktop app build"
      echo "  --no-cli       Skip CLI installation"
      echo "  --no-mcp       Skip MCP Server build"
      echo "  --no-vscode    Skip VSCode extension installation"
      echo "  --prefix DIR   Install to DIR (default: ~/.codewiki)"
      echo "  --branch NAME  Git branch to clone (default: main)"
      echo "  -h, --help     Show this help"
      exit 0
      ;;
    *) fail "Unknown option: $1. Use --help for usage." ;;
  esac
  shift
done

# ── Detect OS & arch ──────────────────────────────────────────
OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
  Linux*)  PLATFORM="linux" ;;
  Darwin*) PLATFORM="mac" ;;
  *)       fail "Unsupported OS: $OS. Use install.ps1 for Windows." ;;
esac

# ── Prerequisite checks ──────────────────────────────────────
check_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required but not found. Please install it first."
}

check_cmd git
check_cmd node
check_cmd npm

NODE_VER="$(node -v | sed 's/^v//' | cut -d. -f1)"
if [[ "$NODE_VER" -lt "$NODE_MIN" ]]; then
  fail "Node.js >= $NODE_MIN required (found v$(node -v | sed 's/^v//')). Please upgrade."
fi

ok "Prerequisites: git, node v$(node -v | sed 's/^v//'), npm v$(npm -v)"

# ── Clone or update repo ─────────────────────────────────────
SRC_DIR="$PREFIX/source"

if [[ -d "$SRC_DIR/.git" ]]; then
  info "Updating existing source at $SRC_DIR ..."
  cd "$SRC_DIR"
  git fetch origin "$BRANCH" --depth=1
  git checkout "$BRANCH" -- .
  git reset --hard "origin/$BRANCH"
else
  info "Cloning codewiki to $SRC_DIR ..."
  mkdir -p "$PREFIX"
  git clone --depth=1 --branch "$BRANCH" "$REPO_URL" "$SRC_DIR"
  cd "$SRC_DIR"
fi

ok "Source ready at $SRC_DIR"

# ── Install dependencies ─────────────────────────────────────
info "Installing npm dependencies ..."
npm install --prefer-offline 2>&1 | tail -1
ok "Dependencies installed"

# ── Build CLI ─────────────────────────────────────────────────
if $INSTALL_CLI; then
  info "Building CLI ..."
  npm run build:cli
  # Create wrapper script
  BIN_DIR="$PREFIX/bin"
  mkdir -p "$BIN_DIR"
  cat > "$BIN_DIR/codewiki" << WRAPPER
#!/usr/bin/env bash
exec node "$SRC_DIR/dist-cli/codewiki-cli.js" "\$@"
WRAPPER
  chmod +x "$BIN_DIR/codewiki"
  ok "CLI installed -> $BIN_DIR/codewiki"
fi

# ── Build MCP Server ─────────────────────────────────────────
if $INSTALL_MCP; then
  info "Building MCP Server ..."
  npm run build:mcp
  # Create wrapper script
  BIN_DIR="$PREFIX/bin"
  mkdir -p "$BIN_DIR"
  cat > "$BIN_DIR/codewiki-mcp" << WRAPPER
#!/usr/bin/env bash
exec node "$SRC_DIR/dist/server/mcp-server.js" "\$@"
WRAPPER
  chmod +x "$BIN_DIR/codewiki-mcp"

  # Generate MCP client config snippet
  MCP_CONFIG_DIR="$PREFIX/config"
  mkdir -p "$MCP_CONFIG_DIR"
  cat > "$MCP_CONFIG_DIR/mcp-client-config.json" << MCPCFG
{
  "mcpServers": {
    "codewiki": {
      "command": "node",
      "args": ["$SRC_DIR/dist/server/mcp-server.js"],
      "env": {}
    }
  }
}
MCPCFG
  ok "MCP Server installed -> $BIN_DIR/codewiki-mcp"
  ok "MCP client config -> $MCP_CONFIG_DIR/mcp-client-config.json"
fi

# ── Build Desktop App ────────────────────────────────────────
if $INSTALL_DESKTOP; then
  info "Building desktop app (Electron) ..."
  npm run build 2>&1 | tail -3

  if command -v electron-builder >/dev/null 2>&1 || npx --yes electron-builder --version >/dev/null 2>&1; then
    info "Packaging desktop app for $PLATFORM ..."
    case "$PLATFORM" in
      linux) npx --yes electron-builder --linux --config 2>&1 | tail -5 ;;
      mac)   npx --yes electron-builder --mac   --config 2>&1 | tail -5 ;;
    esac

    RELEASE_DIR="$SRC_DIR/release"
    if [[ -d "$RELEASE_DIR" ]]; then
      ok "Desktop app packaged -> $RELEASE_DIR/"
      echo ""
      info "Installers found:"
      find "$RELEASE_DIR" -maxdepth 1 \( -name "*.AppImage" -o -name "*.deb" -o -name "*.dmg" -o -name "*.exe" \) -exec echo "  {}" \;

      # Make AppImage executable on Linux
      if [[ "$PLATFORM" == "linux" ]]; then
        find "$RELEASE_DIR" -name "*.AppImage" -exec chmod +x {} \;
      fi
    else
      warn "Build completed but no release directory found. Run 'npm run dist:$PLATFORM' manually."
    fi
  else
    warn "electron-builder not available, skipping packaging. App is built for development mode."
    info "Run 'npm run electron:dev' in $SRC_DIR to launch the dev version."
  fi
fi

# ── Build & Install VSCode Extension ─────────────────────────
if $INSTALL_VSCODE; then
  info "Building VSCode extension ..."
  VSCODE_DIR="$SRC_DIR/vscode-extension"
  cd "$VSCODE_DIR"
  npm install 2>&1 | tail -1

  if command -v vsce >/dev/null 2>&1 || npx --yes @vscode/vsce --version >/dev/null 2>&1; then
    npx --yes @vscode/vsce package --no-dependencies 2>&1 | tail -1
    VSIX_FILE=$(find "$VSCODE_DIR" -maxdepth 1 -name "*.vsix" | sort -V | tail -1)

    if [[ -n "$VSIX_FILE" ]]; then
      # Copy vsix to prefix for easy access
      cp "$VSIX_FILE" "$PREFIX/"
      ok "VSCode extension packaged -> $PREFIX/$(basename "$VSIX_FILE")"

      # Auto-install if code CLI is available
      if command -v code >/dev/null 2>&1; then
        info "Installing VSCode extension ..."
        code --install-extension "$VSIX_FILE" --force 2>&1 | tail -1
        ok "VSCode extension installed"
      else
        warn "'code' CLI not found. Install manually:"
        echo "  code --install-extension $PREFIX/$(basename "$VSIX_FILE")"
      fi
    else
      warn "VSIX file not found after build."
    fi
  else
    warn "vsce not available, compiling only."
    npm run compile
    ok "VSCode extension compiled (not packaged)."
  fi

  cd "$SRC_DIR"
fi

# ── PATH setup ────────────────────────────────────────────────
BIN_DIR="$PREFIX/bin"
if [[ -d "$BIN_DIR" ]]; then
  if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    echo ""
    info "Add the following to your shell profile (~/.bashrc, ~/.zshrc, etc.):"
    echo ""
    printf "  ${CYAN}export PATH=\"%s:\$PATH\"${NC}\n" "$BIN_DIR"
    echo ""

    # Attempt to add automatically
    SHELL_RC=""
    case "${SHELL:-}" in
      */zsh)  SHELL_RC="$HOME/.zshrc" ;;
      */bash) SHELL_RC="$HOME/.bashrc" ;;
    esac

    if [[ -n "$SHELL_RC" && -f "$SHELL_RC" ]]; then
      if ! grep -q "$BIN_DIR" "$SHELL_RC" 2>/dev/null; then
        echo "" >> "$SHELL_RC"
        echo "# CodeWiki CLI & MCP" >> "$SHELL_RC"
        echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$SHELL_RC"
        ok "Added to $SHELL_RC (restart shell or run: source $SHELL_RC)"
      fi
    fi
  fi
fi

# ── Summary ───────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
printf "  ${GREEN}CodeWiki installation complete!${NC}\n"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Install prefix:  $PREFIX"
echo "  Source code:     $SRC_DIR"
$INSTALL_CLI     && echo "  CLI:             $BIN_DIR/codewiki"
$INSTALL_MCP     && echo "  MCP Server:      $BIN_DIR/codewiki-mcp"
$INSTALL_MCP     && echo "  MCP Config:      $PREFIX/config/mcp-client-config.json"
$INSTALL_DESKTOP && echo "  Desktop App:     $RELEASE_DIR/ (or npm run electron:dev)"
$INSTALL_VSCODE  && echo "  VSCode ext:      $PREFIX/*.vsix"
echo ""
echo "  Quick start:"
$INSTALL_CLI     && echo "    codewiki index /path/to/project    # Index a project"
$INSTALL_CLI     && echo "    codewiki search 'query'            # Semantic search"
$INSTALL_DESKTOP && echo "    npm run electron:dev                # Launch desktop app (dev)"
echo ""
printf "  ${CYAN}Documentation: https://github.com/gaosichun888/codewiki${NC}\n"
echo ""
