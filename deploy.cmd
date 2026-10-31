@echo off
rem TapCanvas one-click deploy for Windows. Double-click this file, or run: deploy.cmd [install^|update^|start^|stop^|status^|logs^|info]
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1" %*
set TAPCANVAS_EXIT=%ERRORLEVEL%
if "%~1"=="" pause
exit /b %TAPCANVAS_EXIT%
