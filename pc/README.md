# PC で締切前オッズを記録する（タスクスケジューラ）

競艇 v24 と同じく、**ふだんの記録は PC、GitHub は予備**という形にしてある。
GitHub の定時実行は起動が遅れたり落ちたりするため（v24 の引き継ぎ資料 §2）。

```
Windows PC（C:\keirin）── タスクスケジューラ keirin_snap ────────────────
  07:50〜翌01:00  1分おきに1回ずつ（pc\task.bat → node pc\runner.js snap）
                    ・10分おきに GitHub(main) を取り込む（出走表 races.json とコード）
                    ・races.json が今日の分でなければ、自分で出走表を取る（fetch.js → snapwork\races-local.json）
                    ・締切15〜2分前のレースの3連複（全組）を読んで snapwork\日付.jsonl に1行足す（snap.js）
                    ・10分おきに odds-snap ブランチへ送る（snap\日付.json.gz と 心拍 pc\heartbeat.json）
       │
       ▼
GitHub（honda1986/keirin）
  odds-snap ブランチ … 記録（main には入れない）
  snap.yml … 予備。5分おきに PC の心拍を見て、25分以上古ければ代わりに記録する。
              PC が戻れば自動で待機に戻る。両方が同じ時間に記録しても、足し合わせるだけで壊れない
```

**切り替えの操作は要らない。** PC が止まれば GitHub が25〜30分以内に引き継ぎ、PC が動けば GitHub は待つ。
（v24 と違って「両方が動く日を作らない」必要が無い。記録は足し合わせるだけで、通知も投票もしないため）

---

## 0. かんたんセットアップ（これだけで OK）

スタートメニューで「**PowerShell**」を開いて、次の1行を貼って Enter:

```
irm https://raw.githubusercontent.com/honda1986/keirin/main/pc/install.ps1 | iex
```

あとは画面の言うとおりに:

1. 「このアプリがデバイスに変更を加えることを許可しますか」→ **はい**（新しい窓で続きます）
2. Node.js が無ければ自動で入ります。リポジトリも `C:\keirin\keirin` に自動で入ります
3. GitHub のログインの窓が出たら**ログイン**
4. 「まだ送れません」と出たら、自動で開くトークンの画面で、**競艇で使っているトークンに keirin を足す**
   （[Edit] → Repository access に honda1986/keirin → Contents を Read and write → [Update]）→ 窓に戻って Enter
5. 「できました」が出たら終わり。タスクの登録と試し運転まで済んでいます

何度貼っても壊れません（もうあるものは作り直さない）。更新したいときも同じ1行を貼ればよい。
うまくいかなかったら、赤い字をそのまま貼って相談。

以下の 1〜1-5 は、この1行が中でやっていることを手でやる場合の手順（ふつうは読まなくてよい）。

## 1. 準備（手でやる場合）

### 1-1. Node.js を入れる

コマンドプロンプトに貼る（競艇は Python だが、競輪のスクリプトは Node.js）:

```
winget install --id OpenJS.NodeJS.LTS -e
```

Git は競艇で入れたものがそのまま使える。

### 1-2. リポジトリを入れる

```
git config --global core.autocrlf false
mkdir C:\keirin
cd C:\keirin
git clone https://github.com/honda1986/keirin.git
```

`core.autocrlf false` は競艇のときに設定済みなら不要（**clone の前に**設定すること）。

### 1-3. GitHub のトークンに keirin を足す

競艇 v24 で作った fine-grained トークンは v24 だけが対象なので、keirin にも送れるようにする。

GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens →
いま使っているトークン → **Edit** → Repository access に **honda1986/keirin** を追加 →
Permissions の **Contents を Read and write** → Update

（新しいトークンを作る必要は無い。同じ PC の Git Credential Manager は github.com に1つのトークンしか覚えないため、
同じトークンの対象を広げるのがいちばん簡単）

### 1-4. setup.bat をダブルクリック

`C:\keirin\keirin\pc\setup.bat`

