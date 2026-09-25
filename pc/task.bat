@echo off
rem 競輪の締切前オッズを1回だけ記録する。タスクスケジューラから1分おきに呼ばれる。
rem   使い方: task.bat snap          (ふだん)
rem           task.bat snap --dry    (GitHub へ送らない試し運転)
rem
rem   リポジトリ = この bat の1つ上のフォルダ(例 C:\keirin\keirin)
rem   ログ       = リポジトリの隣の logs(例 C:\keirin\logs\snap_日付.log)
setlocal
rem Node.js と Git は入れても PATH に入らないことがあるので、よくある置き場を足しておく
set "PATH=%PATH%;C:\Program Files\nodejs;%LOCALAPPDATA%\Programs\nodejs;C:\Program Files\Git\cmd;%LOCALAPPDATA%\Programs\Git\cmd"
cd /d "%~dp0.."
node pc\runner.js %* --log-dir "%~dp0..\..\logs"
exit /b %ERRORLEVEL%
