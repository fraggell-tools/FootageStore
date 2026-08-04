@echo off
REM Fraggell Footage Panel - Windows Installer
REM Signs in through the Fraggell Hub (no separate panel password) and installs
REM the panel. Just double-click this file.
REM
REM All the work lives in install-panel.ps1 (PowerShell handles the SSO PKCE
REM crypto + interactive sign-in cleanly). This wrapper just launches it.

powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://footagestore.fraggell.com/install-panel.ps1 | iex"

echo.
pause