Git・Node.js・改行の設定・フォルダ・**GitHub へ送れるか（ログインの窓が出たらここでログイン）**・
自己テスト・試し運転（送らない）まで確かめる。× が出たら、書いてある通りに直してもう一度。

★**ログインは必ずここで済ませる。** タスクスケジューラには画面が無く、そこで初めてログインを聞かれると固まる
（v24 で実機が止まった）。runner.js は git に「聞かない」設定を渡しているので、ログインが無いときは
「送れず（次の回に持ち越し）」とログに出て進む。

### 1-5. tasks.bat を「右クリック → 管理者として実行」

`C:\keirin\keirin\pc\tasks.bat`

タスク `keirin_snap` を登録し、1回動かしてログの終わりを見せる。登録できたかはスクリプトが自分で数えて確かめる。

---

## 2. 動いているかの確かめ方

| 見るところ | 何が分かるか |
|---|---|
| `C:\keirin\logs\snap_日付.log` | 1回ごとのログ（取り込み・読んだレース・送った/送れなかった理由） |
| GitHub の odds-snap ブランチの `pc/heartbeat.json` | PC が最後に送った時刻（10分おきに更新） |
| GitHub の Actions →「締切前オッズの記録」のログ | 「PC が動いているので待機」/「PC の心拍が古いので、こちらで記録する」 |

---

## 3. 設定（v24 と同じ。引き継ぎ資料 §3-2・§4）

| 設定 | やらないと起きること |
|---|---|
| スリープなし／ノートは「閉じても何もしない」 | 夜中に止まる（タスクには「スリープを解除して実行」も付けてある） |
| Windows Update のアクティブ時間を 7:00〜翌1:00 | 勝手な再起動がいちばんの停止原因 |
| タイムゾーン UTC+9・時刻の自動設定オン | 締切まで何分かがずれる |

タスクの設定（`register_tasks.ps1`）: ログオンしていなくても実行（S4U）／スリープを解除して実行／
バッテリーでも実行／**既に実行中なら新しく始めない**／予定時刻に動けなかったら後で動く／打ち切り15分。

---

## 4. 困ったとき

| 症状 | 見るところ・直し方 |
|---|---|
| ログに「前の回がまだ動いているので、今回は何もしません」が続く | 20分たてば古いロックは自動で捨てる。続くなら `C:\keirin\logs\snap.lock` を消す |
| 「送れず」「GitHub のログインが要ります」 | 1-3 のトークンの対象と権限。直したら setup.bat をもう一度 |
| 「手で直しかけのファイルがあるので、コードの取り込みは見送り」 | `C:\keirin\keirin` で `git status`。直しかけを消す（`git checkout -- ファイル名`）と次から取り込む |
| 「今日の出走表がありません」 | GitHub の朝の更新（main.yml）が遅れている。7時を過ぎると PC が自分で取る（20分おきに試す） |
| タスクを止めたい | `Disable-ScheduledTask -TaskName keirin_snap`（戻すのは `Enable-ScheduledTask`）。止めても GitHub が引き継ぐ |
| 消したい | `Unregister-ScheduledTask -TaskName keirin_snap -Confirm:$false` |

---

## 5. ファイル

| ファイル | 中身 |
|---|---|
| `pc/install.ps1` | **1行でセットアップ**（管理者への切り替え・Node.js/Git の導入・clone・ログイン確認・setup.js・タスク登録） |
| `pc/setup.bat` `pc/setup.js` | 準備と試し運転 |
| `pc/tasks.bat` `pc/register_tasks.ps1` | タスクの登録 |
| `pc/task.bat` | タスクから呼ばれる入口（PATH を足して `node pc\runner.js`） |
| `pc/runner.js` | 取り込み・出走表の予備取得・記録・送信・ロック・ログ |
| `pc/selftest.js` | runner.js の動きを外に触らずに確かめる（setup.bat が動かす） |
| `snap.js` / `snap_pack.js` | 記録とまとめ（GitHub の snap.yml と同じもの） |
