# register_tasks.ps1 -- 競輪の締切前オッズの記録をタスクスケジューラに登録する
#
#   pc\tasks.bat を「右クリック → 管理者として実行」すると、これが動く。
#   直接なら PowerShell を管理者で開いて:
#     powershell -ExecutionPolicy Bypass -File C:\keirin\keirin\pc\register_tasks.ps1
#
# 競艇 v24 の register_tasks.ps1 と同じ設定・同じ注意(引き継ぎ資料 §4)。
# 消すとき: Unregister-ScheduledTask -TaskName keirin_snap -Confirm:$false

$repo = Split-Path -Parent $PSScriptRoot          # C:\keirin\keirin
$bat = Join-Path $repo "pc\task.bat"
if (-not (Test-Path $bat)) { throw "$bat がありません" }

# 07:50 から1分おきに 17時間10分(翌 01:00 まで)
#   ・最初のレース(モーニング 08:30 前後)の締切15分前より前に始まり、
#     最後のレース(ミッドナイト 23:40 前後)の後まで動く
#   ・1回ごとに終わる作り。締切15〜2分前のレースが無ければ数秒で終わる
#   ・同じレースは3分おきにしか読まない(snap.js)。1分おきにするのは窓に入った直後を拾うため
$trigger = New-ScheduledTaskTrigger -Daily -At 7:50am
$trigger.Repetition = (New-ScheduledTaskTrigger -Once -At 7:50am `
    -RepetitionInterval (New-TimeSpan -Minutes 1) `
    -RepetitionDuration (New-TimeSpan -Hours 17 -Minutes 10)).Repetition

$action = New-ScheduledTaskAction -Execute $bat -Argument "snap" -WorkingDirectory $repo
$settings = New-ScheduledTaskSettingsSet `
    -WakeToRun `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15) `
    -StartWhenAvailable
# ユーザーがログオンしていなくても動かす
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited

# ★-ErrorAction Stop を付ける。既定では登録に失敗しても赤い字が出るだけで続いてしまう
Register-ScheduledTask -TaskName "keirin_snap" -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Force -ErrorAction Stop | Out-Null
Write-Host "登録しました: keirin_snap"

# ★登録し終わったら、自分で数えて確かめる(人が確認コマンドを打つのを当てにしない)
$want = @("keirin_snap")
$have = @(Get-ScheduledTask -TaskName $want -ErrorAction SilentlyContinue | Select-Object -ExpandProperty TaskName)
$miss = @($want | Where-Object { $_ -notin $have })
if ($miss.Count -gt 0) {
    Write-Host "★登録できていないタスクがあります: $($miss -join ', ')" -ForegroundColor Red
    throw "タスクが $($miss.Count) 個足りません"
}
$t = Get-ScheduledTask -TaskName "keirin_snap"
$rep = $t.Triggers[0].Repetition
if ($rep.Interval -ne "PT1M") {
    Write-Host "★1分おきの繰り返しが設定されていません(Interval=$($rep.Interval))" -ForegroundColor Red
    throw "繰り返しの設定が違います"
}
Write-Host "登録できています: keirin_snap(07:50 から1分おき、$($rep.Duration))" -ForegroundColor Green
Write-Host ""
Write-Host "確認:  Get-ScheduledTask keirin_* | Format-Table TaskName, State"
Write-Host "試す:  Start-ScheduledTask -TaskName keirin_snap"
Write-Host "       そのあと $(Join-Path (Split-Path -Parent $repo) 'logs')\snap_<日付>.log を見る"
