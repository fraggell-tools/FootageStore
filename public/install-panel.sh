
#!/bin/bash
# Fraggell Footage Panel — macOS Installer
# Usage: curl -fsSL https://footagestore.fraggell.com/install-panel.sh -o /tmp/fp-install.sh && bash /tmp/fp-install.sh && rm /tmp/fp-install.sh

set -e

API="https://footagestore.fraggell.com"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions"
EXT="$DEST/fraggell-footage-panel"
TMP="/tmp/fraggell-panel-install.zip"

echo ""
echo " ============================================="
echo "  Fraggell Footage Panel — Installer"
echo " ============================================="
echo ""

# ── Check Premiere is closed ──────────────────────────────────────────────────
if pgrep -x "Adobe Premiere Pro" > /dev/null 2>&1; then
  echo " ✗ Adobe Premiere Pro is open. Close it first, then run this again."
  echo ""
  exit 1
fi

# ── Authenticate ──────────────────────────────────────────────────────────────
echo " Sign in with your FootageStore account."
echo ""
printf " Email: "
read EMAIL
printf " Password: "
read -s PASSWORD
echo ""
echo ""

if [ -z "$EMAIL" ] || [ -z "$PASSWORD" ]; then
  echo " ✗ Email and password are required."
  exit 1
fi

echo " Authenticating..."

# Use printf to safely build JSON without variable interpolation issues
JSON=$(printf '{"email":"%s","password":"%s","pluginKey":"fraggell-premiere-plugin-2026"}' "$EMAIL" "$PASSWORD")

AUTH_RESPONSE=$(curl -s -X POST "$API/api/auth/plugin" \
  -H "Content-Type: application/json" \
  -d "$JSON")

if [ -z "$AUTH_RESPONSE" ]; then
  echo " ✗ No response from server. Check your internet connection."
  exit 1
fi

# Extract session token using python3 (available on all modern Macs)
TOKEN=$(echo "$AUTH_RESPONSE" | python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    t = d.get('sessionToken', '')
    print(t)
except Exception as e:
    print('')
" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  # Show the actual error from the server
  ERROR=$(echo "$AUTH_RESPONSE" | python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    print(d.get('error', 'Authentication failed'))
except:
    print('Authentication failed — unexpected server response')
" 2>/dev/null)
  echo " ✗ $ERROR"
  echo ""
  exit 1
fi

echo " ✓ Signed in as $EMAIL"
echo ""

# ── Enable unsigned CEP extensions ───────────────────────────────────────────
echo " [1/4] Enabling CEP extensions..."
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
defaults write com.adobe.CSXS.10 PlayerDebugMode 1
defaults write com.adobe.CSXS.9  PlayerDebugMode 1
echo "       Done."

# ── Create extensions folder ──────────────────────────────────────────────────
echo " [2/4] Preparing extensions folder..."
mkdir -p "$DEST"
echo "       Done."

# ── Download panel (authenticated) ───────────────────────────────────────────
echo " [3/4] Downloading panel..."
HTTP_STATUS=$(curl -s -o "$TMP" -w "%{http_code}" \
  "$API/api/panel/download" \
  -H "Cookie: __Secure-authjs.session-token=$TOKEN")

if [ "$HTTP_STATUS" != "200" ]; then
  echo " ✗ Download failed (HTTP $HTTP_STATUS). Contact Nick."
  rm -f "$TMP"
  exit 1
fi
echo "       Done."

# ── Extract ───────────────────────────────────────────────────────────────────
echo " [4/4] Installing..."
[ -d "$EXT" ] && rm -rf "$EXT"
unzip -q "$TMP" -d "$DEST"
rm -f "$TMP"
echo "       Done."

echo ""
echo " ============================================="
echo "  Installed successfully!"
echo " ============================================="
echo ""
echo " Open Premiere Pro → Window → Extensions → Fraggell Footage"
echo ""
