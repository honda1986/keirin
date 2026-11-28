@echo off
setlocal
set PYTHONUTF8=1
cd /d "%~dp0"

rem 2026-11-29: 開くたびに GitHub から最新を取り込む（update.py。keirin の hikitsugi §4-74）
rem   それまでは PC のタスク keirin_snap だけが取り込んでいて、タスクが止まると古いままだった
rem   取り込みで run.bat 自身も書き換わることがあるので、そのあと自分を最初から開き直す（--no-update を付けて）
rem   ★このかっこの中は、cmd が先に全部読んでから動かす。途中でファイルが変わっても、かっこの中は最後まで動く
rem   取り込まずに開きたいとき（ネットが無いときなど）は run.bat --no-update
if /i not "%~1"=="--no-update" (
  python update.py
  if errorlevel 1 pause
  "%~f0" --no-update
)
set VER=
if exist "logs\version.txt" set /p VER=<"logs\version.txt"

rem 2026-11-26: メニューを5つにした（keirin の hikitsugi §4-73）。check・ためす・記録・ログ・テストは「5) そのほか」

:MENU
cls
echo.
echo    競輪 自動購入（オッズパーク）
if defined VER echo    コード %VER%（開くたびに GitHub から最新を取り込みます）
echo    ------------------------------------------------------
echo     1) 本番を始める   実際に購入する（live。y を入れて確認してから）
echo     2) 練習           ブラウザを開き、確認画面まで進んで押さない（dry）
echo     3) 今日の買い目   今日の残りのレースと、買う／見送るの判定を一覧で見る
echo     4) 設定           金額・買う種類・上限・通知
echo     5) そのほか       判定だけ見る・ためす・画面の記録・ログ・テスト
echo     0) 終わる
echo    ------------------------------------------------------
echo.
set N=
set /p N="番号を入れて Enter: "

if "%N%"=="1" goto LIVE
if "%N%"=="2" goto DRY
if "%N%"=="3" goto PLAN
if "%N%"=="4" goto SETTINGS
if "%N%"=="5" goto MORE
if "%N%"=="0" goto END
goto MENU

:MORE
cls
echo.
echo    そのほか
echo    ------------------------------------------------------
echo     1) 判定だけ見る   買う／見送るの判定を見るだけ（check。ブラウザ無し）
echo     2) ためす         疑似の買い目で dry を試す（買い目が無い時間用）
echo     3) 画面を記録する 手で投票した手順を残す（作り直し用）
echo     4) ログを見る     ログの最後の30行
echo     5) テスト         サイトを触らずに確かめる
echo     0) 戻る
echo    ------------------------------------------------------
echo.
set M=
set /p M="番号を入れて Enter: "

if "%M%"=="1" goto CHECK
if "%M%"=="2" goto FAKE
if "%M%"=="3" goto RECORD
if "%M%"=="4" goto LOG
if "%M%"=="5" goto TEST
if "%M%"=="0" goto MENU
goto MORE

:CHECK
call :RUN check
goto MORE

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
if "%P%"=="" goto MORE
if "%R%"=="" goto MORE
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
goto MORE

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
echo    自動購入（本番や練習）を動かしている間は使えません。先に止めてください。
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
goto MORE

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
goto MORE

:TEST
echo.
python run_tests.py
echo.
pause
goto MORE

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
