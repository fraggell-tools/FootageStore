# Fraggell Footage Panel - Windows Installer (Hub SSO)
# Run via: install-panel.bat  (which launches this), or:
#   powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://footagestore.fraggell.com/install-panel.ps1 | iex"
#
# No panel password: signs in through the real Fraggell Hub (passkeys/2-step
# supported) using a PKCE code flow, then installs the panel.

$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 can default to TLS 1.0/1.1, which Cloudflare rejects.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$API  = 'https://footagestore.fraggell.com'
$DEST = Join-Path $env:APPDATA 'Adobe\CEP\extensions'
$EXT  = Join-Path $DEST 'fraggell-footage-panel'
$ZIP  = Join-Path $env:TEMP 'fraggell-panel-install.zip'

Write-Host ''
Write-Host ' ============================================='
Write-Host '  Fraggell Footage Panel - Windows Installer'
Write-Host ' ============================================='
Write-Host ''

if (Get-Process 'Adobe Premiere Pro' -ErrorAction SilentlyContinue) {
  Write-Host ' [X] Adobe Premiere Pro is open. Close it, then run this again.' -ForegroundColor Red
  return
}

# ---- Authenticate via Hub SSO (PKCE code flow) ------------------------------
function ConvertTo-B64Url([byte[]]$bytes) {
  [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}
$vbytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($vbytes)
$verifier  = ConvertTo-B64Url $vbytes
$sha       = [System.Security.Cryptography.SHA256]::Create()
$challenge  = ConvertTo-B64Url $sha.ComputeHash([System.Text.Encoding]::ASCII.GetBytes($verifier))
$state     = ConvertTo-B64Url ([guid]::NewGuid().ToByteArray())

$loginUrl = "$API/api/auth/panel-login?mode=code&state=$state&challenge=$challenge"
Write-Host ' Sign in with your Fraggell Hub account.'
Write-Host ' Opening your browser...'
try { Start-Process $loginUrl } catch {
  Write-Host ''
  Write-Host ' Could not open a browser automatically. Open this URL manually:'
  Write-Host " $loginUrl"
}
Write-Host ''
Write-Host ' After signing in, the page shows a short code.'
$code = (Read-Host ' Paste the code here').Trim()
if (-not $code) { Write-Host ' [X] No code entered.' -ForegroundColor Red; return }

Write-Host ' Verifying...'
$token = $null
try {
  $body = @{ code = $code; verifier = $verifier } | ConvertTo-Json -Compress
  $resp = Invoke-RestMethod -Uri "$API/api/auth/panel-exchange" -Method POST -ContentType 'application/json' -Body $body
  $token = $resp.sessionToken
} catch { $token = $null }
if (-not $token) {
  Write-Host ' [X] Sign-in failed. The code may have expired (2 min). Run the installer again.' -ForegroundColor Red
  return
}
Write-Host ' Signed in.'
Write-Host ''

# ---- Enable unsigned CEP extensions -----------------------------------------
Write-Host ' [1/3] Enabling CEP extensions...'
foreach ($v in 9, 10, 11, 12) {
  New-Item -Path "HKCU:\Software\Adobe\CSXS.$v" -Force | Out-Null
  Set-ItemProperty -Path "HKCU:\Software\Adobe\CSXS.$v" -Name PlayerDebugMode -Value '1'
}

# ---- Download the panel (session cookie auth) -------------------------------
Write-Host ' [2/3] Downloading panel...'
$dlResp = Invoke-WebRequest -Uri "$API/api/panel/download" `
  -Headers @{ Cookie = "__Secure-authjs.session-token=$token" } `
  -OutFile $ZIP -UseBasicParsing -PassThru
if ($dlResp.StatusCode -ne 200) {
  Write-Host " [X] Download failed (HTTP $($dlResp.StatusCode)). Run the installer again." -ForegroundColor Red
  Remove-Item -Force $ZIP -ErrorAction SilentlyContinue
  return
}
# Validate the file is actually a ZIP (PK magic bytes) before attempting extraction.
$magic = [System.IO.File]::ReadAllBytes($ZIP)[0..1]
if ($magic[0] -ne 0x50 -or $magic[1] -ne 0x4B) {
  Write-Host ' [X] Downloaded file is not a valid ZIP. Run the installer again.' -ForegroundColor Red
  Remove-Item -Force $ZIP -ErrorAction SilentlyContinue
  return
}

# ---- Install ----------------------------------------------------------------
Write-Host ' [3/3] Installing...'
if (-not (Test-Path $DEST)) { New-Item -ItemType Directory -Path $DEST -Force | Out-Null }
if (Test-Path $EXT) { Remove-Item -Recurse -Force $EXT }
Expand-Archive -Force -Path $ZIP -DestinationPath $DEST
Remove-Item -Force $ZIP

Write-Host ''
Write-Host ' ============================================='
Write-Host '  Installation complete!'
Write-Host ' ============================================='
Write-Host ''
Write-Host ' Open Adobe Premiere Pro, then: Window > Extensions > Fraggell Footage'
Write-Host ''
