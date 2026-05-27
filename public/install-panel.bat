@echo off
setlocal EnableDelayedExpansion

echo.
echo  =============================================
echo   Fraggell Footage Panel - Windows Installer
echo  =============================================
echo.

REM ── Check Premiere is closed ──────────────────────────────────────────────
tasklist /FI "IMAGENAME eq Adobe Premiere Pro.exe" 2>NUL | find /I "Adobe Premiere Pro.exe" >NUL
if not errorlevel 1 (
    echo  [WARNING] Adobe Premiere Pro is currently running.
    echo  Please close Premiere Pro before continuing.
    echo.
    pause
    exit /b 1
)

REM ── Authenticate against FootageStore ─────────────────────────────────────
echo  Sign in with your FootageStore account.
echo.
set /p EMAIL= Email: 
set /p PASSWORD= Password: 
echo.
echo  Authenticating...

set "AUTH_URL=https://hub.fraggell.com/api/auth/plugin"
set "PLUGIN_KEY=fraggell-premiere-plugin-2026"

REM Use PowerShell for the auth request (-UseBasicParsing avoids IE engine security prompt)
for /f "delims=" %%T in ('powershell -NoProfile -Command "$r = Invoke-RestMethod -Uri '%AUTH_URL%' -Method POST -ContentType 'application/json' -UseBasicParsing -Body ('{\"email\":\"%EMAIL%\",\"password\":\"%PASSWORD%\",\"pluginKey\":\"%PLUGIN_KEY%\"}'); $r.sessionToken" 2^>nul') do set TOKEN=%%T

if "%TOKEN%"=="" (
    echo  [ERROR] Authentication failed. Check your email and password.
    echo.
    pause
    exit /b 1
)
echo  Signed in successfully.
echo.

REM ── Enable unsigned CEP extensions ────────────────────────────────────────
echo  [1/3] Enabling CEP extensions...
reg add "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d "1" /f >NUL 2>&1
reg add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d "1" /f >NUL 2>&1
reg add "HKCU\Software\Adobe\CSXS.10" /v PlayerDebugMode /t REG_SZ /d "1" /f >NUL 2>&1
reg add "HKCU\Software\Adobe\CSXS.9"  /v PlayerDebugMode /t REG_SZ /d "1" /f >NUL 2>&1
echo  [1/3] Done.

REM ── Download panel ─────────────────────────────────────────────────────────
echo  [2/3] Downloading panel...
set "ZIP=%TEMP%\fraggell-panel-install.zip"
set "DOWNLOAD_URL=https://footagestore.fraggell.com/api/panel/download"

powershell -NoProfile -Command "$r = Invoke-WebRequest -Uri '%DOWNLOAD_URL%' -UseBasicParsing -Headers @{Authorization='Bearer %TOKEN%'} -OutFile '%ZIP%' -PassThru; if($r.StatusCode -ne 200){ exit 1 }" 2>NUL
if errorlevel 1 (
    echo  [ERROR] Download failed. Contact Nick.
    pause
    exit /b 1
)
echo  [2/3] Done.

REM ── Install ────────────────────────────────────────────────────────────────
echo  [3/3] Installing...
set "DEST=%APPDATA%\Adobe\CEP\extensions"
if not exist "%DEST%" mkdir "%DEST%"
if exist "%DEST%\fraggell-footage-panel" rmdir /s /q "%DEST%\fraggell-footage-panel"
powershell -NoProfile -Command "Expand-Archive -Force -Path '%ZIP%' -DestinationPath '%DEST%'"
del /f /q "%ZIP%"
echo  [3/3] Done.

echo.
echo  =============================================
echo   Installation complete!
echo  =============================================
echo.
echo  Open Adobe Premiere Pro then go to:
echo  Window ^> Extensions ^> Fraggell Footage
echo.
pause
