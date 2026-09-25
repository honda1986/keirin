@echo off
rem 競輪の締切前オッズの記録を PC で始めるための準備。ダブルクリックするだけ。
rem   何度やり直しても壊れません。途中で転んだら直してもう一度どうぞ。
setlocal
title 競輪 締切前オッズ PC の準備
set "PATH=%PATH%;C:\Program Files\nodejs;%LOCALAPPDATA%\Programs\nodejs;C:\Program Files\Git\cmd;%LOCALAPPDATA%\Programs\Git\cmd"

node --version >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Node.js が見つかりません。
  echo   コマンドプロンプトに次を貼って入れてください:
  echo       winget install --id OpenJS.NodeJS.LTS -e
  echo   入れたあと、この setup.bat をもう一度ダブルクリック。
  echo.
  pause
  exit /b 1
)

cd /d "%~dp0.."
node pc\setup.js
set RC=%ERRORLEVEL%
echo.
pause
exit /b %RC%
