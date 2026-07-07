@echo off
setlocal EnableDelayedExpansion

REM ── Fraggell Footage Panel — Build + Deploy Update ────────────────────────
REM Run this script after making changes to the panel.
REM It will:
REM   1. Bump the version number in main.js and panel-version.json
REM   2. Zip up the extension folder
REM   3. Upload the zip and version.json to the FootageStore server
REM   4. Redeploy the FootageStore container to serve the new files
REM
REM Usage: build-and-deploy.bat [version]
REM   e.g. build-and-deploy.bat 1.1.0
REM   If no version is passed, it prompts for one.

echo.
echo  =============================================
echo   Fraggell Footage Panel - Build and Deploy
echo  =============================================
echo.

REM ── Get version ───────────────────────────────────────────────────────────
set "VERSION=%~1"
if "%VERSION%"=="" (
    set /p VERSION="Enter new version number (e.g. 1.2.0): "
)
if "%VERSION%"=="" (
    echo [ERROR] No version specified.
    pause & exit /b 1
)

set "SCRIPT_DIR=%~dp0"
set "EXT_DIR=%SCRIPT_DIR%fraggell-footage-panel"

REM ── Update PANEL_VERSION in main.js ───────────────────────────────────────
echo [1/5] Updating PANEL_VERSION to %VERSION%...
set "MAIN_JS=%EXT_DIR%\js\main.js"
powershell -NoProfile -Command "(Get-Content '%MAIN_JS%') -replace \"const PANEL_VERSION = '[^']*'\", \"const PANEL_VERSION = '%VERSION%'\" | Set-Content '%MAIN_JS%'"
echo [1/5] Done.

REM ── Create the zip (Python ensures forward-slash paths — Mac-compatible) ────
echo [2/5] Creating panel.zip...
set "ZIP_PATH=%TEMP%\fraggell-panel-%VERSION%.zip"
if exist "%ZIP_PATH%" del "%ZIP_PATH%"
python -c "import zipfile,os; src=r'%EXT_DIR%'; dst=r'%ZIP_PATH%'; zf=zipfile.ZipFile(dst,'w',zipfile.ZIP_DEFLATED); [zf.write(os.path.join(r,f), os.path.relpath(os.path.join(r,f),os.path.dirname(src)).replace(chr(92),'/')) for r,d,fs in os.walk(src) for f in fs if not f.startswith('.')]; zf.close(); print('Zipped',round(os.path.getsize(dst)/1024,1),'KB')"
if errorlevel 1 (
    echo [ERROR] Zip creation failed. Is Python installed?
    pause & exit /b 1
)
echo [2/5] Done.

REM ── Upload zip to FootageStore public folder ──────────────────────────────
echo [3/5] Uploading panel.zip to FootageStore...
ssh root@192.168.0.150 "mkdir -p /mnt/user/appdata/footagestore/data/panel"
scp "%ZIP_PATH%" root@192.168.0.150:/mnt/user/appdata/footagestore/data/panel/panel.zip
if errorlevel 1 (
    echo [ERROR] SCP failed. Check SSH connection.
    pause & exit /b 1
)
echo [3/5] Done.

REM ── Update panel-version.json on the server ───────────────────────────────
echo [4/5] Updating panel-version.json...
ssh root@192.168.0.150 "printf '{\"version\":\"%s\",\"url\":\"https://footagestore.fraggell.com/panel.zip\",\"notes\":\"See release notes\"}' '%VERSION%' > /mnt/user/appdata/footagestore/app/public/panel-version.json && echo ok"
echo [4/5] Done.

REM ── Update version in hosted install script ──────────────────────────────────
echo [4b/5] Updating install-panel.sh version...
ssh root@192.168.0.150 "sed -i 's/PANEL_VERSION=\"[^\"]*\"/PANEL_VERSION=\"%VERSION%\"/g' /mnt/user/appdata/footagestore/app/public/install-panel.sh && echo ok"
echo [4b/5] Done.

REM ── Rebuild and restart FootageStore to serve new static files ─────────────
echo [5/5] Redeploying FootageStore...
ssh root@192.168.0.150 "cd /mnt/user/appdata/footagestore/app && docker compose build --no-cache app && docker compose up -d app"
echo [5/5] Done.

echo.
echo  =============================================
echo   Deploy complete! Version: %VERSION%
echo  =============================================
echo.
echo  Editors will see an update prompt next time
echo  they open the panel in Premiere.
echo.
pause
