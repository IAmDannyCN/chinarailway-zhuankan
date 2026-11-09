@echo off
chcp 65001 >nul
pushd "%~dp0" || exit /b 1
start "" "%CD%\offline\index.html"
popd
