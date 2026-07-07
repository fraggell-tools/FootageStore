#!/bin/bash

# ── Fraggell Footage Panel — macOS Installer ──────────────────────────────────

echo ""
echo " ============================================="
echo "  Fraggell Footage Panel - macOS Installer"
echo " ============================================="
echo ""

# ── Check Premiere is closed ──────────────────────────────────────────────────
if pgrep -x "Adobe Premiere Pro" > /dev/null 2>&1; then
    echo " [WARNING] Adobe Premiere Pro is currently running."
    echo " Please close Premiere Pro before continuing."
    echo ""
    exit 1
fi

# ── Enable unsigned CEP extensions ───────────────────────────────────────────
echo " [1/3] Enabling unsigned CEP extensions..."
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
defaults write com.adobe.CSXS.10 PlayerDebugMode 1
defaults write com.adobe.CSXS.9  PlayerDebugMode 1
echo " [1/3] Done."

# ── Create extensions folder if it doesn't exist ─────────────────────────────
echo " [2/3] Preparing extensions folder..."
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions"
mkdir -p "$DEST"

# ── Copy extension (overwrites existing version) ──────────────────────────────
echo " [3/3] Installing Fraggell Footage Panel..."

# Get the folder where this script lives
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE="$SCRIPT_DIR/fraggell-footage-panel"
EXT="$DEST/fraggell-footage-panel"

if [ ! -d "$SOURCE" ]; then
    echo ""
    echo " [ERROR] Cannot find the fraggell-footage-panel folder."
    echo " Make sure it is in the same folder as this script."
    echo ""
    exit 1
fi

# Remove old version first for a clean install
if [ -d "$EXT" ]; then
    rm -rf "$EXT"
fi

cp -R "$SOURCE" "$EXT"
if [ $? -ne 0 ]; then
    echo " [ERROR] Copy failed."
    exit 1
fi
echo " [3/3] Done."

echo ""
echo " ============================================="
echo "  Installation complete!"
echo " ============================================="
echo ""
echo " Open Adobe Premiere Pro, then go to:"
echo " Window > Extensions > Fraggell Footage"
echo ""
