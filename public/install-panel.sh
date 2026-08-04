
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

# ── Authenticate via Fraggell Hub SSO (PKCE code flow) ───────────────────────
# No panel password: we open the real Hub login in your browser (passkeys/2-step
# supported), you copy the one-time code it shows, and we exchange it — with a
# locally-generated verifier the code alone can't be used without — for a session.
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
VERIFIER=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')
CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -sha256 -binary | b64url)
STATE=$(openssl rand -hex 16)
LOGIN_URL="$API/api/auth/panel-login?mode=code&state=$STATE&challenge=$CHALLENGE"

echo " Sign in with your Fraggell Hub account."
echo " Opening your browser..."
open "$LOGIN_URL" 2>/dev/null || {
  echo ""
  echo " Couldn't open a browser automatically. Open this URL manually:"
  echo " $LOGIN_URL"
}
echo ""
echo " After signing in, the page shows a short code. Paste it here:"
printf " Code: "
read CODE
CODE=$(printf '%s' "$CODE" | tr -d '[:space:]')
echo ""

if [ -z "$CODE" ]; then
  echo " ✗ No code entered."
  exit 1
fi

echo " Verifying..."
JSON=$(printf '{"code":"%s","verifier":"%s"}' "$CODE" "$VERIFIER")
EXCHANGE=$(curl -s -X POST "$API/api/auth/panel-exchange" \
  -H "Content-Type: application/json" \
  -d "$JSON")

TOKEN=$(echo "$EXCHANGE" | python3 -c "
import sys, json
try:
    print(json.loads(sys.stdin.read()).get('sessionToken', ''))
except Exception:
    print('')
" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  ERROR=$(echo "$EXCHANGE" | python3 -c "
import sys, json
try:
    print(json.loads(sys.stdin.read()).get('error', 'Sign-in failed'))
except:
    print('Sign-in failed — the code may have expired (2 min). Run the installer again.')
" 2>/dev/null)
  echo " ✗ $ERROR"
  echo ""
  exit 1
fi

echo " ✓ Signed in"
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
