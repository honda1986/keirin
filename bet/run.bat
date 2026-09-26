@echo off
setlocal
set PYTHONUTF8=1
cd /d "%~dp0"

:MENU
cls
echo.
echo    競輪 自動購入（オッズパーク）
echo    ------------------------------------------------------
echo     1) check   買う／見送るの判定を見るだけ（ブラウザ無し）
echo     2) dry     ブラウザを開き、確認画面まで進んで押さない
echo     3) live    実際に購入する
echo     4) ためす   疑似の買い目で dry を試す（買い目が無い時間用）
echo.
echo     5) 今日の勝負レースと判定を一覧で見る
echo     6) 画面操作を記録する（手で投票した手順を残す。作り直し用）
echo     7) 金額や上限の設定を変える
echo     8) ログの最後の30行を見る
echo     9) テスト（サイトを触らずに確かめる）
echo     0) 終わる
echo    ------------------------------------------------------
echo.
set N=
set /p N="番号を入れて Enter: "

if "%N%"=="1" goto CHECK
if "%N%"=="2" goto DRY
if "%N%"=="3" goto LIVE
if "%N%"=="4" goto FAKE
if "%N%"=="5" goto PLAN
if "%N%"=="6" goto RECORD
if "%N%"=="7" goto SETTINGS
if "%N%"=="8" goto LOG
if "%N%"=="9" goto TEST
if "%N%"=="0" goto END
goto MENU

:CHECK
call :RUN check
goto MENU

:DRY
call :RUN dry
goto MENU

:LIVE
echo.
echo    ★ live は実際にお金を使って購入します。
set YES=
set /p YES="よろしければ y を入れて Enter（やめるなら何も入れずに Enter）: "
if /i not "%YES%"=="y" goto MENU
call :RUN live
goto MENU

:FAKE
echo.
echo    疑似の買い目を作って、dry（押さない）で画面操作を試します。
echo    いま発売中のレースを指定してください（オッズパークの画面で確認できます）。
echo.
set P=
set /p P="場の名前（例 広島）: "
set R=
set /p R="レース番号（例 1）: "
set C=
set /p C="買い目（例 3-4-6。何も入れなければ 1-2-3）: "
if "%P%"=="" goto MENU
if "%R%"=="" goto MENU
echo.
echo    dry で試します。止めるときは Ctrl+C。
echo.
if "%C%"=="" (
  python keirin_bet.py --mode dry --fake %P%-%R%
) else (
  python keirin_bet.py --mode dry --fake %P%-%R%-%C%
)
echo.
pause
goto MENU

:PLAN
echo.
node ..\betplan.js --pretty
echo.
pause
goto MENU

:RECORD
echo.
echo    Chrome が開くので、手でログインして、ためしたい投票画面で1レースぶん操作してください。
echo    押したところと画面が records フォルダに残ります（ID・パスワード・暗証番号は残しません）。
echo    自動購入（2 や 3）を動かしている間は使えません。先に止めてください。
echo.
set U=
set /p U="最初に開くURL（何も入れなければオッズパークのトップ）: "
if "%U%"=="" (
  python record.py
) else (
  python record.py --url "%U%"
)
echo.
echo    records フォルダを開きます。
start "" "%~dp0records"
pause
goto MENU

:SETTINGS
python settings.py
goto MENU

:LOG
echo.
if exist "logs\keirin_bet.log" (
  powershell -NoProfile -Command "Get-Content -Tail 30 -Encoding UTF8 'logs\keirin_bet.log'"
) else (
  echo    まだログがありません。
)
echo.
pause
goto MENU

:TEST
echo.
python run_tests.py
echo.
pause
goto MENU

:RUN
echo.
echo    %1 で動かします。止めるときは Ctrl+C（または このフォルダに STOP というファイルを作る）。
echo.
python keirin_bet.py --mode %1
set CODE=%ERRORLEVEL%
echo.
if "%CODE%"=="4" (
  echo    ★購入の結果が分からなくなったため止まりました。
  echo      オッズパークの投票履歴を見て、買えているか確認してください。
) else if "%CODE%"=="3" (
  echo    ★bet_done.json が壊れています。直すまで動かさないでください。
) else if "%CODE%"=="2" (
  echo    ★設定か準備が足りません。上のメッセージを見てください。
) else if "%CODE%"=="9009" (
  echo    ★Python が見つかりません。python.org から入れて、
  echo      インストール最初の画面の「Add python.exe to PATH」にチェックを。
) else (
  echo    終了しました。
)
echo.
pause
exit /b

:END
