#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""update.py -- run.bat を開くたびに、GitHub(main) から最新のコードを取り込む（2026-11-29〜・keirin の hikitsugi §4-74）

  python update.py          （run.bat が最初に呼ぶ。手で動かしてもよい）

★それまでは、PC のタスク keirin_snap（pc/runner.js）が10分おきに取り込むだけだった。
  タスクが止まると（2026-11-22 夜〜11-28）コードも古いままになり、run.bat の画面も買い方も古いままだった。
  → run.bat を開くたびにここで取り込む。取り込めなくても、いまのまま動かす（メニューは止めない）。

やること（pc/runner.js の取り込みと同じ考え方）:
  1. GitHub の main を取ってくる（refs/betupdate/main に置く。タスクや betplan.js の FETCH_HEAD とぶつからない）
  2. races.json の手元の差分は捨てる（GitHub のものが正。PC は書かない）
  3. 手で変えたファイルがあれば、取り込む前に聞く。y なら C:\\keirin\\backup\\日時\\ に写してから元に戻す
  4. 早送り（--ff-only）で取り込む。PC で作ったコミットがあるときは取り込まない
  5. いまの版（bet/ を最後に変えたコミットと日時）を logs/version.txt に書く（run.bat のメニューに出す）
  6. タスク keirin_snap が止まっていそうなら知らせる（snapwork/runner.json が古い）

