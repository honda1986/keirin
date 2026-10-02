@echo off
rem 合言葉を PC に置く(races.json などを解くため)。ダブルクリックするだけ。
rem   GitHub の Secrets の KEIRIN_PASS と同じ合言葉を入れる。保存先 .keirin_pass は git に入らない
setlocal
title 競輪 合言葉の設定
set "PATH=%PATH%;C:\Program Files\nodejs;%LOCALAPPDATA%\Programs\nodejs;C:\Program Files\Git\cmd;%LOCALAPPDATA%\Programs\Git\cmd"
cd /d "%~dp0.."
node pc\set_pass.js
set RC=%ERRORLEVEL%
echo.
pause
exit /b %RC%
