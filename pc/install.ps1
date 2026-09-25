# install.ps1 -- 競輪の締切前オッズの記録を、PC で1回で始める
#
#   スタートメニューで「PowerShell」を開いて、次の1行を貼って Enter:
#
#     irm https://raw.githubusercontent.com/honda1986/keirin/main/pc/install.ps1 | iex
#
#   やること(何度やり直しても壊れない。もうあるものは作り直さない):
#     1. 管理者に切り替える(「このアプリがデバイスに変更を加えることを許可しますか」で「はい」)
#     2. Git と Node.js が無ければ入れる(winget)
#     3. C:\keirin\keirin にリポジトリを入れる(あれば最新にする)
#     4. GitHub へ送れるか確かめる。送れなければトークンの画面を開いて、直すのを待つ
#     5. 自己テストと試し運転(pc\setup.js)
#     6. タスク keirin_snap を登録して、1回動かしてログを見せる
#
#   更新したいときも同じ1行を貼ればよい。
#   ★このファイルは BOM なしの UTF-8(irm で読むと BOM が混ざって1行目が壊れるため)。
#     ファイルとして直接動かさず、上の1行で使うこと。

# ★$ErrorActionPreference は既定(Continue)のまま。Stop にすると、Windows PowerShell 5.1 では
#   git が標準エラーに書いただけ(進み具合の表示など)で止まってしまう
$URL = "https://raw.githubusercontent.com/honda1986/keirin/main/pc/install.ps1"
$ROOT = "C:\keirin"
$REPO = Join-Path $ROOT "keirin"
$LOGS = Join-Path $ROOT "logs"

function Say($m) { Write-Host $m }
function Ok($m) { Write-Host "  ○ $m" -ForegroundColor Green }
function Ng($m) { Write-Host "  × $m" -ForegroundColor Red }
function Step($n, $t) { Write-Host ""; Write-Host "--- $n. $t" -ForegroundColor Cyan }
function Done($code) { Write-Host ""; Read-Host "Enter で閉じます" | Out-Null; exit $code }

# ---- 1. 管理者に切り替える(タスクの登録に要る) ----
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    Say "管理者に切り替えます。「はい」を押してください(新しい窓で続きます)..."
    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Command `"irm $URL | iex`""
    return
}
$Host.UI.RawUI.WindowTitle = "競輪 締切前オッズ PC のセットアップ"
Say "競輪 締切前オッズの記録 — PC のセットアップ"

# winget で入れたものを、この窓でもすぐ使えるようにする
function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") +
                ";C:\Program Files\nodejs;C:\Program Files\Git\cmd;$env:LOCALAPPDATA\Programs\Git\cmd"
}
function Has($cmd) { Refresh-Path; return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function WingetInstall($id, $name) {
    Say "  $name を入れます(数分かかることがあります)..."
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Ng "winget がありません。Microsoft Store で「アプリ インストーラー」を入れてから、もう一度この1行を貼ってください"
        Done 1
    }
    winget install --id $id -e --silent --accept-source-agreements --accept-package-agreements | Out-Host
}

# ---- 2. Git と Node.js ----
Step 2 "Git と Node.js"
if (-not (Has git)) { WingetInstall "Git.Git" "Git" }
if (-not (Has git)) { Ng "Git を入れられませんでした。PC を再起動してから、もう一度この1行を貼ってください"; Done 1 }
Ok (git --version)
if (-not (Has node)) { WingetInstall "OpenJS.NodeJS.LTS" "Node.js" }
if (-not (Has node)) { Ng "Node.js を入れられませんでした。PC を再起動してから、もう一度この1行を貼ってください"; Done 1 }
Ok ("Node.js " + (node --version))

# ---- 3. リポジトリ ----
Step 3 "リポジトリ($REPO)"
# 改行を勝手に変えさせない(競艇 v24 と同じ。clone の前に)
if ((git config --global core.autocrlf) -ne "false") { git config --global core.autocrlf false; Ok "core.autocrlf を false にしました" }
New-Item -ItemType Directory -Force -Path $ROOT, $LOGS | Out-Null
$env:GIT_TERMINAL_PROMPT = "0"
if (Test-Path (Join-Path $REPO ".git")) {
    git -C $REPO pull --ff-only --quiet 2>&1 | Out-Host
    Ok "最新にしました"
} else {
    git clone --quiet https://github.com/honda1986/keirin.git $REPO 2>&1 | Out-Host
    if (-not (Test-Path (Join-Path $REPO ".git"))) { Ng "リポジトリを取れませんでした(ネットにつながっているか確認)"; Done 1 }
    Ok "入れました"
}
Remove-Item Env:GIT_TERMINAL_PROMPT

# ---- 4. GitHub へ送れるか(ログイン) ----
Step 4 "GitHub へ送れるか"
Say "  記録を GitHub へ送るためのログインを確かめます。ログインの窓が出たら、そこでログインしてください。"
git -C $REPO fetch --quiet origin refs/heads/odds-snap 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Ng "GitHub の記録用ブランチ(odds-snap)を取れません。ネットにつながっているか確認して、もう一度この1行を貼ってください"; Done 1 }
for ($try = 1; $try -le 5; $try++) {
    # 何も変えない送り方(--dry-run)で、ログインだけ確かめる
    $out = git -C $REPO push --dry-run origin FETCH_HEAD:refs/heads/odds-snap 2>&1 | Out-String
    if ($LASTEXITCODE -eq 0) { Ok "送れます"; break }
    Ng "まだ送れません: $(($out -split "`n" | Where-Object { $_.Trim() } | Select-Object -Last 1))"
    if ($try -eq 5) { Say "  5回試してもだめでした。あとで同じ1行をもう一度貼ってください(ここまでの準備は残ります)"; Done 1 }
    Say ""
    Say "  GitHub のトークンに keirin を足してください(競艇で使っているトークンを直すだけ):"
    Say "    1. いま開くページで、使っているトークンを選んで [Edit]"
    Say "    2. Repository access に honda1986/keirin を追加"
    Say "    3. Permissions の Contents を [Read and write]"
    Say "    4. 一番下の [Update]"
    Start-Process "https://github.com/settings/personal-access-tokens"
    Read-Host "  直したら Enter(もう一度確かめます)" | Out-Null
}

# ---- 5. 自己テストと試し運転 ----
Step 5 "自己テストと試し運転(送らない)"
Push-Location $REPO
& node pc\setup.js
$setupOk = ($LASTEXITCODE -eq 0)
Pop-Location
if (-not $setupOk) { Ng "上の × を直してから、もう一度この1行を貼ってください"; Done 1 }

# ---- 6. タスクの登録 ----
Step 6 "タスクの登録"
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $REPO "pc\register_tasks.ps1")
if ($LASTEXITCODE -ne 0) { Ng "タスクを登録できませんでした(上の赤い字をそのまま貼って相談してください)"; Done 1 }
Say ""
Say "  試しに1回動かします(30秒ほど)..."
Start-ScheduledTask -TaskName keirin_snap
Start-Sleep -Seconds 30
$log = Join-Path $LOGS ("snap_" + (Get-Date -Format yyyyMMdd) + ".log")
if (Test-Path $log) { Say "  --- $log の終わりのほう ---"; Get-Content -Tail 12 -Encoding UTF8 $log | Out-Host }
else { Say "  ログはまだありません(少し待って $LOGS を見てください)" }

Say ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host "  できました。あとは毎日 07:50〜翌01:00 に1分おきで、ひとりでに記録します。" -ForegroundColor Green
Write-Host "  PC が止まっても GitHub が25分ほどで引き継ぎます。" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Done 0