終了コード: 0 = 最新だった（画面を止めずにメニューへ） / 1 = 取り込んだ・取り込めなかった・知らせることがある（run.bat が pause する）
★git には「人に聞く」をさせない（ログインの窓が出て固まらないように。取れなければ、いまのまま動かす）
★このファイル自体も取り込みで書き換わることがある。run.bat は、取り込みのあと自分を最初から開き直す
"""
import datetime
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)                       # C:\keirin\keirin
REF = "refs/betupdate/main"
GIT_ENV = {"GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "never", "GIT_ASKPASS": "", "SSH_ASKPASS": ""}
TASK_STALE_MIN = 15                                # タスクは 07:50〜翌01:00 に1分おき。これより古ければ止まっている
SHOW_PRS = 10                                      # 取り込んだ変更の題名を何件まで見せるか


def find_git():
    """git の場所。PATH に無くても、よくある入れ場所を探す（pc/task.bat と同じ）"""
    g = shutil.which("git")
    if g:
        return g
    for p in (r"C:\Program Files\Git\cmd\git.exe",
              os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Git", "cmd", "git.exe")):
        if os.path.isfile(p):
            return p
    return None


def _git(exe, repo, *args, timeout=60):
    """(うまくいったか, 出力)。時間切れ・起動できないときも False で返す"""
    try:
        p = subprocess.run([exe, "-c", "core.quotepath=false", *args], cwd=repo, capture_output=True, encoding="utf-8",
                           errors="replace", timeout=timeout, env=dict(os.environ, **GIT_ENV))
        return p.returncode == 0, ((p.stdout or "") + (p.stderr or "")).strip()
    except subprocess.TimeoutExpired:
        return False, f"{timeout}秒で戻ってこないので諦めました"
    except OSError as e:
        return False, str(e)


def _last(out):
    lines = [x for x in str(out).splitlines() if x.strip()]
    return lines[-1].strip() if lines else ""


def version(exe, repo, rev="HEAD"):
    """bet/ を最後に変えたコミットと日時（keirin_bet.py の「版」と同じ形: "06c60de 11/27 00:29"）"""
    ok, out = _git(exe, repo, "log", "-1", "--format=%h %cd", "--date=format-local:%m/%d %H:%M", rev, "--", "bet", timeout=20)
    return out.strip() if ok and out.strip() else "?"


def write_version(repo, text):
    """run.bat のメニューに出す版。英数字だけ（run.bat は cp932 で読むため）"""
    try:
        d = os.path.join(repo, "bet", "logs")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "version.txt"), "w", encoding="ascii", errors="replace") as f:
            f.write(text + "\n")
    except OSError:
        pass


def changed_files(exe, repo):
    """手で変えたファイル [(状態, パス)]（git に入っているものだけ。races.json は除く）"""
    ok, out = _git(exe, repo, "diff", "--name-status", "--no-renames", "HEAD", timeout=30)
    if not ok:
        return []
    res = []
    for line in out.splitlines():
        parts = line.split("\t", 1)
        if len(parts) == 2 and parts[1].strip() and parts[1].strip() != "races.json":
            res.append((parts[0].strip()[:1], parts[1].strip()))
    return res


def backup_and_restore(exe, repo, files, now):
    """手で変えたファイルを backup に写してから、元（いまの版）に戻す。写せなければ戻さない"""
    dest = os.path.join(os.path.dirname(repo), "backup", now.strftime("%Y%m%d-%H%M%S"))
    try:
        for _, rel in files:
            src = os.path.join(repo, rel)
            if os.path.isfile(src):
                to = os.path.join(dest, rel)
                os.makedirs(os.path.dirname(to), exist_ok=True)
                shutil.copy2(src, to)
    except OSError as e:
        return False, f"写せませんでした（何も戻していません）: {e}"
    for st, rel in files:
        if st == "A":                                  # いまの版に無いファイル（足しかけ）は git から外すだけ（ファイルは残る）
            ok, out = _git(exe, repo, "rm", "-q", "--cached", "--", rel, timeout=30)
        else:
            ok, out = _git(exe, repo, "checkout", "-q", "HEAD", "--", rel, timeout=30)
        if not ok:
            return False, f"{rel} を戻せませんでした: {_last(out)}"
    return True, dest


def task_note(repo, now):
    """タスク keirin_snap が止まっていそうなら、その知らせ（動いていそう・使っていない・時間外なら None）"""
    if not (8 <= now.hour <= 23 and (now.hour, now.minute) >= (8, 10)):
        return None
    st = os.path.join(repo, "snapwork", "runner.json")
    try:
        mt = datetime.datetime.fromtimestamp(os.path.getmtime(st), now.tzinfo)
    except OSError:
        return None                                    # タスクを使っていない PC
    if (now - mt).total_seconds() < TASK_STALE_MIN * 60:
        return None
    return (f"  ★PC のタスク（締切前オッズの記録 keirin_snap）が {mt.strftime('%m/%d %H:%M')} から動いていないようです。\n"
            "    自動投票は動きますが、PC の記録が止まっています。直すには、PowerShell でセットアップの1行を貼ってください\n"
            "    （irm https://raw.githubusercontent.com/honda1986/keirin/main/pc/install.ps1 | iex）")


def update(repo=REPO, ask=input, say=print, exe=None, now=None):
    """取り込む。戻り値は終了コード（0 = 最新だった / 1 = 画面を止めて見てもらう）"""
    now = now or datetime.datetime.now().astimezone()
    note = task_note(repo, now)
    code = _update(repo, ask, say, exe or find_git())
    if note:
        say(note)
        code = 1
    return code


def _update(repo, ask, say, exe):
    if not exe:
        say("  ★git が見つからないので、GitHub からの取り込みはしません（いまのまま動かします）")
        return 1
    if not os.path.isdir(os.path.join(repo, ".git")):
        say(f"  ★{repo} は git で入れたフォルダではないので、取り込みはしません（いまのまま動かします）")
        return 1
    cur = version(exe, repo)
    say("  GitHub から最新を取り込んでいます...")
    ok, out = _git(exe, repo, "fetch", "-q", "--no-write-fetch-head", "--refmap=", "origin", "+refs/heads/main:" + REF, timeout=90)
    if not ok:
        write_version(repo, cur)
        say(f"  ★GitHub から取り込めませんでした（ネットにつながっているか確認）。いまのまま（コード {cur}）動かします")
        say(f"    {_last(out)}")
        return 1
    # races.json は GitHub のものが正。手元の差分は捨ててよい（タスクが「races.json だけ新しくした」ときは index にも入っている）
    _git(exe, repo, "checkout", "-q", "HEAD", "--", "races.json", timeout=30)
    ok1, head = _git(exe, repo, "rev-parse", "HEAD", timeout=20)
    ok2, new = _git(exe, repo, "rev-parse", REF, timeout=20)
    if not (ok1 and ok2):
        write_version(repo, cur)
        say(f"  ★取り込んだものを読めませんでした。いまのまま（コード {cur}）動かします: {_last(head if not ok1 else new)}")
        return 1
    if head == new:
        write_version(repo, cur)
        say(f"  最新です（コード {cur}）")
        return 0
    if not _git(exe, repo, "merge-base", "--is-ancestor", "HEAD", REF, timeout=30)[0]:
        write_version(repo, cur)
        say("  ★この PC で作った変更（コミット）があるので、取り込みませんでした。この画面をそのまま貼って相談してください")
        return 1
    files = changed_files(exe, repo)
    if files:
        say("  ★手で変えたファイルがあるので、まだ取り込んでいません:")
        for st, rel in files[:10]:
            say(f"      {rel}" + ("（消えている）" if st == "D" else ""))
        if len(files) > 10:
            say(f"      ほか {len(files) - 10} 個")
        try:
            a = ask("  元に戻して最新にしますか？ いまのファイルは C:\\keirin\\backup に写しておきます。\n"
                    "  y で戻して最新にする / 何も入れずに Enter でこのまま（古いまま）: ")
        except (EOFError, KeyboardInterrupt):
            a = ""
        if str(a).strip().lower() != "y":
            write_version(repo, cur)
            say(f"  古いまま（コード {cur}）動かします")
            return 1
        ok, msg = backup_and_restore(exe, repo, files, datetime.datetime.now())
        if not ok:
            write_version(repo, cur)
            say(f"  ★{msg}")
            say(f"  古いまま（コード {cur}）動かします")
            return 1
        say(f"  写しました: {msg}")
    ok, out = _git(exe, repo, "merge", "--ff-only", "-q", REF, timeout=120)
    if not ok:
        write_version(repo, version(exe, repo))
        say(f"  ★取り込みに失敗しました。いまのまま動かします: {_last(out)}")
        return 1
    after = version(exe, repo)
    write_version(repo, after)
    say(f"  最新にしました（コード {cur} → {after}）")
    ok, log = _git(exe, repo, "log", "--format=%s", f"{head}..{new}", timeout=30)
    prs = [s for s in log.splitlines() if s.rstrip().endswith(")") and "(#" in s] if ok else []
    if prs:
        say("  入った変更:")
        for s in prs[:SHOW_PRS]:
            say(f"    ・{s}")
        if len(prs) > SHOW_PRS:
            say(f"    ほか {len(prs) - SHOW_PRS} 件")
    return 1


if __name__ == "__main__":
    print()
    sys.exit(update())
