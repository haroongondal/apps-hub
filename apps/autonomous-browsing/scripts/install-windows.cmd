@echo off
setlocal
pushd "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "install-windows.ps1" %*
set RC=%ERRORLEVEL%
popd
echo.
pause
exit /b %RC%
