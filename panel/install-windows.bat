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

REM ── Enable unsigned CEP extensions ────────────────────────────────────────
echo  [1/3] Enabling unsigned CEP extensions...
reg add "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d "1" /f >NUL 2>&1
reg add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d "1" /f >NUL 2>&1
reg add "HKCU\Software\Adobe\CSXS.10" /v PlayerDebugMode /t REG_SZ /d "1" /f >NUL 2>&1
reg add "HKCU\Software\Adobe\CSXS.9"  /v PlayerDebugMode /t REG_SZ /d "1" /f >NUL 2>&1
echo  [1/3] Done.

REM ── Create extensions folder if it doesn't exist ──────────────────────────
echo  [2/3] Preparing extensions folder...
set "DEST=%APPDATA%\Adobe\CEP\extensions"
if not exist "%DEST%" mkdir "%DEST%"

REM ── Copy extension (overwrites existing version) ──────────────────────────
echo  [3/3] Installing Fraggell Footage Panel...
set "EXT=%DEST%\fraggell-footage-panel"

REM Get the folder where this script lives
set "SCRIPT_DIR=%~dp0"
set "SOURCE=%SCRIPT_DIR%fraggell-footage-panel"

if not exist "%SOURCE%" (
    echo.
    echo  [ERROR] Cannot find the fraggell-footage-panel folder.
    echo  Make sure it is in the same folder as this script.
    echo.
    pause
    exit /b 1
)

REM Remove old version first for a clean install
if exist "%EXT%" (
    rmdir /s /q "%EXT%"
)

xcopy "%SOURCE%" "%EXT%" /E /I /H /Y >NUL
if errorlevel 1 (
    echo  [ERROR] Copy failed. Try running as administrator.
    pause
    exit /b 1
)
echo  [3/3] Done.

echo.
echo  =============================================
echo   Installation complete!
echo  =============================================
echo.
echo  Open Adobe Premiere Pro, then go to:
echo  Window ^> Extensions ^> Fraggell Footage
echo.
pause
