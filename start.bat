@echo off
chcp 65001 >nul
cd /d "%~dp0"
node scripts\play.mjs
echo.
echo Server stopped. Press any key to close this window...
pause >nul
